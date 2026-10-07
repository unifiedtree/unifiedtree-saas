package com.unifiedtree.saas.billing;

import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
    private volatile boolean ready;
    private volatile long checkedAt;

    public ExtraUsersService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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
     * The cycle that ends at {@code nextChargeAt}: from one month before (date to date) — or from the
     * end of the free trial, if that is later: no extras are counted during the trial — up to the
     * day before the charge (the charge day starts the next cycle, so no day counts twice).
     */
    public static LocalDate[] cycle(Instant nextChargeAt, Instant trialEndsAt) {
        LocalDate end = nextChargeAt.atZone(IST).toLocalDate();
        LocalDate start = end.minusMonths(1);
        if (trialEndsAt != null) {
            LocalDate trialEnd = trialEndsAt.atZone(IST).toLocalDate();
            if (trialEnd.isAfter(start)) start = trialEnd;
        }
        return new LocalDate[]{start, end};   // to is exclusive: the charge day starts the next cycle
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
