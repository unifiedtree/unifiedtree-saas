package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.notifications.events.OvertimeDecidedEvent;
import com.unifiedtree.notifications.events.OvertimeRequestedEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Overtime an employee asks for on a day they choose (DECISIONS 22; table {@code attendance.overtime_requests},
 * V143.66, JDBC only). The approver (attendance.overtime.approve, within their team, never their own request)
 * approves or rejects it, as with the other requests; the employee can withdraw it while it waits.
 *
 * <ul>
 *   <li>The day: up to {@value #DAYS_BACK} days back or {@value #DAYS_AHEAD} ahead.</li>
 *   <li>The minutes: at least the company's minimum overtime (a threshold, 60 by default), at most 24 hours.</li>
 *   <li>A day whose punches already show overtime that counts is refused: that overtime is already waiting for a
 *       decision on the Overtime list, and asking again would count it twice.</li>
 *   <li>One waiting or approved request per person and day.</li>
 *   <li>Approval stops at the company's monthly cap ({@link OvertimeCap}).</li>
 * </ul>
 * Approving records the overtime; it never changes pay or the stored punch overtime. The approver is notified
 * ({@code OVERTIME_REQUESTED}); the employee is told the decision through the existing overtime approved/rejected
 * notifications. Every call answers FEATURE_NOT_READY while the table is missing.
 */
@Service
public class OvertimeRequestService {

    private static final Logger log = LoggerFactory.getLogger(OvertimeRequestService.class);
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final int DAYS_BACK = 60;
    static final int DAYS_AHEAD = 30;
    static final int REASON_MIN = 10;
    static final int REASON_MAX = 500;
    static final int MAX_MINUTES = 1440;

    public record OvertimeRequestResponse(UUID id, UUID employeeId, String employeeName, String employeeCode,
                                          LocalDate date, int minutes, String reason, String status,
                                          String decidedByName, String decisionNote, Instant decidedAt, Instant createdAt) {}

    private final JdbcTemplate jdbc;
    private final TeamEmployeeScope scope;
    private final OvertimeRules rules;
    private final OvertimeCap cap;
    @Autowired(required = false)
    private ApplicationEventPublisher events;

    public OvertimeRequestService(JdbcTemplate jdbc, TeamEmployeeScope scope, OvertimeRules rules, OvertimeCap cap) {
        this.jdbc = jdbc;
        this.scope = scope;
        this.rules = rules;
        this.cap = cap;
    }

    /** True when V143.66's table exists (a catalog read; never fails). */
    static boolean tableReady(JdbcTemplate jdbc) {
        Boolean ready = jdbc.queryForObject("SELECT to_regclass('attendance.overtime_requests') IS NOT NULL", Boolean.class);
        return Boolean.TRUE.equals(ready);
    }

    private void requireTable() {
        if (!tableReady(jdbc)) throw new FeatureNotReady();
    }

    private static final String SELECT = """
            SELECT q.id, q.employee_id, concat_ws(' ', e.first_name, e.last_name) AS employee_name, e.employee_code,
                   q.request_date, q.minutes, q.reason, q.status,
                   NULLIF(concat_ws(' ', dby.first_name, dby.last_name), '') AS decided_by_name,
                   q.decision_note, q.decided_at, q.created_at
              FROM attendance.overtime_requests q
              JOIN hrms.employees e ON e.id = q.employee_id AND e.tenant_id = q.tenant_id
              LEFT JOIN hrms.employees dby ON dby.id = q.decided_by AND dby.tenant_id = q.tenant_id
            """;

    private static final RowMapper<OvertimeRequestResponse> MAPPER = (rs, n) -> new OvertimeRequestResponse(
            rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class), rs.getString("employee_name"),
            rs.getString("employee_code"), rs.getObject("request_date", LocalDate.class), rs.getInt("minutes"),
            rs.getString("reason"), rs.getString("status"), rs.getString("decided_by_name"), rs.getString("decision_note"),
            instant(rs.getTimestamp("decided_at")), instant(rs.getTimestamp("created_at")));

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    // ── the employee ─────────────────────────────────────────────────────────

    @Transactional
    public OvertimeRequestResponse create(UUID employeeId, LocalDate date, Integer minutes, String reasonIn) {
        UUID tenant = TenantContext.requireTenantId();
        requireTable();
        if (employeeId == null) throw new BusinessRuleException("Your employee record is needed to ask for overtime.", "OVERTIME_REQUEST_INVALID");
        LocalDate today = LocalDate.now(IST);
        if (date == null) throw new BusinessRuleException("Choose the day.", "OVERTIME_REQUEST_INVALID");
        if (date.isBefore(today.minusDays(DAYS_BACK)) || date.isAfter(today.plusDays(DAYS_AHEAD))) {
            throw new BusinessRuleException("Choose a day within the last %d days or the next %d.".formatted(DAYS_BACK, DAYS_AHEAD),
                    "OVERTIME_REQUEST_DATE_INVALID");
        }
        if (minutes == null || minutes < 1 || minutes > MAX_MINUTES) {
            throw new BusinessRuleException("Overtime is from 1 minute to 24 hours.", "OVERTIME_REQUEST_INVALID");
        }
        String reason = reasonIn == null ? "" : reasonIn.trim();
        if (reason.length() < REASON_MIN || reason.length() > REASON_MAX) {
            throw new BusinessRuleException("Give a reason of %d to %d characters.".formatted(REASON_MIN, REASON_MAX),
                    "OVERTIME_REQUEST_REASON_INVALID");
        }
        List<UUID> company = jdbc.queryForList("SELECT company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                UUID.class, employeeId, tenant);
        UUID companyId = company.isEmpty() ? null : company.get(0);
        OvertimeRules.Rules r = rules.forCompany(tenant, companyId);
        if (r.counted(minutes) == 0) {
            throw new BusinessRuleException("Overtime starts at %s: ask for at least that much.".formatted(OvertimeCap.hm(r.minimumMinutes())),
                    "OVERTIME_BELOW_MINIMUM");
        }
        Integer punched = jdbc.queryForObject("""
                SELECT COALESCE(MAX(overtime_minutes), 0) FROM attendance.records
                 WHERE tenant_id = ? AND employee_id = ? AND attendance_date = ? AND check_out_at IS NOT NULL
                """, Integer.class, tenant, employeeId, date);
        if (punched != null && r.counted(punched) > 0) {
            throw new BusinessRuleException("Your punches on that day already show %s of overtime; it's on the Overtime list for a decision."
                    .formatted(OvertimeCap.hm(punched)), "OVERTIME_ALREADY_RECORDED");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO attendance.overtime_requests (tenant_id, id, employee_id, company_id, request_date, minutes, reason)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, tenant, id, employeeId, companyId, date, minutes, reason);
        } catch (DuplicateKeyException e) {
            throw new BusinessRuleException("You already asked for overtime on that day.", "OVERTIME_REQUEST_EXISTS");
        }
        log.info("Overtime request {} by employee {}: {} min on {}", id, employeeId, minutes, date);
        if (events != null) {
            try {
                events.publishEvent(new OvertimeRequestedEvent(id, employeeId, tenant, date, minutes));
            } catch (Exception e) {
                log.warn("Failed to publish OvertimeRequestedEvent for {}: {}", id, e.getMessage());
            }
        }
        return byId(tenant, id);
    }

    @Transactional(readOnly = true)
    public List<OvertimeRequestResponse> mine(UUID employeeId) {
        UUID tenant = TenantContext.requireTenantId();
        requireTable();
        return jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.employee_id = ? ORDER BY q.request_date DESC, q.created_at DESC LIMIT 200",
                MAPPER, tenant, employeeId);
    }

    /** The employee withdraws their own waiting request: it becomes CANCELLED. */
    @Transactional
    public OvertimeRequestResponse withdraw(UUID id, UUID employeeId) {
        UUID tenant = TenantContext.requireTenantId();
        requireTable();
        OvertimeRequestResponse existing = byId(tenant, id);
        if (!existing.employeeId().equals(employeeId)) {
            throw new BusinessRuleException("You can withdraw only your own overtime request.", "OVERTIME_REQUEST_NOT_YOURS");
        }
        int updated = jdbc.update("""
                UPDATE attendance.overtime_requests SET status = 'CANCELLED', decided_at = now(), updated_at = now()
                 WHERE tenant_id = ? AND id = ? AND employee_id = ? AND status = 'PENDING'
                """, tenant, id, employeeId);
        if (updated == 0) throw new BusinessRuleException("Only a request that is still waiting can be withdrawn.", "OVERTIME_REQUEST_NOT_PENDING");
        return byId(tenant, id);
    }

    // ── the approver ─────────────────────────────────────────────────────────

    /** Requests from the caller's team (company for HR and admins) for days in [from, to], newest first. */
    @Transactional(readOnly = true)
    public List<OvertimeRequestResponse> team(Jwt jwt, LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from) || to.isAfter(from.plusDays(366))) {
            throw new BusinessRuleException("Choose a period of up to a year.", "OVERTIME_RANGE_INVALID");
        }
        UUID tenant = TenantContext.requireTenantId();
        requireTable();
        List<UUID> ids = teamIds(jwt);
        if (ids.isEmpty()) return List.of();
        Object[] args = new Object[ids.size() + 3];
        args[0] = tenant;
        args[1] = from;
        args[2] = to;
        for (int i = 0; i < ids.size(); i++) args[i + 3] = ids.get(i);
        return jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.request_date BETWEEN ? AND ? AND q.employee_id IN ("
                + String.join(",", Collections.nCopies(ids.size(), "?")) + ") ORDER BY q.request_date DESC, q.created_at DESC LIMIT 500",
                MAPPER, args);
    }

    /** Approve or reject a waiting request from the approver's team. A rejection needs a note; an approval checks the cap. */
    @Transactional
    public OvertimeRequestResponse decide(Jwt jwt, UUID id, boolean approve, String note) {
        UUID tenant = TenantContext.requireTenantId();
        requireTable();
        if (!approve && (note == null || note.isBlank())) {
            throw new BusinessRuleException("Explain why overtime is rejected", "OVERTIME_REASON_REQUIRED");
        }
        List<OvertimeRequestResponse> rows = jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.id = ? FOR UPDATE OF q", MAPPER, tenant, id);
        if (rows.isEmpty()) throw new ResourceNotFoundException("OvertimeRequest", id);
        OvertimeRequestResponse r = rows.get(0);
        UUID actor = callerId(jwt);
        if (r.employeeId().equals(actor)) {
            throw new BusinessRuleException("You cannot approve or reject your own overtime request", "SELF_APPROVAL_NOT_ALLOWED");
        }
        if (!teamIds(jwt).contains(r.employeeId())) {
            throw new BusinessRuleException("Employee is outside your approval scope", "OVERTIME_SCOPE_DENIED");
        }
        if (!"PENDING".equals(r.status())) {
            throw new BusinessRuleException("This request has already been decided.", "OVERTIME_REQUEST_NOT_PENDING");
        }
        if (approve) {
            List<UUID> company = jdbc.queryForList("SELECT company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                    UUID.class, r.employeeId(), tenant);
            OvertimeRules.Rules rr = rules.forCompany(tenant, company.isEmpty() ? null : company.get(0));
            cap.requireWithin(tenant, r.employeeId(), r.date(), r.minutes(), rr.monthlyCapMinutes(), null, id);
        }
        String status = approve ? "APPROVED" : "REJECTED";
        String cleanNote = note == null || note.isBlank() ? null : note.trim().length() > 1000 ? note.trim().substring(0, 1000) : note.trim();
        int updated = jdbc.update("""
                UPDATE attendance.overtime_requests
                   SET status = ?, decided_by = ?, decision_note = ?, decided_at = now(), updated_at = now()
                 WHERE tenant_id = ? AND id = ? AND status = 'PENDING'
                """, status, actor, cleanNote, tenant, id);
        if (updated == 0) throw new BusinessRuleException("This request has already been decided.", "OVERTIME_REQUEST_NOT_PENDING");
        if (events != null) {
            try {
                events.publishEvent(new OvertimeDecidedEvent(id, r.employeeId(), tenant, approve, r.date(), r.minutes(), cleanNote));
            } catch (Exception e) {
                log.warn("Failed to publish OvertimeDecidedEvent for request {}: {}", id, e.getMessage());
            }
        }
        return byId(tenant, id);
    }

    private List<UUID> teamIds(Jwt jwt) {
        try {
            return scope.resolve(jwt, null).stream().map(Employee::getId).toList();
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
    }

    static UUID callerId(Jwt jwt) {
        String e = jwt.getClaimAsString("employee_id");
        return UUID.fromString(e != null ? e : jwt.getSubject());
    }

    private OvertimeRequestResponse byId(UUID tenant, UUID id) {
        List<OvertimeRequestResponse> rows = jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.id = ?", MAPPER, tenant, id);
        if (rows.isEmpty()) throw new ResourceNotFoundException("OvertimeRequest", id);
        return rows.get(0);
    }
}
