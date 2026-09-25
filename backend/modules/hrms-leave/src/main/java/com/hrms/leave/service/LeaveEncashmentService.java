package com.hrms.leave.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentCreateRequest;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentOption;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentResponse;
import com.hrms.leave.dto.LeaveAccrualDtos.PayableEncashment;
import com.unifiedtree.notifications.events.LeaveEncashmentDecidedEvent;
import com.unifiedtree.notifications.events.LeaveEncashmentSubmittedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Leave encashment (V143.23): an employee, or HR on their behalf, asks to cash
 * in unused days of an encashable leave type; HR approves or rejects; an
 * approved request is paid as an earning by the next payroll run.
 *
 * <p>Balance effects, on {@code leave_mgmt.leave_balances} for the current
 * leave year: asking holds the days in {@code pending} (so they can't also be
 * taken as leave), approving moves them to {@code used} and writes an
 * ENCASHMENT row to the ledger, rejecting or cancelling gives them back.
 *
 * <p>The amount is one day's Basic per day (current monthly Basic ÷ 30),
 * worked out when the request is approved and again at payroll time if there
 * was no salary structure then.
 *
 * <p><b>Payroll hook</b> (for {@code PayrollRunService}, which this class does
 * not touch): {@link #rewindRun} at the start of processing, {@link #applyForRun}
 * after the payslip lines are written (it returns the earnings to add),
 * {@link #markPaidForRun} when the run is locked.
 */
@Service
public class LeaveEncashmentService {

    private static final Logger log = LoggerFactory.getLogger(LeaveEncashmentService.class);
    /** Days in a month for the per-day rate (monthly Basic ÷ 30). */
    static final BigDecimal DAYS_PER_MONTH = BigDecimal.valueOf(30);

    private final JdbcTemplate jdbc;
    private final LeaveAccrualService accrual;
    private final ApplicationEventPublisher events;

    public LeaveEncashmentService(JdbcTemplate jdbc, LeaveAccrualService accrual, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.accrual = accrual;
        this.events = events;
    }

    // ── Options ──────────────────────────────────────────────────────────────

    private record Emp(UUID id, UUID tenantId, UUID companyId, String name) {}

    private Emp employee(UUID employeeId) {
        List<Emp> rows = jdbc.query("""
                SELECT id, tenant_id, company_id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS n
                  FROM hrms.employees WHERE id = ?
                """, (rs, i) -> new Emp(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getObject("company_id", UUID.class), rs.getString("n")), employeeId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Employee", employeeId);
        return rows.get(0);
    }

    /** What {@code employeeId} can encash this year, per encashable leave type of their company. */
    @Transactional
    public List<EncashmentOption> options(UUID employeeId) {
        Emp e = employee(employeeId);
        int year = LeaveAccrualService.todayIst().getYear();
        accrual.topUpEmployee(employeeId, year);
        BigDecimal rate = perDayRate(employeeId);
        return jdbc.query("""
                SELECT lt.id, lt.name, lt.max_encash_days,
                       COALESCE(b.total_entitlement + b.carry_forward - b.used - b.pending, 0) AS available,
                       COALESCE((SELECT SUM(r.days) FROM leave_mgmt.leave_encashment_requests r
                                  WHERE r.employee_id = ? AND r.leave_type_id = lt.id AND r.year = ?
                                    AND r.status IN ('PENDING','APPROVED','PAID')), 0) AS requested
                  FROM leave_mgmt.leave_types lt
                  LEFT JOIN leave_mgmt.leave_balances b
                         ON b.leave_type_id = lt.id AND b.employee_id = ? AND b.year = ?
                 WHERE lt.company_id = ? AND lt.is_active = TRUE AND lt.is_encashable = TRUE
                 ORDER BY lt.name
                """, (rs, i) -> {
            int maxRaw = rs.getInt("max_encash_days");
            Integer max = rs.wasNull() ? null : maxRaw;
            double available = LeaveAccrualMath.round2(Math.max(0, rs.getDouble("available")));
            double requested = LeaveAccrualMath.round2(rs.getDouble("requested"));
            return new EncashmentOption(rs.getObject("id", UUID.class), rs.getString("name"), year, available, max,
                    requested, canRequest(available, max, requested), rate);
        }, employeeId, year, employeeId, year, e.companyId());
    }

    /** The most that can be asked for: the balance, and what's left of the yearly limit, in half days. */
    static double canRequest(double available, Integer maxPerYear, double alreadyRequested) {
        double cap = maxPerYear == null ? available : Math.min(available, maxPerYear - alreadyRequested);
        return Math.max(0, Math.floor(cap * 2) / 2.0);
    }

    // ── Create / cancel ──────────────────────────────────────────────────────

    /**
     * Ask to encash {@code req.days()} of a leave type for {@code employeeId}.
     * {@code raisedBy} is the employee id of whoever asked; {@code byHr} marks
     * a request HR raised for someone else.
     */
    @Transactional
    public EncashmentResponse create(UUID employeeId, EncashmentCreateRequest req, UUID raisedBy, boolean byHr) {
        if (req == null || req.leaveTypeId() == null) {
            throw new BusinessRuleException("Choose a leave type to encash.", "ENCASH_TYPE_REQUIRED");
        }
        double days = req.days() == null ? 0 : req.days().doubleValue();
        if (days <= 0) throw new BusinessRuleException("Enter how many days to encash (more than 0).", "ENCASH_DAYS_INVALID");
        if (days * 2 != Math.rint(days * 2)) {
            throw new BusinessRuleException("Days can be whole or half days, like 2 or 2.5.", "ENCASH_DAYS_INVALID");
        }
        String reason = req.reason() == null ? null : req.reason().trim();
        if (reason != null && reason.length() > 500) {
            throw new BusinessRuleException("Keep the reason under 500 characters.", "ENCASH_REASON_TOO_LONG");
        }
        Emp e = employee(employeeId);
        int year = LeaveAccrualService.todayIst().getYear();
        accrual.topUpEmployee(employeeId, year);

        List<Object[]> type = jdbc.query("""
                SELECT name, is_encashable, is_active, max_encash_days, company_id
                  FROM leave_mgmt.leave_types WHERE id = ?
                """, (rs, i) -> {
            int maxRaw = rs.getInt("max_encash_days");
            return new Object[]{rs.getString("name"), rs.getBoolean("is_encashable"), rs.getBoolean("is_active"),
                    rs.wasNull() ? null : maxRaw, rs.getObject("company_id", UUID.class)};
        }, req.leaveTypeId());
        if (type.isEmpty()) throw new ResourceNotFoundException("LeaveType", req.leaveTypeId());
        String typeName = (String) type.get(0)[0];
        if (!(Boolean) type.get(0)[1] || !(Boolean) type.get(0)[2] || !e.companyId().equals(type.get(0)[4])) {
            throw new BusinessRuleException("%s can't be encashed.".formatted(typeName), "LEAVE_NOT_ENCASHABLE");
        }
        Integer max = (Integer) type.get(0)[3];

        // Lock the balance so two requests can't both spend the same days.
        List<Double> available = jdbc.query("""
                SELECT total_entitlement + carry_forward - used - pending AS available
                  FROM leave_mgmt.leave_balances
                 WHERE employee_id = ? AND leave_type_id = ? AND year = ?
                 FOR UPDATE
                """, (rs, i) -> rs.getDouble(1), employeeId, req.leaveTypeId(), year);
        double have = available.isEmpty() ? 0 : LeaveAccrualMath.round2(available.get(0));
        if (days > have) {
            throw new BusinessRuleException("Only %s day(s) of %s are available to encash.".formatted(LeaveAccrualService.fmt(Math.max(0, have)), typeName),
                    "INSUFFICIENT_LEAVE_BALANCE");
        }
        if (max != null) {
            Double already = jdbc.queryForObject("""
                    SELECT COALESCE(SUM(days), 0) FROM leave_mgmt.leave_encashment_requests
                     WHERE employee_id = ? AND leave_type_id = ? AND year = ? AND status IN ('PENDING','APPROVED','PAID')
                    """, Double.class, employeeId, req.leaveTypeId(), year);
            double left = max - (already == null ? 0 : already);
            if (days > left) {
                throw new BusinessRuleException("%s can be encashed up to %d day(s) a year; %s left this year."
                        .formatted(typeName, max, LeaveAccrualService.fmt(Math.max(0, left))), "ENCASH_LIMIT_EXCEEDED");
            }
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO leave_mgmt.leave_encashment_requests
                    (id, tenant_id, employee_id, leave_type_id, year, days, status, reason,
                     raised_by_employee_id, raised_by_hr, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, now(), now())
                """, id, e.tenantId(), employeeId, req.leaveTypeId(), year, days, reason == null || reason.isEmpty() ? null : reason,
                raisedBy, byHr);
        jdbc.update("""
                UPDATE leave_mgmt.leave_balances SET pending = pending + ?, updated_at = now(), version = version + 1
                 WHERE employee_id = ? AND leave_type_id = ? AND year = ?
                """, days, employeeId, req.leaveTypeId(), year);
        publish(new LeaveEncashmentSubmittedEvent(id, employeeId, e.tenantId(), typeName, days, byHr));
        log.info("Leave encashment {} raised: employee={} type={} days={} byHr={}", id, employeeId, req.leaveTypeId(), days, byHr);
        return get(id);
    }

    /** The employee withdraws their own pending request; the days go back. */
    @Transactional
    public EncashmentResponse cancel(UUID requestId, UUID employeeId) {
        Row r = lock(requestId);
        if (!r.employeeId().equals(employeeId)) {
            throw new HrmsException("This isn't your encashment request.", HttpStatus.FORBIDDEN, "ENCASH_NOT_YOURS");
        }
        if (!"PENDING".equals(r.status())) {
            throw new BusinessRuleException("Only a request that hasn't been decided can be cancelled.", "ENCASH_NOT_PENDING");
        }
        jdbc.update("UPDATE leave_mgmt.leave_encashment_requests SET status = 'CANCELLED', updated_at = now() WHERE id = ?", requestId);
        releasePending(r);
        return get(requestId);
    }

    // ── Decide ───────────────────────────────────────────────────────────────

    /** HR approves or rejects. Nobody decides their own request. */
    @Transactional
    public EncashmentResponse decide(UUID requestId, UUID deciderEmployeeId, boolean approved, String note) {
        Row r = lock(requestId);
        if (!"PENDING".equals(r.status())) {
            throw new BusinessRuleException("This request was already decided.", "ENCASH_NOT_PENDING");
        }
        if (deciderEmployeeId != null && deciderEmployeeId.equals(r.employeeId())) {
            throw new HrmsException("You can't decide your own encashment request.", HttpStatus.FORBIDDEN, "SELF_APPROVAL_FORBIDDEN");
        }
        String n = note == null || note.isBlank() ? null : note.trim();
        if (n != null && n.length() > 500) throw new BusinessRuleException("Keep the note under 500 characters.", "ENCASH_NOTE_TOO_LONG");
        BigDecimal rate = null, amount = null;
        if (approved) {
            rate = perDayRate(r.employeeId());
            amount = amountFor(rate, r.days());
            jdbc.update("""
                    UPDATE leave_mgmt.leave_balances
                       SET pending = GREATEST(0, pending - ?), used = used + ?, updated_at = now(), version = version + 1
                     WHERE employee_id = ? AND leave_type_id = ? AND year = ?
                    """, r.days(), r.days(), r.employeeId(), r.leaveTypeId(), r.year());
            jdbc.update("""
                    INSERT INTO leave_mgmt.leave_balance_ledger
                        (tenant_id, employee_id, leave_type_id, year, kind, period, days, note, source_id, created_by)
                    VALUES (?, ?, ?, ?, 'ENCASHMENT', ?, ?, ?, ?, ?)
                    ON CONFLICT (tenant_id, employee_id, leave_type_id, kind, period) DO NOTHING
                    """, r.tenantId(), r.employeeId(), r.leaveTypeId(), r.year(), "ENC-" + requestId, r.days(),
                    "Encashed %s day(s)%s".formatted(LeaveAccrualService.fmt(r.days()),
                            amount != null ? " for ₹" + amount.toPlainString() : ""),
                    requestId, deciderEmployeeId == null ? "system" : deciderEmployeeId.toString());
        } else {
            releasePending(r);
        }
        jdbc.update("""
                UPDATE leave_mgmt.leave_encashment_requests
                   SET status = ?, decided_by_employee_id = ?, decided_at = now(), decision_note = ?,
                       per_day_rate = ?, amount = ?, updated_at = now()
                 WHERE id = ?
                """, approved ? "APPROVED" : "REJECTED", deciderEmployeeId, n, rate, amount, requestId);
        publish(new LeaveEncashmentDecidedEvent(requestId, r.employeeId(), r.tenantId(), r.typeName(), r.days(), approved, n, amount));
        return get(requestId);
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    private static final String SELECT = """
            SELECT r.id, r.employee_id, r.leave_type_id, r.year, CAST(r.days AS double precision) AS days, r.status, r.reason,
                   r.raised_by_hr, r.decided_at, r.decision_note, r.per_day_rate, r.amount, r.payroll_run_id, r.paid_at, r.created_at,
                   TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS emp_name, e.employee_code,
                   lt.name AS type_name,
                   TRIM(COALESCE(rb.first_name,'') || ' ' || COALESCE(rb.last_name,'')) AS raised_name,
                   TRIM(COALESCE(db.first_name,'') || ' ' || COALESCE(db.last_name,'')) AS decided_name
              FROM leave_mgmt.leave_encashment_requests r
              LEFT JOIN hrms.employees e  ON e.id = r.employee_id
              LEFT JOIN hrms.employees rb ON rb.id = r.raised_by_employee_id
              LEFT JOIN hrms.employees db ON db.id = r.decided_by_employee_id
              LEFT JOIN leave_mgmt.leave_types lt ON lt.id = r.leave_type_id
            """;

    private static final RowMapper<EncashmentResponse> MAPPER = (rs, i) -> new EncashmentResponse(
            rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class), blankToNull(rs.getString("emp_name")),
            rs.getString("employee_code"), rs.getObject("leave_type_id", UUID.class), rs.getString("type_name"),
            rs.getInt("year"), rs.getDouble("days"), rs.getString("status"), rs.getString("reason"),
            rs.getBoolean("raised_by_hr"), blankToNull(rs.getString("raised_name")), blankToNull(rs.getString("decided_name")),
            instant(rs.getTimestamp("decided_at")), rs.getString("decision_note"), rs.getBigDecimal("per_day_rate"),
            rs.getBigDecimal("amount"), rs.getObject("payroll_run_id", UUID.class), instant(rs.getTimestamp("paid_at")),
            instant(rs.getTimestamp("created_at")));

    @Transactional(readOnly = true)
    public EncashmentResponse get(UUID id) {
        List<EncashmentResponse> rows = jdbc.query(SELECT + " WHERE r.id = ?", MAPPER, id);
        if (rows.isEmpty()) throw new ResourceNotFoundException("LeaveEncashment", id);
        return rows.get(0);
    }

    @Transactional(readOnly = true)
    public List<EncashmentResponse> listMine(UUID employeeId) {
        return jdbc.query(SELECT + " WHERE r.employee_id = ? ORDER BY r.created_at DESC LIMIT 200", MAPPER, employeeId);
    }

    /** HR's list: {@code pending} = waiting for a decision, otherwise everything decided, newest first. */
    @Transactional(readOnly = true)
    public List<EncashmentResponse> list(boolean pending, int limit) {
        String where = pending ? " WHERE r.status = 'PENDING' ORDER BY r.created_at ASC" : " WHERE r.status <> 'PENDING' ORDER BY COALESCE(r.decided_at, r.updated_at) DESC";
        return jdbc.query(SELECT + where + " LIMIT ?", MAPPER, Math.max(1, Math.min(limit, 500)));
    }

    // ── Payroll hook ─────────────────────────────────────────────────────────

    /**
     * Approved encashments not yet paid, for these employees: what a payroll
     * run should add as a LEAVE_ENCASHMENT earning. Does not change anything.
     */
    @Transactional(readOnly = true)
    public List<PayableEncashment> payableFor(List<UUID> employeeIds) {
        if (employeeIds == null || employeeIds.isEmpty()) return List.of();
        List<PayableEncashment> out = new ArrayList<>();
        for (int from = 0; from < employeeIds.size(); from += 500) {
            List<UUID> chunk = employeeIds.subList(from, Math.min(employeeIds.size(), from + 500));
            String in = String.join(",", Collections.nCopies(chunk.size(), "?"));
            out.addAll(jdbc.query("""
                    SELECT r.id, r.employee_id, r.leave_type_id, lt.name, CAST(r.days AS double precision) AS days, r.per_day_rate, r.amount
                      FROM leave_mgmt.leave_encashment_requests r
                      LEFT JOIN leave_mgmt.leave_types lt ON lt.id = r.leave_type_id
                     WHERE r.status = 'APPROVED' AND r.payroll_run_id IS NULL AND r.employee_id IN (%s)
                     ORDER BY r.decided_at
                    """.formatted(in), (rs, i) -> new PayableEncashment(rs.getObject("id", UUID.class),
                    rs.getObject("employee_id", UUID.class), rs.getObject("leave_type_id", UUID.class), rs.getString("name"),
                    rs.getDouble("days"), rs.getBigDecimal("per_day_rate"), rs.getBigDecimal("amount")), chunk.toArray()));
        }
        return out;
    }

    /**
     * Attach every payable encashment of these employees to {@code runId} and
     * return them, with an amount (worked out now from the current Basic when
     * it wasn't known at approval). Rows that still have no amount (no salary
     * structure) are left for a later run. Call after {@link #rewindRun}.
     */
    @Transactional
    public List<PayableEncashment> applyForRun(UUID runId, List<UUID> employeeIds) {
        List<PayableEncashment> out = new ArrayList<>();
        for (PayableEncashment p : payableFor(employeeIds)) {
            BigDecimal rate = p.perDayRate(), amount = p.amount();
            if (amount == null) {
                rate = perDayRate(p.employeeId());
                amount = amountFor(rate, p.days());
                if (amount == null) {
                    log.warn("Leave encashment {} has no amount (no salary structure for employee {}); left for a later run", p.id(), p.employeeId());
                    continue;
                }
            }
            int n = jdbc.update("""
                    UPDATE leave_mgmt.leave_encashment_requests
                       SET payroll_run_id = ?, per_day_rate = ?, amount = ?, updated_at = now()
                     WHERE id = ? AND status = 'APPROVED' AND payroll_run_id IS NULL
                    """, runId, rate, amount, p.id());
            if (n > 0) out.add(new PayableEncashment(p.id(), p.employeeId(), p.leaveTypeId(), p.leaveTypeName(), p.days(), rate, amount));
        }
        return out;
    }

    /** Detach this run's encashments (re-processing or reopening the run); PAID goes back to APPROVED. */
    @Transactional
    public int rewindRun(UUID runId) {
        return jdbc.update("""
                UPDATE leave_mgmt.leave_encashment_requests
                   SET payroll_run_id = NULL, status = 'APPROVED', paid_at = NULL, updated_at = now()
                 WHERE payroll_run_id = ? AND status IN ('APPROVED','PAID')
                """, runId);
    }

    /** The run was locked: its encashments are paid. */
    @Transactional
    public int markPaidForRun(UUID runId) {
        return jdbc.update("""
                UPDATE leave_mgmt.leave_encashment_requests
                   SET status = 'PAID', paid_at = now(), updated_at = now()
                 WHERE payroll_run_id = ? AND status = 'APPROVED'
                """, runId);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private record Row(UUID id, UUID tenantId, UUID employeeId, UUID leaveTypeId, int year, double days, String status, String typeName) {}

    private Row lock(UUID requestId) {
        List<Row> rows = jdbc.query("""
                SELECT r.id, r.tenant_id, r.employee_id, r.leave_type_id, r.year, CAST(r.days AS double precision) AS days,
                       r.status, lt.name
                  FROM leave_mgmt.leave_encashment_requests r
                  LEFT JOIN leave_mgmt.leave_types lt ON lt.id = r.leave_type_id
                 WHERE r.id = ?
                 FOR UPDATE OF r
                """, (rs, i) -> new Row(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getObject("employee_id", UUID.class), rs.getObject("leave_type_id", UUID.class), rs.getInt("year"),
                rs.getDouble("days"), rs.getString("status"), rs.getString("name")), requestId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("LeaveEncashment", requestId);
        return rows.get(0);
    }

    private void releasePending(Row r) {
        jdbc.update("""
                UPDATE leave_mgmt.leave_balances SET pending = GREATEST(0, pending - ?), updated_at = now(), version = version + 1
                 WHERE employee_id = ? AND leave_type_id = ? AND year = ?
                """, r.days(), r.employeeId(), r.leaveTypeId(), r.year());
    }

    /**
     * One day's pay: the current monthly Basic ÷ 30, or null without a salary
     * structure. A structure with no earning lines is paid entirely as Basic by
     * payroll (PayrollCalc.resolvePay), so its monthly CTC is the Basic here too;
     * without that, such a person's encashment was never priced and never paid.
     */
    BigDecimal perDayRate(UUID employeeId) {
        List<BigDecimal> basic = jdbc.query("""
                SELECT COALESCE(
                         (SELECT esc.monthly_amount
                            FROM payroll.employee_structure_components esc
                            JOIN payroll.salary_components c ON c.id = esc.component_id
                           WHERE esc.structure_id = s.id AND c.code = 'BASIC'
                           LIMIT 1),
                         CASE WHEN NOT EXISTS (
                                  SELECT 1 FROM payroll.employee_structure_components esc
                                    JOIN payroll.salary_components c ON c.id = esc.component_id
                                   WHERE esc.structure_id = s.id AND c.category IN ('EARNING', 'REIMBURSEMENT'))
                              THEN s.ctc_monthly END)
                  FROM payroll.employee_salary_structures s
                 WHERE s.employee_id = ? AND s.is_current IS TRUE
                 LIMIT 1
                """, (rs, i) -> rs.getBigDecimal(1), employeeId);
        return rateFromBasic(basic.isEmpty() ? null : basic.get(0));
    }

    static BigDecimal rateFromBasic(BigDecimal monthlyBasic) {
        if (monthlyBasic == null || monthlyBasic.signum() <= 0) return null;
        return monthlyBasic.divide(DAYS_PER_MONTH, 2, RoundingMode.HALF_UP);
    }

    static BigDecimal amountFor(BigDecimal perDayRate, double days) {
        if (perDayRate == null) return null;
        return perDayRate.multiply(BigDecimal.valueOf(days)).setScale(2, RoundingMode.HALF_UP);
    }

    private void publish(Object event) {
        try {
            events.publishEvent(event);
        } catch (Exception ex) {
            log.warn("Could not publish {}: {}", event.getClass().getSimpleName(), ex.getMessage());
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    private static java.time.Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
