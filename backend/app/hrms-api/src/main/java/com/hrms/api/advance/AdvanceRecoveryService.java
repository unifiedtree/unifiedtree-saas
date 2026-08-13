package com.hrms.api.advance;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Advance recovery ledger — the missing piece that connects an advance's
 * installment schedule to the actual payroll cycle. Wave 2 (2026-08-11).
 *
 * <p><b>Before this service exists:</b> {@code advance_mgmt.advance_requests.
 * outstanding_amount} was set at disburse-time and NEVER decremented. Every
 * client hitting their first payroll after a disbursed advance would file
 * this as a bug. Fixed by hooking {@link #applyForMonth} into
 * {@code PayrollRunService.processRun} — inside the SAME @Transactional as
 * payslip generation so the balance and the payslip line move atomically.
 *
 * <p>Every write appends a row to {@code advance_mgmt.advance_ledger_entries}
 * with {@code balance_after}, so we can reconstruct any advance's history
 * without recomputing from scratch.
 *
 * <p>Interest-bearing advances (loan_type=PERSONAL_LOAN with rate>0) carry
 * {@code interest_rate_pct} but recovery math ignores interest at launch —
 * that's an explicit deferral (per master plan §5). The schema is ready.
 */
@Service
public class AdvanceRecoveryService {

    private static final Logger log = LoggerFactory.getLogger(AdvanceRecoveryService.class);

    private final JdbcTemplate jdbc;

    public AdvanceRecoveryService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record ScheduleRowDto(
            UUID id, int installmentNo, String scheduledMonth,
            BigDecimal scheduledAmount, String status,
            UUID payrollRunId, BigDecimal recoveredAmount, String recoveredAt) {}

    public record LedgerRowDto(
            UUID id, String entryType, BigDecimal amount, BigDecimal balanceAfter,
            UUID payrollRunId, String reference, String notes, String createdAt) {}

    public record ForecloseRequest(
            @jakarta.validation.constraints.NotNull BigDecimal lumpSumAmount,
            @jakarta.validation.constraints.NotBlank String reason) {}

    public record WriteOffRequest(
            @jakarta.validation.constraints.NotBlank String reason) {}

    public record SkipMonthRequest(
            @jakarta.validation.constraints.NotNull Integer installmentNo,
            @jakarta.validation.constraints.NotBlank String reason) {}

    public record RecoverySummaryDto(
            UUID advanceRequestId, BigDecimal principalAmount,
            BigDecimal outstandingAmount, int installmentsPending,
            int installmentsRecovered, String nextScheduledMonth) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    @Transactional
    public List<ScheduleRowDto> listSchedule(UUID tenantId, UUID advanceRequestId) {
        bindTenant(tenantId);
        return jdbc.query("""
                SELECT * FROM advance_mgmt.advance_recovery_schedule
                 WHERE advance_request_id = ?
                 ORDER BY installment_no ASC
                """, (rs, i) -> new ScheduleRowDto(
                    rs.getObject("id", UUID.class),
                    rs.getInt("installment_no"),
                    rs.getDate("scheduled_month").toString(),
                    rs.getBigDecimal("scheduled_amount"),
                    rs.getString("status"),
                    rs.getObject("payroll_run_id", UUID.class),
                    rs.getBigDecimal("recovered_amount"),
                    ts(rs.getTimestamp("recovered_at"))), advanceRequestId);
    }

    @Transactional
    public List<LedgerRowDto> listLedger(UUID tenantId, UUID advanceRequestId) {
        bindTenant(tenantId);
        return jdbc.query("""
                SELECT * FROM advance_mgmt.advance_ledger_entries
                 WHERE advance_request_id = ?
                 ORDER BY created_at ASC
                """, (rs, i) -> new LedgerRowDto(
                    rs.getObject("id", UUID.class),
                    rs.getString("entry_type"),
                    rs.getBigDecimal("amount"),
                    rs.getBigDecimal("balance_after"),
                    rs.getObject("payroll_run_id", UUID.class),
                    rs.getString("reference"),
                    rs.getString("notes"),
                    ts(rs.getTimestamp("created_at"))), advanceRequestId);
    }

    @Transactional
    public RecoverySummaryDto summary(UUID tenantId, UUID advanceRequestId) {
        bindTenant(tenantId);
        // Aggregate schedule state + join back to the request for the totals.
        return jdbc.query("""
                SELECT ar.id                                                   AS advance_id,
                       ar.amount                                               AS principal,
                       ar.outstanding_amount                                   AS outstanding,
                       count(*) FILTER (WHERE s.status = 'PENDING')            AS pending,
                       count(*) FILTER (WHERE s.status = 'RECOVERED')          AS recovered,
                       min(CASE WHEN s.status = 'PENDING' THEN s.scheduled_month END) AS next_month
                  FROM advance_mgmt.advance_requests ar
                  LEFT JOIN advance_mgmt.advance_recovery_schedule s
                    ON s.advance_request_id = ar.id
                 WHERE ar.id = ?
                 GROUP BY ar.id, ar.amount, ar.outstanding_amount
                """, rs -> {
                    if (!rs.next()) throw new BusinessRuleException("Advance not found", "ADVANCE_NOT_FOUND");
                    java.sql.Date nextMonth = rs.getDate("next_month");
                    return new RecoverySummaryDto(
                        rs.getObject("advance_id", UUID.class),
                        rs.getBigDecimal("principal"),
                        rs.getBigDecimal("outstanding"),
                        rs.getInt("pending"),
                        rs.getInt("recovered"),
                        nextMonth == null ? null : nextMonth.toString());
                }, advanceRequestId);
    }

    // ── Payroll integration ───────────────────────────────────────────────────

    /**
     * Called from {@code PayrollRunService.processRun} inside its own
     * {@code @Transactional}. For every DISBURSED advance with a PENDING
     * schedule row for the run's period-month, records a REPAYMENT ledger
     * entry and decrements {@code outstanding_amount}.
     *
     * <p>Returns a list of (employee_id, deduction) tuples so the caller can
     * inject the deduction as an ADVANCE_RECOVERY payslip line — the payroll
     * engine itself doesn't know about advances. Tuples are stable to
     * re-runs (idempotency via schedule.status='RECOVERED' short-circuit).
     */
    @Transactional
    public List<Deduction> applyForMonth(UUID tenantId, UUID runId, int periodMonth, int periodYear) {
        bindTenant(tenantId);
        LocalDate monthStart = LocalDate.of(periodYear, periodMonth, 1);

        // Find every PENDING installment for this period across all disbursed
        // advances. RLS keeps us tenant-scoped.
        List<Deduction> out = new ArrayList<>();
        List<UUID> scheduleIds = jdbc.query("""
                SELECT s.id, s.advance_request_id, s.scheduled_amount,
                       ar.employee_id, ar.outstanding_amount
                  FROM advance_mgmt.advance_recovery_schedule s
                  JOIN advance_mgmt.advance_requests ar ON ar.id = s.advance_request_id
                 WHERE s.scheduled_month = ?
                   AND s.status = 'PENDING'
                   AND ar.status = 'DISBURSED'
                """, (rs, i) -> {
                    UUID scheduleId = rs.getObject("id", UUID.class);
                    UUID advId      = rs.getObject("advance_request_id", UUID.class);
                    UUID empId      = rs.getObject("employee_id", UUID.class);
                    BigDecimal amt  = rs.getBigDecimal("scheduled_amount");
                    BigDecimal outstanding = rs.getBigDecimal("outstanding_amount");
                    // Cap the deduction at what's actually outstanding — the
                    // final installment often rounds off to something < scheduled.
                    BigDecimal deduct = amt.min(outstanding == null ? amt : outstanding);
                    if (deduct.signum() <= 0) {
                        // Nothing to recover — the outstanding is already zero
                        // (e.g. earlier foreclose). Mark schedule CANCELLED.
                        jdbc.update("""
                                UPDATE advance_mgmt.advance_recovery_schedule
                                   SET status = 'CANCELLED', updated_at = now(),
                                       version = version + 1
                                 WHERE id = ?
                                """, scheduleId);
                        return scheduleId;
                    }
                    // 1. Flip schedule row → RECOVERED
                    jdbc.update("""
                            UPDATE advance_mgmt.advance_recovery_schedule
                               SET status = 'RECOVERED', payroll_run_id = ?,
                                   recovered_amount = ?, recovered_at = now(),
                                   updated_at = now(), version = version + 1
                             WHERE id = ?
                            """, runId, deduct, scheduleId);
                    // 2. Decrement outstanding on the advance
                    BigDecimal newBalance = (outstanding == null ? BigDecimal.ZERO : outstanding).subtract(deduct);
                    if (newBalance.signum() < 0) newBalance = BigDecimal.ZERO;
                    jdbc.update("""
                            UPDATE advance_mgmt.advance_requests
                               SET outstanding_amount = ?, updated_at = now(),
                                   version = version + 1
                             WHERE id = ?
                            """, newBalance, advId);
                    // 3. Ledger entry (immutable audit)
                    jdbc.update("""
                            INSERT INTO advance_mgmt.advance_ledger_entries
                                (tenant_id, advance_request_id, entry_type,
                                 amount, balance_after, payroll_run_id,
                                 reference, notes)
                            VALUES (?, ?, 'REPAYMENT', ?, ?, ?, ?, ?)
                            """,
                            tenantId, advId, deduct.negate(), newBalance, runId,
                            "run:" + runId,
                            "Auto-recovered by payroll for period " + monthStart);
                    // 4. Yield the deduction so the payroll caller can insert
                    //    the payslip line.
                    out.add(new Deduction(empId, deduct, advId));
                    return scheduleId;
                }, java.sql.Date.valueOf(monthStart));

        log.info("Advance recovery applied for {}-{}: {} installments, {} deductions issued",
                periodMonth, periodYear, scheduleIds.size(), out.size());
        return out;
    }

    /** Tuple returned to the payroll caller — one row per employee to deduct. */
    public record Deduction(UUID employeeId, BigDecimal amount, UUID advanceRequestId) {}

    // ── Admin actions ─────────────────────────────────────────────────────────

    /**
     * Close the advance early with a lump-sum settlement. Cancels remaining
     * PENDING schedule rows and appends a FORECLOSE ledger entry.
     */
    @Transactional
    public RecoverySummaryDto foreclose(UUID tenantId, UUID advanceRequestId,
                                       ForecloseRequest req, UUID actorId) {
        bindTenant(tenantId);
        BigDecimal outstanding = jdbc.queryForObject(
                "SELECT outstanding_amount FROM advance_mgmt.advance_requests WHERE id = ?",
                BigDecimal.class, advanceRequestId);
        if (outstanding == null) throw new BusinessRuleException("Advance not found", "ADVANCE_NOT_FOUND");
        if (outstanding.signum() == 0) throw new BusinessRuleException("Nothing to foreclose", "NO_OUTSTANDING");

        BigDecimal lump = req.lumpSumAmount();
        if (lump.signum() <= 0) throw new BusinessRuleException(
                "Lump sum must be positive", "INVALID_AMOUNT");
        // Reject over-payment outright — a silent clamp writes a bogus amount
        // to the ledger (client says ₹10 000, we settle ₹500). Caller must
        // send exactly what's owed, not more.
        if (lump.compareTo(outstanding) > 0) {
            throw new BusinessRuleException(
                    "Lump sum ₹" + lump + " exceeds outstanding ₹" + outstanding,
                    "LUMP_EXCEEDS_OUTSTANDING");
        }
        BigDecimal newBalance = outstanding.subtract(lump);

        jdbc.update("""
                UPDATE advance_mgmt.advance_requests
                   SET outstanding_amount = ?, updated_at = now(),
                       version = version + 1
                 WHERE id = ?
                """, newBalance, advanceRequestId);
        jdbc.update("""
                INSERT INTO advance_mgmt.advance_ledger_entries
                    (tenant_id, advance_request_id, entry_type,
                     amount, balance_after, reference, notes, created_by)
                VALUES (?, ?, 'FORECLOSE', ?, ?, ?, ?, ?)
                """,
                tenantId, advanceRequestId, lump.negate(), newBalance,
                "foreclose", req.reason(),
                actorId == null ? null : actorId.toString());

        // Cancel remaining PENDING installments — the schedule no longer applies.
        int cancelled = jdbc.update("""
                UPDATE advance_mgmt.advance_recovery_schedule
                   SET status = 'CANCELLED', updated_at = now(),
                       version = version + 1
                 WHERE advance_request_id = ? AND status = 'PENDING'
                """, advanceRequestId);
        log.info("Foreclose advance={} lump={} newBalance={} cancelledInstallments={}",
                advanceRequestId, lump, newBalance, cancelled);

        return summary(tenantId, advanceRequestId);
    }

    /**
     * HR writes off remaining outstanding as bad debt. Cancels PENDING
     * schedule rows and appends a WRITE_OFF ledger entry.
     */
    @Transactional
    public RecoverySummaryDto writeOff(UUID tenantId, UUID advanceRequestId,
                                      WriteOffRequest req, UUID actorId) {
        bindTenant(tenantId);
        BigDecimal outstanding = jdbc.queryForObject(
                "SELECT outstanding_amount FROM advance_mgmt.advance_requests WHERE id = ?",
                BigDecimal.class, advanceRequestId);
        if (outstanding == null) throw new BusinessRuleException("Advance not found", "ADVANCE_NOT_FOUND");
        if (outstanding.signum() == 0) throw new BusinessRuleException(
                "Nothing to write off", "NO_OUTSTANDING");

        jdbc.update("""
                UPDATE advance_mgmt.advance_requests
                   SET outstanding_amount = 0, updated_at = now(),
                       version = version + 1
                 WHERE id = ?
                """, advanceRequestId);
        jdbc.update("""
                INSERT INTO advance_mgmt.advance_ledger_entries
                    (tenant_id, advance_request_id, entry_type,
                     amount, balance_after, reference, notes, created_by)
                VALUES (?, ?, 'WRITE_OFF', ?, 0, ?, ?, ?)
                """,
                tenantId, advanceRequestId, outstanding.negate(),
                "write_off", req.reason(),
                actorId == null ? null : actorId.toString());
        jdbc.update("""
                UPDATE advance_mgmt.advance_recovery_schedule
                   SET status = 'CANCELLED', updated_at = now(),
                       version = version + 1
                 WHERE advance_request_id = ? AND status = 'PENDING'
                """, advanceRequestId);
        return summary(tenantId, advanceRequestId);
    }

    /**
     * Skip a specific installment (e.g. HR grants a payroll break). Marks
     * the installment SKIPPED and appends one extra PENDING installment at
     * the end so the total recovery amount is preserved.
     */
    @Transactional
    public RecoverySummaryDto skipMonth(UUID tenantId, UUID advanceRequestId,
                                       SkipMonthRequest req, UUID actorId) {
        bindTenant(tenantId);
        // The target installment must exist and be PENDING.
        Integer installmentNo = req.installmentNo();
        String status = jdbc.query("""
                SELECT status FROM advance_mgmt.advance_recovery_schedule
                 WHERE advance_request_id = ? AND installment_no = ?
                """, rs -> rs.next() ? rs.getString(1) : null,
                advanceRequestId, installmentNo);
        if (status == null) throw new BusinessRuleException(
                "Installment #" + installmentNo + " not found", "INSTALLMENT_NOT_FOUND");
        if (!"PENDING".equals(status)) throw new BusinessRuleException(
                "Only PENDING installments can be skipped; #" + installmentNo + " is " + status,
                "INSTALLMENT_NOT_PENDING");

        jdbc.update("""
                UPDATE advance_mgmt.advance_recovery_schedule
                   SET status = 'SKIPPED', updated_at = now(),
                       version = version + 1
                 WHERE advance_request_id = ? AND installment_no = ?
                """, advanceRequestId, installmentNo);

        // Append a fresh PENDING installment at the end (max+1) so the
        // schedule still totals the original recovery amount.
        Integer maxNo = jdbc.queryForObject("""
                SELECT COALESCE(MAX(installment_no), 0)
                  FROM advance_mgmt.advance_recovery_schedule
                 WHERE advance_request_id = ?
                """, Integer.class, advanceRequestId);
        LocalDate lastMonth = jdbc.queryForObject("""
                SELECT MAX(scheduled_month)
                  FROM advance_mgmt.advance_recovery_schedule
                 WHERE advance_request_id = ?
                """, LocalDate.class, advanceRequestId);
        BigDecimal amt = jdbc.queryForObject("""
                SELECT monthly_deduction FROM advance_mgmt.advance_requests WHERE id = ?
                """, BigDecimal.class, advanceRequestId);

        LocalDate nextMonth = (lastMonth == null ? LocalDate.now() : lastMonth).plusMonths(1);
        jdbc.update("""
                INSERT INTO advance_mgmt.advance_recovery_schedule
                    (tenant_id, advance_request_id, installment_no,
                     scheduled_month, scheduled_amount, status)
                VALUES (?, ?, ?, ?, ?, 'PENDING')
                """,
                tenantId, advanceRequestId, maxNo + 1,
                java.sql.Date.valueOf(nextMonth), amt);

        return summary(tenantId, advanceRequestId);
    }

    /**
     * Seed the recovery schedule from a freshly disbursed advance. Called
     * once at disbursal time. Idempotent — no-op if a schedule already
     * exists for this advance (protects against double-clicks / retries).
     */
    @Transactional
    public void initSchedule(UUID tenantId, UUID advanceRequestId,
                            int startMonth, int startYear) {
        bindTenant(tenantId);
        Integer existing = jdbc.queryForObject("""
                SELECT count(*) FROM advance_mgmt.advance_recovery_schedule
                 WHERE advance_request_id = ?
                """, Integer.class, advanceRequestId);
        if (existing != null && existing > 0) {
            log.info("initSchedule: advance={} already has {} rows — skipping",
                    advanceRequestId, existing);
            return;
        }

        // Pull the advance basics.
        Object[] adv = jdbc.query("""
                SELECT amount, repayment_months, monthly_deduction
                  FROM advance_mgmt.advance_requests
                 WHERE id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    return new Object[] {
                        rs.getBigDecimal("amount"),
                        rs.getInt("repayment_months"),
                        rs.getBigDecimal("monthly_deduction")
                    };
                }, advanceRequestId);
        if (adv == null) throw new BusinessRuleException("Advance not found", "ADVANCE_NOT_FOUND");
        BigDecimal principal    = (BigDecimal) adv[0];
        int months              = (Integer)    adv[1];
        BigDecimal perMonth     = (BigDecimal) adv[2];

        // Ledger DISBURSE row + set outstanding=principal (belt+braces —
        // the advance service should already have done this, but idempotent).
        jdbc.update("""
                UPDATE advance_mgmt.advance_requests
                   SET outstanding_amount = ?, updated_at = now(),
                       version = version + 1
                 WHERE id = ?
                """, principal, advanceRequestId);
        jdbc.update("""
                INSERT INTO advance_mgmt.advance_ledger_entries
                    (tenant_id, advance_request_id, entry_type,
                     amount, balance_after, reference, notes)
                VALUES (?, ?, 'DISBURSE', ?, ?, 'disbursement',
                        'Advance disbursed; recovery schedule seeded')
                """,
                tenantId, advanceRequestId, principal, principal);

        // Emit N monthly rows starting at (startMonth, startYear).
        LocalDate m = LocalDate.of(startYear, startMonth, 1);
        for (int i = 1; i <= months; i++) {
            jdbc.update("""
                    INSERT INTO advance_mgmt.advance_recovery_schedule
                        (tenant_id, advance_request_id, installment_no,
                         scheduled_month, scheduled_amount, status)
                    VALUES (?, ?, ?, ?, ?, 'PENDING')
                    """,
                    tenantId, advanceRequestId, i,
                    java.sql.Date.valueOf(m), perMonth);
            m = m.plusMonths(1);
        }
        log.info("initSchedule: seeded {} installments for advance {} starting {}",
                months, advanceRequestId, LocalDate.of(startYear, startMonth, 1));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
