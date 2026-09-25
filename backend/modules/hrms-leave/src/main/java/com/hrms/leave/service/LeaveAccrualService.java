package com.hrms.leave.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.leave.dto.LeaveAccrualDtos.AccrualRunResult;
import com.hrms.leave.dto.LeaveAccrualDtos.CarryForwardLine;
import com.hrms.leave.dto.LeaveAccrualDtos.CarryForwardPreview;
import com.hrms.leave.dto.LeaveAccrualDtos.CarryForwardResult;
import com.hrms.leave.dto.LeaveAccrualDtos.LedgerEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Leave accrual and the year-end carry forward (V143.23), on
 * {@code leave_mgmt.leave_balances} with every change written to
 * {@code leave_mgmt.leave_balance_ledger}.
 *
 * <p>Every method works inside the caller's tenant: on a request thread the
 * datasource has set the tenant for the transaction; the nightly job
 * ({@code com.hrms.app.jobs.LeaveAccrualJob}) opens one transaction per tenant
 * and sets it first. Row-level security hides every other tenant's rows.
 *
 * <p>Idempotency: a monthly / quarterly credit tops the balance up to what is
 * due by today ({@link LeaveAccrualMath#entitlementToDate}) and writes the
 * period to the ledger under a unique key, so running the job twice, or on two
 * instances at once, credits a period once. The carry forward writes its
 * ledger row before touching the new year's balance and stops when that row
 * already exists.
 */
@Service
public class LeaveAccrualService {

    private static final Logger log = LoggerFactory.getLogger(LeaveAccrualService.class);
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final int PAGE = 200;
    /** Employees whose balances are kept: working, on probation, serving notice or on long leave. */
    private static final String LIVE = "e.is_active = TRUE AND e.employment_status IN ('ACTIVE','PROBATION','NOTICE_PERIOD','ON_LEAVE')";

    private final JdbcTemplate jdbc;

    public LeaveAccrualService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Today in India. Leave years and months are Indian business dates, never UTC. */
    public static LocalDate todayIst() {
        return LocalDate.now(IST);
    }

    // ── Accrual ──────────────────────────────────────────────────────────────

    private record TypeRow(UUID id, UUID companyId, String name, double quota, String frequency) {}
    private record EmpRow(UUID id, UUID tenantId, UUID companyId, LocalDate joined) {}

    private List<TypeRow> activeTypes(UUID companyId, UUID onlyType) {
        StringBuilder sql = new StringBuilder("""
                SELECT id, company_id, name, annual_entitlement, accrual_frequency
                  FROM leave_mgmt.leave_types
                 WHERE is_active = TRUE""");
        List<Object> args = new ArrayList<>();
        if (companyId != null) { sql.append(" AND company_id = ?"); args.add(companyId); }
        if (onlyType != null) { sql.append(" AND id = ?"); args.add(onlyType); }
        return jdbc.query(sql.toString(), (rs, i) -> new TypeRow(
                rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class), rs.getString("name"),
                rs.getDouble("annual_entitlement"), LeaveAccrualMath.normalizeFrequency(rs.getString("accrual_frequency"))),
                args.toArray());
    }

    /**
     * Make sure this employee has a balance for every active leave type of their
     * company in {@code year}, and credit the monthly / quarterly types up to
     * what is due today. Called whenever someone reads or uses their balance, so
     * a credit is there even if the nightly job hasn't run yet. Returns the days
     * credited.
     */
    @Transactional
    public double topUpEmployee(UUID employeeId, int year) {
        List<EmpRow> emp = jdbc.query("""
                SELECT e.id, e.tenant_id, e.company_id, e.date_of_joining
                  FROM hrms.employees e
                 WHERE e.id = ?
                """, (rs, i) -> empRow(rs), employeeId);
        if (emp.isEmpty() || emp.get(0).companyId() == null) return 0;
        EmpRow e = emp.get(0);
        List<TypeRow> types = activeTypes(e.companyId(), null);
        if (types.isEmpty()) return 0;
        LocalDate today = todayIst();
        ensureBalances(List.of(e), Map.of(e.companyId(), types), year, today);
        return creditPage(List.of(e), Map.of(e.companyId(), types), year, today, "system").days;
    }

    /**
     * One tenant's accrual: create missing balances for {@code year} and credit
     * every monthly / quarterly type up to today. {@code onlyType} limits it to
     * one leave type (HR's "credit now" and the live test use it).
     */
    @Transactional
    public AccrualRunResult accrueTenant(LocalDate today, UUID onlyType, String actor) {
        int year = today.getYear();
        Map<UUID, List<TypeRow>> byCompany = new HashMap<>();
        for (TypeRow t : activeTypes(null, onlyType)) byCompany.computeIfAbsent(t.companyId(), k -> new ArrayList<>()).add(t);
        if (byCompany.isEmpty()) return new AccrualRunResult(year, 0, 0, 0);
        int created = 0, credited = 0;
        double days = 0;
        int offset = 0;
        while (true) {
            List<EmpRow> page = jdbc.query("""
                    SELECT e.id, e.tenant_id, e.company_id, e.date_of_joining
                      FROM hrms.employees e
                     WHERE %s
                     ORDER BY e.id
                     LIMIT ? OFFSET ?
                    """.formatted(LIVE), (rs, i) -> empRow(rs), PAGE, offset);
            if (page.isEmpty()) break;
            created += ensureBalances(page, byCompany, year, today);
            Credit c = creditPage(page, byCompany, year, today, actor);
            credited += c.balances;
            days += c.days;
            if (page.size() < PAGE) break;
            offset += page.size();
        }
        return new AccrualRunResult(year, created, credited, LeaveAccrualMath.round2(days));
    }

    private static EmpRow empRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.Date d = rs.getDate("date_of_joining");
        return new EmpRow(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getObject("company_id", UUID.class), d == null ? null : d.toLocalDate());
    }

    /**
     * Create the missing balance rows. YEARLY types start with the whole quota
     * (as before); MONTHLY / QUARTERLY start at 0 and are credited by
     * {@link #creditPage}, so every accrued day is on the ledger.
     */
    private int ensureBalances(List<EmpRow> emps, Map<UUID, List<TypeRow>> byCompany, int year, LocalDate today) {
        List<Object[]> batch = new ArrayList<>();
        for (EmpRow e : emps) {
            for (TypeRow t : byCompany.getOrDefault(e.companyId(), List.of())) {
                double start = LeaveAccrualMath.isAccruing(t.frequency()) ? 0 : t.quota();
                batch.add(new Object[]{e.tenantId(), e.id(), t.id(), year, start});
            }
        }
        if (batch.isEmpty()) return 0;
        int n = 0;
        for (int r : jdbc.batchUpdate("""
                INSERT INTO leave_mgmt.leave_balances
                    (id, tenant_id, employee_id, leave_type_id, year, total_entitlement,
                     used, pending, carry_forward, created_at, updated_at, created_by, updated_by, version)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, 0, 0, 0, now(), now(), 'leave-accrual', 'leave-accrual', 0)
                ON CONFLICT ON CONSTRAINT uq_leave_balance DO NOTHING
                """, batch)) {
            if (r > 0) n++;
        }
        return n;
    }

    private record Credit(int balances, double days) {}

    /** Top every monthly / quarterly balance of these employees up to what is due by today. */
    private Credit creditPage(List<EmpRow> emps, Map<UUID, List<TypeRow>> byCompany, int year, LocalDate today, String actor) {
        List<UUID> ids = emps.stream().map(EmpRow::id).toList();
        if (ids.isEmpty()) return new Credit(0, 0);
        // Current totals in one query, so the common case (already credited) costs nothing more.
        Map<String, Double> totals = new HashMap<>();
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>(ids);
        args.add(year);
        jdbc.query("""
                SELECT employee_id, leave_type_id, total_entitlement
                  FROM leave_mgmt.leave_balances
                 WHERE employee_id IN (%s) AND year = ?
                """.formatted(in), rs -> {
            totals.put(rs.getObject("employee_id", UUID.class) + ":" + rs.getObject("leave_type_id", UUID.class),
                    rs.getDouble("total_entitlement"));
        }, args.toArray());
        int balances = 0;
        double days = 0;
        for (EmpRow e : emps) {
            for (TypeRow t : byCompany.getOrDefault(e.companyId(), List.of())) {
                if (!LeaveAccrualMath.isAccruing(t.frequency())) continue;
                double target = LeaveAccrualMath.entitlementToDate(t.frequency(), t.quota(), e.joined(), year, today);
                Double have = totals.get(e.id() + ":" + t.id());
                if (have == null || target - have < 0.01) continue;
                double added = credit(e, t, year, today, target, actor);
                if (added > 0) { balances++; days += added; }
            }
        }
        return new Credit(balances, days);
    }

    /**
     * Raise one balance to {@code target}, writing the difference to the ledger
     * under this period's key. The ledger insert and the balance update are one
     * statement: if the period is already on the ledger, nothing changes.
     */
    private double credit(EmpRow e, TypeRow t, int year, LocalDate today, double target, String actor) {
        int period = year < today.getYear() ? LeaveAccrualMath.periodsPerYear(t.frequency()) : LeaveAccrualMath.periodOf(t.frequency(), today);
        String key = LeaveAccrualMath.periodKey(t.frequency(), year, period);
        String note = "%s credit for %s: %s of %s days a year credited so far".formatted(
                LeaveAccrualMath.MONTHLY.equals(t.frequency()) ? "Monthly" : "Quarterly",
                LeaveAccrualMath.periodLabel(t.frequency(), year, period),
                fmt(target), fmt(t.quota()));
        List<Double> added = jdbc.query("""
                WITH b AS (
                    SELECT id, total_entitlement
                      FROM leave_mgmt.leave_balances
                     WHERE employee_id = ? AND leave_type_id = ? AND year = ?
                     FOR UPDATE
                ), ins AS (
                    INSERT INTO leave_mgmt.leave_balance_ledger
                        (tenant_id, employee_id, leave_type_id, year, kind, period, days, note, created_by)
                    SELECT ?, ?, ?, ?, 'ACCRUAL', ?, ROUND(CAST(? AS numeric) - CAST(b.total_entitlement AS numeric), 2), ?, ?
                      FROM b
                     WHERE CAST(? AS numeric) - CAST(b.total_entitlement AS numeric) >= 0.01
                    ON CONFLICT (tenant_id, employee_id, leave_type_id, kind, period) DO NOTHING
                    RETURNING days
                )
                UPDATE leave_mgmt.leave_balances lb
                   SET total_entitlement = lb.total_entitlement + ins.days,
                       accrued = LEAST(999.99, lb.accrued + ins.days),
                       updated_at = now(), updated_by = ?, version = lb.version + 1
                  FROM ins, b
                 WHERE lb.id = b.id
                RETURNING CAST(ins.days AS double precision)
                """, (rs, i) -> rs.getDouble(1),
                e.id(), t.id(), year,
                e.tenantId(), e.id(), t.id(), year, key, target, note, actor,
                target,
                actor);
        return added.isEmpty() ? 0 : added.get(0);
    }

    // ── Year-end carry forward ───────────────────────────────────────────────

    private record BalanceRow(UUID employeeId, String name, String code, UUID leaveTypeId, String typeName,
                              boolean carryAllowed, Integer cap, double quota, String frequency, UUID tenantId,
                              double unused, boolean done) {}

    private List<BalanceRow> yearEndRows(int fromYear, UUID onlyType) {
        StringBuilder sql = new StringBuilder("""
                SELECT b.employee_id, b.tenant_id, b.leave_type_id,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS emp_name,
                       e.employee_code, lt.name AS type_name, lt.carry_forward, lt.carry_forward_max_days,
                       lt.annual_entitlement, lt.accrual_frequency,
                       (b.total_entitlement + b.carry_forward - b.used - b.pending) AS unused,
                       EXISTS (SELECT 1 FROM leave_mgmt.leave_balance_ledger l
                                WHERE l.employee_id = b.employee_id AND l.leave_type_id = b.leave_type_id
                                  AND l.kind IN ('CARRY_FORWARD','LAPSE') AND l.period = ?) AS done
                  FROM leave_mgmt.leave_balances b
                  JOIN leave_mgmt.leave_types lt ON lt.id = b.leave_type_id
                  JOIN hrms.employees e ON e.id = b.employee_id
                 WHERE b.year = ? AND %s""".formatted(LIVE));
        List<Object> args = new ArrayList<>(List.of(yearEndKey(fromYear), fromYear));
        if (onlyType != null) { sql.append(" AND b.leave_type_id = ?"); args.add(onlyType); }
        sql.append(" ORDER BY emp_name, type_name");
        return jdbc.query(sql.toString(), (rs, i) -> {
            int capRaw = rs.getInt("carry_forward_max_days");
            Integer cap = rs.wasNull() ? null : capRaw;
            return new BalanceRow(rs.getObject("employee_id", UUID.class), rs.getString("emp_name"),
                    rs.getString("employee_code"), rs.getObject("leave_type_id", UUID.class), rs.getString("type_name"),
                    rs.getBoolean("carry_forward"), cap, rs.getDouble("annual_entitlement"),
                    LeaveAccrualMath.normalizeFrequency(rs.getString("accrual_frequency")),
                    rs.getObject("tenant_id", UUID.class), rs.getDouble("unused"), rs.getBoolean("done"));
        }, args.toArray());
    }

    static String yearEndKey(int fromYear) {
        return "YE-" + fromYear;
    }

    private static void requireEnded(int fromYear, LocalDate today) {
        if (fromYear >= today.getYear()) {
            throw new BusinessRuleException(
                    "The %d leave year hasn't ended yet. Unused days can be carried forward from 1 January %d."
                            .formatted(fromYear, fromYear + 1),
                    "LEAVE_YEAR_NOT_ENDED");
        }
        if (fromYear < today.getYear() - 5) {
            throw new BusinessRuleException("Pick one of the last five leave years.", "LEAVE_YEAR_TOO_OLD");
        }
    }

    /** What the carry forward from {@code fromYear} will do (or did), line by line. Changes nothing. */
    @Transactional(readOnly = true)
    public CarryForwardPreview previewCarryForward(int fromYear, UUID onlyType, LocalDate today) {
        requireEnded(fromYear, today);
        List<CarryForwardLine> lines = new ArrayList<>();
        double carried = 0, lapsed = 0;
        int done = 0;
        for (BalanceRow r : yearEndRows(fromYear, onlyType)) {
            double[] split = LeaveAccrualMath.carryForward(r.unused(), r.carryAllowed(), r.cap());
            if (split[0] == 0 && split[1] == 0 && !r.done()) continue;
            lines.add(new CarryForwardLine(r.employeeId(), r.name(), r.code(), r.leaveTypeId(), r.typeName(),
                    LeaveAccrualMath.round2(Math.max(0, r.unused())), split[0], split[1], r.done()));
            if (r.done()) done++;
            else { carried += split[0]; lapsed += split[1]; }
        }
        return new CarryForwardPreview(fromYear, fromYear + 1, lines,
                LeaveAccrualMath.round2(carried), LeaveAccrualMath.round2(lapsed), done);
    }

    /**
     * Carry unused days from {@code fromYear} into the next year, up to each
     * type's cap, and lapse the rest. Each employee × type is done once: its
     * ledger rows are written first and a line that already has them is skipped.
     */
    @Transactional
    public CarryForwardResult runCarryForward(int fromYear, UUID onlyType, String actor, LocalDate today) {
        requireEnded(fromYear, today);
        int toYear = fromYear + 1;
        String key = yearEndKey(fromYear);
        int processed = 0, skipped = 0;
        double carried = 0, lapsed = 0;
        for (BalanceRow r : yearEndRows(fromYear, onlyType)) {
            if (r.done()) { skipped++; continue; }
            double[] split = LeaveAccrualMath.carryForward(r.unused(), r.carryAllowed(), r.cap());
            if (split[0] == 0 && split[1] == 0) continue;
            boolean first;
            if (split[0] > 0) {
                first = ledger(r, toYear, "CARRY_FORWARD", key, split[0],
                        "Carried forward from %d: %s of %s unused days%s".formatted(fromYear, fmt(split[0]), fmt(r.unused()),
                                r.cap() != null && r.cap() > 0 ? " (cap " + r.cap() + ")" : ""), actor);
                if (first && split[1] > 0) {
                    ledger(r, fromYear, "LAPSE", key, split[1],
                            "Lapsed at the end of %d: above the carry-forward cap of %d days".formatted(fromYear, r.cap()), actor);
                }
            } else {
                first = ledger(r, fromYear, "LAPSE", key, split[1],
                        r.carryAllowed()
                                ? "Lapsed at the end of %d: the carry-forward cap is 0 days".formatted(fromYear)
                                : "Lapsed at the end of %d: this leave type doesn't carry forward".formatted(fromYear), actor);
            }
            if (!first) { skipped++; continue; }
            if (split[0] > 0) {
                double start = LeaveAccrualMath.isAccruing(r.frequency()) ? 0 : r.quota();
                jdbc.update("""
                        INSERT INTO leave_mgmt.leave_balances
                            (id, tenant_id, employee_id, leave_type_id, year, total_entitlement,
                             used, pending, carry_forward, created_at, updated_at, created_by, updated_by, version)
                        VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, 0, 0, ?, now(), now(), ?, ?, 0)
                        ON CONFLICT ON CONSTRAINT uq_leave_balance
                        DO UPDATE SET carry_forward = EXCLUDED.carry_forward, updated_at = now(),
                                      updated_by = EXCLUDED.updated_by, version = leave_mgmt.leave_balances.version + 1
                        """, r.tenantId(), r.employeeId(), r.leaveTypeId(), toYear, start, split[0], actor, actor);
            }
            processed++;
            carried += split[0];
            lapsed += split[1];
        }
        log.info("Leave carry forward {} → {}: {} line(s), {} carried, {} lapsed, {} already done",
                fromYear, toYear, processed, fmt(carried), fmt(lapsed), skipped);
        return new CarryForwardResult(fromYear, toYear, processed, skipped,
                LeaveAccrualMath.round2(carried), LeaveAccrualMath.round2(lapsed));
    }

    /** Insert one ledger row; false when that (employee, type, kind, period) is already there. */
    private boolean ledger(BalanceRow r, int year, String kind, String period, double days, String note, String actor) {
        return jdbc.update("""
                INSERT INTO leave_mgmt.leave_balance_ledger
                    (tenant_id, employee_id, leave_type_id, year, kind, period, days, note, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, employee_id, leave_type_id, kind, period) DO NOTHING
                """, r.tenantId(), r.employeeId(), r.leaveTypeId(), year, kind, period, days, note, actor) > 0;
    }

    // ── Ledger ───────────────────────────────────────────────────────────────

    /** The audit trail, newest first. Every filter is optional. */
    @Transactional(readOnly = true)
    public List<LedgerEntry> ledger(UUID employeeId, UUID leaveTypeId, Integer year, String kind, int limit) {
        StringBuilder sql = new StringBuilder("""
                SELECT l.id, l.employee_id, l.leave_type_id, l.year, l.kind, l.period,
                       CAST(l.days AS double precision) AS days, l.note, l.created_at, l.created_by,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS emp_name,
                       e.employee_code, lt.name AS type_name
                  FROM leave_mgmt.leave_balance_ledger l
                  LEFT JOIN hrms.employees e ON e.id = l.employee_id
                  LEFT JOIN leave_mgmt.leave_types lt ON lt.id = l.leave_type_id
                 WHERE 1 = 1""");
        List<Object> args = new ArrayList<>();
        if (employeeId != null) { sql.append(" AND l.employee_id = ?"); args.add(employeeId); }
        if (leaveTypeId != null) { sql.append(" AND l.leave_type_id = ?"); args.add(leaveTypeId); }
        if (year != null) { sql.append(" AND l.year = ?"); args.add(year); }
        if (kind != null && !kind.isBlank()) { sql.append(" AND l.kind = ?"); args.add(kind.trim().toUpperCase(java.util.Locale.ROOT)); }
        sql.append(" ORDER BY l.created_at DESC, l.id LIMIT ?");
        args.add(Math.max(1, Math.min(limit, 500)));
        return jdbc.query(sql.toString(), (rs, i) -> {
            Timestamp at = rs.getTimestamp("created_at");
            return new LedgerEntry(rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                    rs.getString("emp_name"), rs.getString("employee_code"), rs.getObject("leave_type_id", UUID.class),
                    rs.getString("type_name"), rs.getInt("year"), rs.getString("kind"), rs.getString("period"),
                    rs.getDouble("days"), rs.getString("note"), at == null ? null : at.toInstant(), rs.getString("created_by"));
        }, args.toArray());
    }

    static String fmt(double d) {
        double r = LeaveAccrualMath.round2(d);
        return r == Math.rint(r) ? String.valueOf((long) r) : String.valueOf(r);
    }
}
