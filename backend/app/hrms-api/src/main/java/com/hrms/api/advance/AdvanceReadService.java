package com.hrms.api.advance;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Read models over salary advances for the redesign (BW-62): the company and
 * personal totals, and the list's Recovering / Repaid / department filters.
 * JDBC over existing columns only. Every statement filters the tenant, runs
 * in a read-only transaction (so RLS applies too), and takes the same scope
 * as the advances list: everything with {@code hrms.advance.disburse}, else
 * only the advances routed to the caller ({@code approverScope}).
 */
@Service
public class AdvanceReadService {

    /** Where an advance is after payout: still being recovered, or repaid (written-off balances are neither). */
    public enum Phase { RECOVERING, REPAID }

    /** HR_MANAGER's system role id (V004), as ApproverFallbackResolver uses it. */
    static final UUID HR_MANAGER_ROLE = UUID.fromString("00000000-0000-0000-0000-000000000002");

    private final JdbcTemplate jdbc;

    public AdvanceReadService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** How many advances, and their amount. */
    public record Bucket(long count, BigDecimal amount) {}

    /**
     * The company's advances (in the caller's scope).
     * requested: waiting for a decision (requested amount).
     * approvedNotDisbursed: approved, not paid out yet.
     * recovering: paid out and still being recovered from salary; {@code people}
     * is how many employees owe, {@code outstanding} what they still owe.
     * repaid: fully repaid (a written-off balance is counted in writtenOff instead).
     * repaidThisFinancialYear: what came back in the caller's company's financial
     * year, through payroll or a recorded full repayment (ledger entries).
     */
    public record AdvancesSummary(long total, Bucket requested, Bucket approvedNotDisbursed,
                                  long recovering, long recoveringPeople, BigDecimal outstanding,
                                  long repaid, long writtenOff, long rejected,
                                  BigDecimal repaidThisFinancialYear, String financialYear,
                                  LocalDate financialYearStart, LocalDate financialYearEnd) {}

    /**
     * The caller's own advances. {@code monthlyRecovery} is the next installment
     * of each advance being recovered, added up; {@code installmentsLeft} the
     * number of months with a deduction still to come; {@code nextDeductionMonth}
     * the first of them ("2026-10").
     */
    public record MyAdvancesSummary(long total, Bucket waiting, Bucket approvedNotDisbursed,
                                    long recovering, BigDecimal stillToRepay, BigDecimal monthlyRecovery,
                                    int installmentsLeft, String nextDeductionMonth, long repaid) {}

    /** One page of advance ids, newest first, and how many match in all. */
    public record IdPage(List<UUID> ids, long total) {}

    /** The SQL condition for a phase over {@code ar} (advance) and {@code w} (its write-off, if any). */
    static String phaseCondition(Phase phase) {
        return switch (phase) {
            case RECOVERING -> "ar.status = 'DISBURSED' AND ar.outstanding_amount > 0";
            case REPAID -> "(ar.status = 'CLOSED' OR (ar.status = 'DISBURSED' AND ar.outstanding_amount <= 0))"
                    + " AND w.advance_request_id IS NULL";
        };
    }

    private static final String WRITE_OFFS = """
            LEFT JOIN (SELECT DISTINCT advance_request_id FROM advance_mgmt.advance_ledger_entries
                        WHERE tenant_id = ? AND entry_type = 'WRITE_OFF') w ON w.advance_request_id = ar.id
            """;

    /**
     * The list's filters (BW-62): statuses, a phase and a department, in the
     * caller's scope. Newest first, as the unfiltered list.
     */
    @Transactional(readOnly = true)
    public IdPage filteredIds(UUID tenantId, UUID approverScope, Collection<String> statuses, Phase phase,
                              UUID departmentId, int page, int size) {
        return filteredIds(tenantId, approverScope, statuses, phase, departmentId, null, page, size);
    }

