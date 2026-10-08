package com.unifiedtree.saas.billing;

import com.unifiedtree.saas.plans.BillingCycle;
import com.unifiedtree.saas.plans.ModulePlanService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Reads and writes for extra users at cycle end (V144_4): the daily per-company readings and a
 * cycle's peak. Used by {@link ExtraUsersJob} and by "Billing by company".
 */
@Service
public class ExtraUsersService {

    private static final Logger log = LoggerFactory.getLogger(ExtraUsersService.class);
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final long RECHECK_MS = 10 * 60 * 1000L;

    private final JdbcTemplate jdbc;
    private final ModulePlanService plans;
    private volatile boolean ready;
    private volatile long checkedAt;

    public ExtraUsersService(JdbcTemplate jdbc, ModulePlanService plans) {
        this.jdbc = jdbc;
        this.plans = plans;
    }

    /**
     * The one subscription a business's extra users are charged on: its MONTHLY subscription that covers
     * HRMS (the seats are HRMS employees), the newest if there are several. One per business: a
     * Marketing subscription in the same business is never charged for employees (review 7 Oct, E4).
     * {@code cycleStart} / {@code cycleEnd} are the cycle being charged (see {@link #cycle}); the unit
     * price is the per-user price in force for it (see {@link #unitPrice}).
     */
    public record HrmsSubscription(UUID id, UUID tenantId, String status, int seats, BigDecimal unitPriceInr,
                                   Instant nextChargeAt, LocalDate cycleStart, LocalDate cycleEnd,
                                   String razorpaySubscriptionId) {}

    private static final String HRMS_SUBSCRIPTIONS = """
            SELECT DISTINCT ON (tenant_id) id, tenant_id, status, seats, unit_price_inr, amount_inr, plan_keys, created_at,
                   next_charge_at, current_period_start, current_period_end, trial_ends_at, razorpay_subscription_id
              FROM platform.subscriptions
             WHERE billing_cycle = 'MONTHLY' AND 'hrms' = ANY(modules) AND status IN ('ACTIVE', 'PAST_DUE')
               AND razorpay_subscription_id IS NOT NULL AND next_charge_at IS NOT NULL AND tenant_id IS NOT NULL
               %s
             ORDER BY tenant_id, updated_at DESC NULLS LAST, created_at DESC
            """;

    /** Every business's HRMS subscription (one per business), ACTIVE or PAST_DUE. */
    public List<HrmsSubscription> hrmsSubscriptions() {
        return jdbc.query(HRMS_SUBSCRIPTIONS.formatted(""), (rs, n) -> hrmsSubscription(rs));
    }

    /** One business's HRMS subscription, ACTIVE or PAST_DUE. */
    public Optional<HrmsSubscription> hrmsSubscription(UUID tenantId) {
        return jdbc.query(HRMS_SUBSCRIPTIONS.formatted("AND tenant_id = ?"), (rs, n) -> hrmsSubscription(rs), tenantId)
                .stream().findFirst();
    }

