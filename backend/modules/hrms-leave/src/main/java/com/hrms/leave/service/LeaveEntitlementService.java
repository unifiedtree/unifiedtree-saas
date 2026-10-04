package com.hrms.leave.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeaveEntitlementDtos.ApplyPreview;
import com.hrms.leave.dto.LeaveEntitlementDtos.ApplyResult;
import com.hrms.leave.dto.LeaveEntitlementDtos.BelowZero;
import com.hrms.leave.dto.LeaveEntitlementDtos.Change;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * "Apply to all employees" on a leave type (4 Oct 2026).
 *
 * <p><b>Why.</b> A balance is made once a year per person ({@link LeaveAccrualService}:
 * the first time they open their leave or apply, or when the nightly job runs)
 * with the type's days at that moment. Editing the type later changes only the
 * type. So when a business changed Annual Leave from 21 to 1 day a year, Leave
 * types said 1 while every balance, on the web and in the app, still said 21,
 * and nothing let an admin give everyone the same days for a type.
 *
 * <p><b>What.</b> For one leave type and the current leave year, everyone still
 * working in the type's company gets the balance the type gives today: the whole
 * quota for an upfront (YEARLY) type; for a monthly or quarterly type, what is
 * due by today from their joining date ({@link LeaveAccrualMath#entitlementToDate},
 * the figure the nightly credit works to). Only the entitlement changes. Days
 * carried in, used and pending stay, so someone who already took more than the
 * new number shows a balance below 0 (the preview names them). A missing
 * balance is created. Balances of people who have left, and of past years, are
 * never touched.
 *
 * <p><b>Safety.</b> Saving a leave type changes no balance: the admin previews,
 * then applies. Applying is one transaction. It re-reads the type under a row
 * lock and refuses when its days are not the ones the admin previewed. Every
 * update bumps the balance's version, so a leave request saved at the same
 * moment from an older copy fails instead of writing the old number back.
 * Applying twice changes nothing the second time. Each changed balance also
 * goes on the balance audit trail as an ADJUSTMENT once V143.71 is applied;
 * until then that step is skipped and everything else works.
 */
@Service
public class LeaveEntitlementService {

    private static final Logger log = LoggerFactory.getLogger(LeaveEntitlementService.class);
    /** How many below-zero people the preview names (the count is always complete). */
    static final int NAMED = 20;
    private static final double EPS = 0.005;

    private final JdbcTemplate jdbc;

    public LeaveEntitlementService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private record TypeRow(UUID id, UUID companyId, String name, double quota, String frequency, boolean active) {}

    /** Someone still working in the type's company, with their balance of the type this year ({@code balanceId} null: none yet). */
    record Holder(UUID employeeId, String name, String code, LocalDate joined,
                  UUID balanceId, double total, double carry, double used, double pending) {}

    /** One balance to change ({@code adding} false) or to create. */
    record Step(Holder holder, double target, boolean adding) {
        double availableAfter() {
            return LeaveAccrualMath.round2(target + holder.carry() - holder.used() - holder.pending());
        }

        boolean belowZero() {
            return !adding && availableAfter() < 0;
        }
    }

    /** What applying would do: the balances to change or create, and how many already match. */
    record Plan(List<Step> steps, int unchanged) {
        int changing() {
            return (int) steps.stream().filter(s -> !s.adding()).count();
        }

        int adding() {
            return (int) steps.stream().filter(Step::adding).count();
        }

        int people() {
            return steps.size() + unchanged;
        }

        int belowZero() {
            return (int) steps.stream().filter(Step::belowZero).count();
        }

        /** The changes grouped by (from, to), most people first. */
        List<Change> changes() {
            Map<String, double[]> groups = new LinkedHashMap<>();
            for (Step s : steps) {
                if (s.adding()) continue;
                double from = LeaveAccrualMath.round2(s.holder().total());
                double to = LeaveAccrualMath.round2(s.target());
                groups.computeIfAbsent(from + ">" + to, k -> new double[]{from, to, 0})[2]++;
            }
            return groups.values().stream()
                    .map(g -> new Change(g[0], g[1], (int) g[2]))
                    .sorted(Comparator.comparingInt(Change::people).reversed()
                            .thenComparing(Comparator.comparingDouble(Change::from).reversed()))
                    .toList();
        }

        /** Who would show below 0, most overdrawn first, at most {@code max}. */
        List<BelowZero> belowZeroPeople(int max) {
            return steps.stream()
                    .filter(Step::belowZero)
                    .sorted(Comparator.comparingDouble(Step::availableAfter))
                    .limit(max)
                    .map(s -> new BelowZero(s.holder().employeeId(), s.holder().name(), s.holder().code(),
                            LeaveAccrualMath.round2(s.holder().used() + s.holder().pending()), s.availableAfter()))
                    .toList();
        }
    }

    /**
     * The balance each person should hold by {@code today}, and what that
     * changes. Pure, so the rules are tested without a database.
     */
    static Plan plan(List<Holder> holders, String frequency, double quota, int year, LocalDate today) {
        List<Step> steps = new ArrayList<>();
        int unchanged = 0;
        for (Holder h : holders) {
            double target = LeaveAccrualMath.entitlementToDate(frequency, quota, h.joined(), year, today);
            if (h.balanceId() == null) {
                steps.add(new Step(h, target, true));
            } else if (Math.abs(h.total() - target) < EPS) {
                unchanged++;
            } else {
                steps.add(new Step(h, target, false));
            }
        }
        return new Plan(steps, unchanged);
    }

    /** What applying the type to everyone would do this leave year. Changes nothing. */
    @Transactional(readOnly = true)
    public ApplyPreview preview(UUID leaveTypeId, LocalDate today) {
        TypeRow type = type(leaveTypeId, false);
        int year = today.getYear();
        Plan plan = plan(holders(type, year, false), type.frequency(), type.quota(), year, today);
        return new ApplyPreview(type.id(), type.name(), year, LeaveAccrualMath.round2(type.quota()), type.frequency(),
                plan.people(), plan.changing(), plan.adding(), plan.unchanged(), plan.belowZero(),
                plan.changes(), plan.belowZeroPeople(NAMED), ledgerReady());
    }

    /**
     * Give everyone still working in the type's company the balance the type
     * gives today, for this leave year. {@code expectedDays}: the days a year
     * the admin previewed; when the type now says something else the call is
     * refused and nothing changes (null skips that check).
     */
    @Transactional
    public ApplyResult apply(UUID leaveTypeId, Double expectedDays, String actor, LocalDate today) {
        TypeRow type = type(leaveTypeId, true);
        if (expectedDays != null && Math.abs(expectedDays - type.quota()) >= EPS) {
            throw new BusinessRuleException(
                    "%s now gives %s a year, not %s. Look at the preview again, then apply."
                            .formatted(type.name(), days(type.quota()), days(expectedDays)),
                    "LEAVE_TYPE_CHANGED");
        }
        int year = today.getYear();
        Plan plan = plan(holders(type, year, true), type.frequency(), type.quota(), year, today);
        UUID tenant = tenant();
        String by = actor == null || actor.isBlank() ? "system" : actor;

        List<Object[]> updates = new ArrayList<>(), inserts = new ArrayList<>();
        for (Step s : plan.steps()) {
            if (s.adding()) {
                inserts.add(new Object[]{tenant, s.holder().employeeId(), type.id(), year, s.target(), by, by});
            } else {
                updates.add(new Object[]{s.target(), by, s.holder().balanceId()});
            }
        }
        if (!updates.isEmpty()) {
            jdbc.batchUpdate("""
                    UPDATE leave_mgmt.leave_balances
                       SET total_entitlement = ?, updated_at = now(), updated_by = ?, version = version + 1
                     WHERE id = ?
                    """, updates);
        }
        if (!inserts.isEmpty()) {
            // Someone opening their leave at this moment may create the row first
            // (with the type's whole quota); it is then set to the same figure.
            jdbc.batchUpdate("""
                    INSERT INTO leave_mgmt.leave_balances
                        (id, tenant_id, employee_id, leave_type_id, year, total_entitlement,
                         used, pending, carry_forward, created_at, updated_at, created_by, updated_by, version)
                    VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, 0, 0, 0, now(), now(), ?, ?, 0)
                    ON CONFLICT ON CONSTRAINT uq_leave_balance
                    DO UPDATE SET total_entitlement = EXCLUDED.total_entitlement, updated_at = now(),
                                  updated_by = EXCLUDED.updated_by, version = leave_mgmt.leave_balances.version + 1
                    """, inserts);
        }
        boolean ledger = !updates.isEmpty() && ledgerReady();
        if (ledger) {
            // One key per run, so the ledger's (employee, type, kind, period) key never refuses a later run.
            String period = "SET-" + year + "-" + UUID.randomUUID();
            List<Object[]> rows = new ArrayList<>();
            for (Step s : plan.steps()) {
                if (s.adding()) continue;
                double was = LeaveAccrualMath.round2(s.holder().total());
                rows.add(new Object[]{tenant, s.holder().employeeId(), type.id(), year, period,
                        LeaveAccrualMath.round2(s.target() - was),
                        "%s set to %s for %d (was %s) when HR gave everyone the same days"
                                .formatted(type.name(), days(s.target()), year, days(was)),
                        by});
            }
            jdbc.batchUpdate("""
                    INSERT INTO leave_mgmt.leave_balance_ledger
                        (tenant_id, employee_id, leave_type_id, year, kind, period, days, note, created_by)
                    VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?)
                    ON CONFLICT (tenant_id, employee_id, leave_type_id, kind, period) DO NOTHING
                    """, rows);
        }
        log.info("Leave type {} applied to everyone for {}: {} changed, {} added, {} unchanged, {} below zero, ledger {}",
                type.id(), year, plan.changing(), plan.adding(), plan.unchanged(), plan.belowZero(), ledger);
        return new ApplyResult(type.id(), type.name(), year, LeaveAccrualMath.round2(type.quota()), plan.people(),
                plan.changing(), plan.adding(), plan.unchanged(), plan.belowZero(), ledger);
    }

    // ── reads ────────────────────────────────────────────────────────────────

    private TypeRow type(UUID leaveTypeId, boolean lock) {
        List<TypeRow> rows = jdbc.query("""
                SELECT id, company_id, name, annual_entitlement, accrual_frequency, is_active
                  FROM leave_mgmt.leave_types
                 WHERE id = ? AND tenant_id = ?""" + (lock ? " FOR UPDATE" : ""),
                (rs, i) -> new TypeRow(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                        rs.getString("name"), rs.getDouble("annual_entitlement"),
                        LeaveAccrualMath.normalizeFrequency(rs.getString("accrual_frequency")), rs.getBoolean("is_active")),
                leaveTypeId, tenant());
        if (rows.isEmpty()) throw new ResourceNotFoundException("LeaveType", leaveTypeId);
        TypeRow type = rows.get(0);
        if (!type.active()) {
            throw new BusinessRuleException(
                    "%s is turned off. Turn it back on before giving it to everyone.".formatted(type.name()),
                    "LEAVE_TYPE_INACTIVE");
        }
        return type;
    }

    /** Everyone still working in the type's company, with their balance of it for {@code year}; locked when applying. */
    private List<Holder> holders(TypeRow type, int year, boolean lock) {
        UUID tenant = tenant();
        Map<UUID, Object[]> balances = new HashMap<>();
        jdbc.query("""
                SELECT id, employee_id, total_entitlement, carry_forward, used, pending
                  FROM leave_mgmt.leave_balances
                 WHERE tenant_id = ? AND leave_type_id = ? AND year = ?""" + (lock ? " FOR UPDATE" : ""),
                rs -> {
                    balances.put(rs.getObject("employee_id", UUID.class), new Object[]{
                            rs.getObject("id", UUID.class), rs.getDouble("total_entitlement"),
                            rs.getDouble("carry_forward"), rs.getDouble("used"), rs.getDouble("pending")});
                }, tenant, type.id(), year);
        return jdbc.query("""
                SELECT e.id, e.employee_code, e.date_of_joining,
                       NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS emp_name
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.company_id = ? AND %s
                 ORDER BY LOWER(COALESCE(e.first_name, '')), LOWER(COALESCE(e.last_name, '')), e.id
                """.formatted(LeaveAccrualService.LIVE), (rs, i) -> {
            UUID id = rs.getObject("id", UUID.class);
            java.sql.Date joined = rs.getDate("date_of_joining");
            Object[] b = balances.get(id);
            return new Holder(id, rs.getString("emp_name"), rs.getString("employee_code"),
                    joined == null ? null : joined.toLocalDate(),
                    b == null ? null : (UUID) b[0],
                    b == null ? 0 : (double) b[1], b == null ? 0 : (double) b[2],
                    b == null ? 0 : (double) b[3], b == null ? 0 : (double) b[4]);
        }, tenant, type.companyId());
    }

    /**
     * Whether the balance audit trail accepts ADJUSTMENT rows: V143.71 widened
     * its kind check. Read from the catalogue so it is safe inside the
     * transaction (a refused insert would abort it).
     */
    boolean ledgerReady() {
        try {
            Boolean ok = jdbc.queryForObject("""
                    SELECT to_regclass('leave_mgmt.leave_balance_ledger') IS NOT NULL
                       AND NOT EXISTS (
                            SELECT 1 FROM pg_constraint c
                             WHERE c.conrelid = to_regclass('leave_mgmt.leave_balance_ledger') AND c.contype = 'c'
                               AND pg_get_constraintdef(c.oid) LIKE '%kind%'
                               AND pg_get_constraintdef(c.oid) NOT LIKE '%''ADJUSTMENT''%')
                    """, Boolean.class);
            return Boolean.TRUE.equals(ok);
        } catch (DataAccessException e) {
            log.warn("Could not read the leave ledger's kind check: {}", e.getMessage());
            return false;
        }
    }

    /** "1 day", "0 days", "1.5 days". */
    static String days(double d) {
        return LeaveAccrualService.fmt(d) + (LeaveAccrualMath.round2(d) == 1 ? " day" : " days");
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No workspace is selected.", "TENANT_REQUIRED");
        return t;
    }
}
