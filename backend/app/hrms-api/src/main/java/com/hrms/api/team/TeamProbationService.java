package com.hrms.api.team;

import com.hrms.api.approvals.Callers;
import com.hrms.api.approvals.DateText;
import com.hrms.api.probation.ProbationService;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Probation for managers (redesign BW-11, DECISIONS 15): managers see their
 * team's probation end dates; with {@code hrms.probation.team.decide} (OWNER,
 * SUPER_ADMIN, ADMIN, DEPT_MANAGER and MANAGER by default, V143.55/.67/.85)
 * they can also confirm or extend, for people in their team only.
 *
 * <p>Confirm and extend reuse today's code unchanged: the employee record's
 * confirm ({@link WorkforceEmployeeService#confirm}, what HR's Confirm calls)
 * and {@link ProbationService#extendProbation}. The stored "auto-extend"
 * probation setting stays inactive, as today; nothing here says probation
 * extends on its own. HR and the employee are told (PROBATION_TEAM_DECISION)
 * and every decision is audited.
 */
@Service
public class TeamProbationService {

    private static final Logger log = LoggerFactory.getLogger(TeamProbationService.class);
    /** Who "HR" is for these notifications: the people who follow probation reminders. */
    static final String HR_PERMISSION = "hrms.probation.reminders.read";

    private final TeamReadService team;
    private final JdbcTemplate jdbc;
    private final WorkforceEmployeeService workforce;
    private final ProbationService probation;
    private final PermissionHolders holders;
    private final AuditService audit;
    private final ApplicationEventPublisher events;

    public TeamProbationService(TeamReadService team, JdbcTemplate jdbc, WorkforceEmployeeService workforce,
                                ProbationService probation, PermissionHolders holders, AuditService audit,
                                ApplicationEventPublisher events) {
        this.team = team;
        this.jdbc = jdbc;
        this.workforce = workforce;
        this.probation = probation;
        this.holders = holders;
        this.audit = audit;
        this.events = events;
    }

    public record TeamProbationRow(UUID employeeId, String name, String jobTitle, String departmentName,
                                   LocalDate probationEndDate, long daysLeft, boolean overdue) {
    }

    public record TeamProbationDecision(UUID employeeId, String employmentStatus, LocalDate probationEndDate,
                                        LocalDate confirmationDate) {
    }

    /** People in the team whose probation ends within {@code days} days, plus every overdue one; soonest first. */
    @Transactional(readOnly = true)
    public List<TeamProbationRow> list(int days, Jwt jwt) {
        if (days < 1 || days > 365) {
            throw new HrmsException("Choose between 1 and 365 days.", HttpStatus.BAD_REQUEST, "PROBATION_RANGE_INVALID");
        }
        UUID tenantId = TenantContext.requireTenantId();
        List<UUID> ids = team.members(jwt).stream().map(Employee::getId).toList();
        List<TeamProbationRow> out = new ArrayList<>();
        if (ids.isEmpty()) return out;
        LocalDate today = DateText.todayIst();
        jdbc.query("""
                SELECT e.id, NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS name,
                       e.job_title, d.name AS department_name, e.probation_end_date
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.id = ANY(CAST(? AS uuid[])) AND e.employment_status = 'PROBATION'
                   AND e.probation_end_date IS NOT NULL AND e.probation_end_date <= ?
                 ORDER BY e.probation_end_date, e.first_name, e.id
                """, (RowCallbackHandler) rs -> {
            LocalDate end = rs.getObject("probation_end_date", LocalDate.class);
            long left = ChronoUnit.DAYS.between(today, end);
            out.add(new TeamProbationRow(rs.getObject("id", UUID.class), Objects.requireNonNullElse(rs.getString("name"), "Employee"),
                    rs.getString("job_title"), rs.getString("department_name"), end, left, left < 0));
        }, tenantId, TeamReadService.uuidArray(ids), today.plusDays(days));
        return out;
    }

    @Transactional
    public TeamProbationDecision confirm(UUID employeeId, LocalDate confirmationDate, Jwt jwt) {
        UUID tenantId = TenantContext.requireTenantId();
        Person p = lockTeamMemberOnProbation(tenantId, employeeId, jwt);
        LocalDate date = confirmationDate != null ? confirmationDate : DateText.todayIst();
        workforce.confirm(employeeId, date);
        String decidedBy = nameOf(tenantId, Callers.employeeId(jwt));
        record(tenantId, "PROBATION_CONFIRMED", employeeId,
                decidedBy + " confirmed " + p.name() + "'s probation (from Team today).");
        events.publishEvent(new ProbationTeamDecisionEvent(tenantId, employeeId, p.name(), "confirmed", decidedBy, null,
                hrRecipients(tenantId, employeeId, Callers.employeeId(jwt))));
        return new TeamProbationDecision(employeeId, "ACTIVE", null, date);
    }

    @Transactional
    public TeamProbationDecision extend(UUID employeeId, LocalDate newEndDate, String note, Jwt jwt) {
        UUID tenantId = TenantContext.requireTenantId();
        if (newEndDate == null) {
            throw new HrmsException("Choose the new last day of probation.", HttpStatus.BAD_REQUEST, "PROBATION_DATE_REQUIRED");
        }
        Person p = lockTeamMemberOnProbation(tenantId, employeeId, jwt);
        if (p.probationEndDate() != null && !newEndDate.isAfter(p.probationEndDate())) {
            throw new HrmsException("The new end date must be after the current one ("
                    + DateText.longDay(p.probationEndDate()) + ").", HttpStatus.UNPROCESSABLE_ENTITY, "PROBATION_DATE_INVALID");
        }
        probation.extendProbation(tenantId, employeeId, newEndDate);
        String decidedBy = nameOf(tenantId, Callers.employeeId(jwt));
        String why = note == null || note.isBlank() ? "" : " Note: " + note.trim();
        record(tenantId, "PROBATION_EXTENDED", employeeId, decidedBy + " extended " + p.name() + "'s probation to "
                + DateText.longDay(newEndDate) + " (from Team today)." + why);
        events.publishEvent(new ProbationTeamDecisionEvent(tenantId, employeeId, p.name(), "extended", decidedBy, newEndDate,
                hrRecipients(tenantId, employeeId, Callers.employeeId(jwt))));
        return new TeamProbationDecision(employeeId, "PROBATION", newEndDate, null);
    }

    record Person(String name, String status, LocalDate probationEndDate) {
    }

    /** The person must be in the caller's team and on probation; their row is locked until the decision commits. */
    private Person lockTeamMemberOnProbation(UUID tenantId, UUID employeeId, Jwt jwt) {
        Set<UUID> ids = team.members(jwt).stream().map(Employee::getId).collect(Collectors.toSet());
        if (!ids.contains(employeeId)) {
            throw new HrmsException("This person is not in your team.", HttpStatus.FORBIDDEN, "NOT_IN_TEAM");
        }
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS name,
                       employment_status, probation_end_date
                  FROM hrms.employees WHERE id = ? AND tenant_id = ? FOR UPDATE
                """, employeeId, tenantId);
        if (rows.isEmpty()) {
            throw new HrmsException("This person is not in your team.", HttpStatus.FORBIDDEN, "NOT_IN_TEAM");
        }
        Map<String, Object> r = rows.get(0);
        if (!"PROBATION".equals(r.get("employment_status"))) {
            throw new HrmsException("This person is not on probation.", HttpStatus.UNPROCESSABLE_ENTITY, "EMPLOYEE_NOT_IN_PROBATION");
        }
        java.sql.Date end = (java.sql.Date) r.get("probation_end_date");
        return new Person(Objects.requireNonNullElse((String) r.get("name"), "Employee"), (String) r.get("employment_status"),
                end == null ? null : end.toLocalDate());
    }

    /** HR for this notice: people holding the probation reminders permission, not the decider or the employee. */
    private List<UUID> hrRecipients(UUID tenantId, UUID employeeId, UUID decider) {
        java.util.Set<UUID> people = new java.util.LinkedHashSet<>(holders.employeesHolding(tenantId, HR_PERMISSION));
        // People granted it in the employee's company (COMPANY_ACCESS.md).
        people.addAll(holders.employeesGranted(tenantId, HR_PERMISSION, holders.companyOf(employeeId)));
        return people.stream()
                .filter(id -> !id.equals(employeeId) && !id.equals(decider))
                .toList();
    }

    private String nameOf(UUID tenantId, UUID employeeId) {
        List<String> rows = jdbc.queryForList(
                "SELECT NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                String.class, employeeId, tenantId);
        return rows.isEmpty() || rows.get(0) == null ? "Your manager" : rows.get(0);
    }

    private void record(UUID tenantId, String action, UUID employeeId, String summary) {
        try {
            audit.record("hrms", action, "employee", employeeId, summary);
        } catch (Exception e) {
            log.warn("Audit of a team probation decision failed (non-fatal): {}", e.getMessage());
        }
    }
}