    /**
     * {@link #filteredIds(UUID, UUID, Collection, Phase, UUID, int, int)}, also
     * kept to advances asked for on a day in {@code range} (calendar everywhere,
     * 7 Oct 2026: the request date, created_at in India). Null = no range.
     */
    @Transactional(readOnly = true)
    public IdPage filteredIds(UUID tenantId, UUID approverScope, Collection<String> statuses, Phase phase,
                              UUID departmentId, com.hrms.core.dto.ListDateRange range, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE ar.tenant_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(tenantId);  // WRITE_OFFS
        args.add(tenantId);
        if (approverScope != null) { where.append(" AND ar.approver_id = ?"); args.add(approverScope); }
        if (statuses != null && !statuses.isEmpty()) {
            where.append(" AND ar.status IN (").append(String.join(",", Collections.nCopies(statuses.size(), "?"))).append(")");
            args.addAll(statuses);
        }
        if (phase != null) where.append(" AND ").append(phaseCondition(phase));
        if (departmentId != null) {
            where.append(" AND EXISTS (SELECT 1 FROM hrms.employees e WHERE e.tenant_id = ar.tenant_id"
                    + " AND e.id = ar.employee_id AND e.department_id = ?)");
            args.add(departmentId);
        }
        if (range != null) {
            where.append(" AND ar.created_at >= ? AND ar.created_at < ?");
            args.add(range.startsAtOffset());
            args.add(range.endsBeforeOffset());
        }
        String from = " FROM advance_mgmt.advance_requests ar " + WRITE_OFFS + where;
        Long total = jdbc.queryForObject("SELECT count(*)" + from, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<UUID> ids = jdbc.query("SELECT ar.id" + from + " ORDER BY ar.created_at DESC, ar.id DESC LIMIT ? OFFSET ?",
                (rs, i) -> rs.getObject(1, UUID.class), pageArgs.toArray());
        return new IdPage(ids, total == null ? 0 : total);
    }

    @Transactional(readOnly = true)
    public AdvancesSummary summary(UUID tenantId, UUID approverScope, PayFinancialYear year) {
        String scope = approverScope == null ? "" : " AND ar.approver_id = ?";
        List<Object> args = new ArrayList<>(List.of(tenantId, tenantId));
        if (approverScope != null) args.add(approverScope);
        String recovering = phaseCondition(Phase.RECOVERING);
        String repaid = phaseCondition(Phase.REPAID);
        AdvancesSummary counts = jdbc.query("""
                SELECT count(*)                                                                   AS total,
                       count(*) FILTER (WHERE ar.status = 'REQUESTED')                            AS req_n,
                       coalesce(sum(ar.amount) FILTER (WHERE ar.status = 'REQUESTED'), 0)         AS req_amt,
                       count(*) FILTER (WHERE ar.status = 'APPROVED')                             AS appr_n,
                       coalesce(sum(ar.amount) FILTER (WHERE ar.status = 'APPROVED'), 0)          AS appr_amt,
                       count(*) FILTER (WHERE %1$s)                                               AS rec_n,
                       count(DISTINCT ar.employee_id) FILTER (WHERE %1$s)                         AS rec_people,
                       coalesce(sum(ar.outstanding_amount) FILTER (WHERE %1$s), 0)                AS rec_amt,
                       count(*) FILTER (WHERE %2$s)                                               AS repaid_n,
                       count(*) FILTER (WHERE w.advance_request_id IS NOT NULL)                   AS written_off_n,
                       count(*) FILTER (WHERE ar.status = 'REJECTED')                             AS rej_n
                  FROM advance_mgmt.advance_requests ar
                """.formatted(recovering, repaid) + WRITE_OFFS + " WHERE ar.tenant_id = ?" + scope,
                rs -> {
                    rs.next();
                    return new AdvancesSummary(rs.getLong("total"),
                            new Bucket(rs.getLong("req_n"), rs.getBigDecimal("req_amt")),
                            new Bucket(rs.getLong("appr_n"), rs.getBigDecimal("appr_amt")),
                            rs.getLong("rec_n"), rs.getLong("rec_people"), rs.getBigDecimal("rec_amt"),
                            rs.getLong("repaid_n"), rs.getLong("written_off_n"), rs.getLong("rej_n"),
                            BigDecimal.ZERO, year.label(), year.start(), year.end());
                }, args.toArray());
        List<Object> ledgerArgs = new ArrayList<>(List.of(tenantId, year.startsAt(), year.endsBefore()));
        if (approverScope != null) ledgerArgs.add(approverScope);
        // Recoveries are negative ledger amounts: payroll deductions and
        // recorded full repayments (including a full & final settlement's).
        BigDecimal repaidThisYear = jdbc.queryForObject("""
                SELECT coalesce(-sum(l.amount), 0)
                  FROM advance_mgmt.advance_ledger_entries l
                  JOIN advance_mgmt.advance_requests ar ON ar.id = l.advance_request_id AND ar.tenant_id = l.tenant_id
                 WHERE l.tenant_id = ? AND l.entry_type IN ('REPAYMENT', 'FORECLOSE')
                   AND l.created_at >= ? AND l.created_at < ?
                """ + scope, BigDecimal.class, ledgerArgs.toArray());
        return new AdvancesSummary(counts.total(), counts.requested(), counts.approvedNotDisbursed(),
                counts.recovering(), counts.recoveringPeople(), counts.outstanding(), counts.repaid(),
                counts.writtenOff(), counts.rejected(), repaidThisYear == null ? BigDecimal.ZERO : repaidThisYear,
                counts.financialYear(), counts.financialYearStart(), counts.financialYearEnd());
    }

    @Transactional(readOnly = true)
    public MyAdvancesSummary mySummary(UUID tenantId, UUID employeeId) {
        String recovering = phaseCondition(Phase.RECOVERING);
        MyAdvancesSummary counts = jdbc.query("""
                SELECT count(*)                                                                   AS total,
                       count(*) FILTER (WHERE ar.status = 'REQUESTED')                            AS wait_n,
                       coalesce(sum(ar.amount) FILTER (WHERE ar.status = 'REQUESTED'), 0)         AS wait_amt,
                       count(*) FILTER (WHERE ar.status = 'APPROVED')                             AS appr_n,
                       coalesce(sum(ar.amount) FILTER (WHERE ar.status = 'APPROVED'), 0)          AS appr_amt,
                       count(*) FILTER (WHERE %1$s)                                               AS rec_n,
                       coalesce(sum(ar.outstanding_amount) FILTER (WHERE %1$s), 0)                AS rec_amt,
                       count(*) FILTER (WHERE %2$s)                                               AS repaid_n
                  FROM advance_mgmt.advance_requests ar
                """.formatted(recovering, phaseCondition(Phase.REPAID)) + WRITE_OFFS
                        + " WHERE ar.tenant_id = ? AND ar.employee_id = ?",
                rs -> {
                    rs.next();
                    return new MyAdvancesSummary(rs.getLong("total"),
                            new Bucket(rs.getLong("wait_n"), rs.getBigDecimal("wait_amt")),
                            new Bucket(rs.getLong("appr_n"), rs.getBigDecimal("appr_amt")),
                            rs.getLong("rec_n"), rs.getBigDecimal("rec_amt"), BigDecimal.ZERO, 0, null,
                            rs.getLong("repaid_n"));
                }, tenantId, tenantId, employeeId);
        // The installments still to come on the advances being recovered.
        record Pending(BigDecimal nextInstallments, int months, LocalDate first) {}
        Pending pending = jdbc.query("""
                WITH p AS (
                    SELECT s.advance_request_id, s.installment_no, s.scheduled_month, s.scheduled_amount
                      FROM advance_mgmt.advance_recovery_schedule s
                      JOIN advance_mgmt.advance_requests ar ON ar.id = s.advance_request_id AND ar.tenant_id = s.tenant_id
                     WHERE s.tenant_id = ? AND ar.employee_id = ? AND s.status = 'PENDING' AND %s
                )
                SELECT (SELECT coalesce(sum(n.scheduled_amount), 0) FROM (
                            SELECT DISTINCT ON (advance_request_id) scheduled_amount FROM p
                             ORDER BY advance_request_id, installment_no) n) AS next_amt,
                       (SELECT count(DISTINCT scheduled_month) FROM p)       AS months,
                       (SELECT min(scheduled_month) FROM p)                  AS first_month
                """.formatted(recovering), rs -> {
                    rs.next();
                    java.sql.Date first = rs.getDate("first_month");
                    return new Pending(rs.getBigDecimal("next_amt"), rs.getInt("months"),
                            first == null ? null : first.toLocalDate());
                }, tenantId, employeeId);
        return new MyAdvancesSummary(counts.total(), counts.waiting(), counts.approvedNotDisbursed(),
                counts.recovering(), counts.stillToRepay(), pending.nextInstallments(), pending.months(),
                pending.first() == null ? null : java.time.YearMonth.from(pending.first()).toString(),
                counts.repaid());
    }

    /** Whether this employee's login holds the HR manager role (the terminal approver is HR, else an admin). */
    @Transactional(readOnly = true)
    public boolean isHrManager(UUID tenantId, UUID employeeId) {
        Boolean hr = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM rbac.user_roles ur
                                 JOIN auth.user_credentials uc ON uc.id = ur.user_id
                                WHERE ur.tenant_id = ? AND ur.role_id = ? AND uc.employee_id = ?)
                """, Boolean.class, tenantId, HR_MANAGER_ROLE, employeeId);
        if (Boolean.TRUE.equals(hr)) return true;
        // HR manager of a company through a grant (COMPANY_ACCESS.md): the fallback picks them for that company.
        if (!com.unifiedtree.security.tenant.CompanyGrants.ready(jdbc)) return false;
        Boolean granted = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM rbac.user_company_access a
                                 JOIN auth.user_credentials uc ON uc.id = a.user_id
                                WHERE a.tenant_id = ? AND a.role_id = ? AND uc.employee_id = ?)
                """, Boolean.class, tenantId, HR_MANAGER_ROLE, employeeId);
        return Boolean.TRUE.equals(granted);
    }
}