    private HrmsSubscription hrmsSubscription(java.sql.ResultSet rs) throws java.sql.SQLException {
        Instant next = instant(rs.getTimestamp("next_charge_at"));
        LocalDate[] window = cycle(instant(rs.getTimestamp("current_period_start")), instant(rs.getTimestamp("current_period_end")),
                next, instant(rs.getTimestamp("trial_ends_at")));
        java.sql.Array keys = rs.getArray("plan_keys");
        String planKey = keys == null ? null : java.util.Arrays.stream((Object[]) keys.getArray())
                .filter(java.util.Objects::nonNull).map(Object::toString).findFirst().orElse(null);
        int seats = rs.getInt("seats");
        return new HrmsSubscription(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class), rs.getString("status"),
                seats, unitPrice(rs.getBigDecimal("unit_price_inr"), planKey, instant(rs.getTimestamp("created_at")),
                        rs.getBigDecimal("amount_inr"), seats),
                next, window[0], window[1], rs.getString("razorpay_subscription_id"));
    }

    /**
     * The full-month per-user price: the subscription's own unit price; for older rows that have 0
     * there (sign-ups before 10 Aug, review 7 Oct E5), the same fallback PlanChangeService uses (the
     * price in force when it was bought, from the price history), then the price actually paid
     * (amount / seats), then the catalogue. 0 only when none is known: the job then refuses to charge.
     */
    BigDecimal unitPrice(BigDecimal unit, String planKey, Instant createdAt, BigDecimal amount, int seats) {
        if (unit != null && unit.signum() > 0) return unit;
        try {
            Optional<BigDecimal> then = plans.effectiveMonthlyUnitAt(planKey, BillingCycle.MONTHLY, createdAt);
            if (then.isPresent() && then.get().signum() > 0) return then.get();
        } catch (RuntimeException e) {
            log.warn("extra users: price history for {} unreadable: {}", planKey, e.getMessage());
        }
        if (amount != null && amount.signum() > 0 && seats > 0) return amount.divide(BigDecimal.valueOf(seats), 2, RoundingMode.HALF_UP);
        try {
            return planKey == null ? BigDecimal.ZERO : plans.findLenient(planKey)
                    .map(p -> plans.effectiveMonthlyUnit(p, BillingCycle.MONTHLY)).orElse(BigDecimal.ZERO);
        } catch (RuntimeException e) {
            return BigDecimal.ZERO;
        }
    }

    /** Whether V144_4 is applied (a yes is remembered; a no is re-checked every 10 minutes). */
    public boolean ready() {
        if (ready) return true;
        long now = System.currentTimeMillis();
        if (checkedAt != 0 && now - checkedAt < RECHECK_MS) return false;
        checkedAt = now;
        try {
            ready = Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT to_regclass('platform.seat_usage_daily') IS NOT NULL AND to_regclass('platform.extra_user_charges') IS NOT NULL",
                    Boolean.class));
        } catch (RuntimeException e) {
            ready = false;
        }
        if (!ready) log.info("V144_4 not applied yet — extra users at cycle end are off until it is");
        return ready;
    }

    /** Today's reading for one business: its active employees per company (kept if higher than earlier today). */
    public void recordToday(UUID tenantId) {
        LocalDate today = LocalDate.now(IST);
        List<Map<String, Object>> rows = inTenant(tenantId, () -> jdbc.queryForList("""
                SELECT e.company_id, count(*)::int AS active
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.is_active = TRUE
                 GROUP BY e.company_id
                """, tenantId));
        for (Map<String, Object> r : rows) {
            jdbc.update("""
                    INSERT INTO platform.seat_usage_daily (tenant_id, day, company_id, active)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (tenant_id, day, company_id)
                    DO UPDATE SET active = GREATEST(platform.seat_usage_daily.active, EXCLUDED.active), updated_at = now()
                    """, tenantId, today, r.get("company_id"), ((Number) r.get("active")).intValue());
        }
    }

    /** Every reading of a business between two days (from inclusive, to exclusive), with company names. */
    public List<ExtraUsers.DayCount> readings(UUID tenantId, LocalDate from, LocalDate to) {
        Map<UUID, String> names = companyNames(tenantId);
        return jdbc.query("""
                SELECT day, company_id, active FROM platform.seat_usage_daily
                 WHERE tenant_id = ? AND day >= ? AND day < ?
                 ORDER BY day, company_id
                """, (rs, n) -> {
                    UUID company = rs.getObject("company_id", UUID.class);
                    return new ExtraUsers.DayCount(rs.getObject("day", LocalDate.class), company,
                            names.getOrDefault(company, "Company"), rs.getInt("active"));
                }, tenantId, from, to);
    }

    /**
     * The cycle being charged: the subscription's current period (IST dates, start inclusive, end
     * exclusive: the charge day starts the next cycle, so no day counts twice), or one month up to the
     * next charge (date to date) when the period isn't recorded or doesn't end at the next charge.
     * Keyed by the period, not by the next charge alone: Razorpay moves the next charge when it retries
     * a failed one (review 7 Oct, E2). No extras are counted during the free trial.
     */
    public static LocalDate[] cycle(Instant periodStart, Instant periodEnd, Instant nextChargeAt, Instant trialEndsAt) {
        LocalDate charge = nextChargeAt.atZone(IST).toLocalDate();
        LocalDate end = charge;
        LocalDate start = end.minusMonths(1);
        if (periodStart != null && periodEnd != null) {
            LocalDate ps = periodStart.atZone(IST).toLocalDate(), pe = periodEnd.atZone(IST).toLocalDate();
            if (ps.isBefore(pe) && Math.abs(java.time.temporal.ChronoUnit.DAYS.between(pe, charge)) <= 2) {
                start = ps;
                end = pe;
            }
        }
        if (trialEndsAt != null) {
            LocalDate trialEnd = trialEndsAt.atZone(IST).toLocalDate();
            if (trialEnd.isAfter(start)) start = trialEnd;
        }
        return new LocalDate[]{start, end};   // to is exclusive: the charge day starts the next cycle
    }

    /** Readings older than this are never needed again (a cycle is at most a month). */
    public void forgetOldReadings() {
        jdbc.update("DELETE FROM platform.seat_usage_daily WHERE day < ?", LocalDate.now(IST).minusDays(400));
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private Map<UUID, String> companyNames(UUID tenantId) {
        Map<UUID, String> names = new HashMap<>();
        inTenant(tenantId, () -> {
            jdbc.query("SELECT id, name FROM org.companies WHERE tenant_id = ?",
                    rs -> { names.put(rs.getObject("id", UUID.class), rs.getString("name")); }, tenantId);
            return null;
        });
        return names;
    }

    /** hrms / org are row-level secured per business: bind it for the query, then restore. */
    private <T> T inTenant(UUID tenantId, Supplier<T> work) {
        UUID before = TenantContext.getTenantId();
        UUID beforeCore = com.hrms.core.tenant.TenantContext.getTenantId();
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            return work.get();
        } finally {
            if (before == null) TenantContext.clear(); else TenantContext.setTenantId(before);
            if (beforeCore == null) com.hrms.core.tenant.TenantContext.clear(); else com.hrms.core.tenant.TenantContext.setTenantId(beforeCore);
        }
    }
}
