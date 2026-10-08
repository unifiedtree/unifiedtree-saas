package com.unifiedtree.saas.billing;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Billing by company (owner decision, 6 Oct 2026, option a): the business keeps ONE subscription
 * and ONE autopay this week; this splits the current cycle's amount across its HRMS companies.
 *
 * <p>Each company's line = its active employees (counted exactly like the seat count:
 * {@code hrms.employees.is_active}) × the price of one seat for the cycle
 * ({@code amount_inr / seats}). Seats bought but not used are their own line, so the lines add up
 * to the cycle's amount. Employees beyond the bought seats are shown as extra users billed at the
 * end of the cycle (soft seat limit), not in the cycle's amount.
 *
 * <p>This is a breakdown statement, not a GST tax invoice: Razorpay issues the business's
 * invoice for each charge. Per-company invoices come with per-company subscriptions (next week).
 *
 * <p>Each company's legal name, GSTIN, PAN and address come from {@link CompanyBillingDetails}, the
 * same resolver the invoice snapshot uses, so both show the same details for a company.
 */
@Service
public class BillingBreakdownService {

    private final JdbcTemplate jdbc;
    private final CompanyBillingDetails details;
    private final ExtraUsersService extras;

    public BillingBreakdownService(JdbcTemplate jdbc, CompanyBillingDetails details, ExtraUsersService extras) {
        this.jdbc = jdbc;
        this.details = details;
        this.extras = extras;
    }

    public Breakdown forTenant(UUID tenantId) {
        Business business = jdbc.query("""
                SELECT display_name, gstin, pan, address_line1, address_line2, city, state, postal_code
                  FROM platform.tenants WHERE id = ?
                """, rs -> rs.next() ? new Business(rs.getString("display_name"), rs.getString("gstin"), rs.getString("pan"),
                        join(rs.getString("address_line1"), rs.getString("address_line2"), rs.getString("city"),
                                rs.getString("state"), rs.getString("postal_code"))) : null, tenantId);

        Cycle cycle = jdbc.query("""
                SELECT seats, amount_inr, billing_cycle, status, current_period_start, current_period_end, trial_ends_at
                  FROM platform.subscriptions
                 WHERE tenant_id = ?
                   AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'HALTED', 'GRACE')
                 ORDER BY ('hrms' = ANY(modules)) DESC, updated_at DESC NULLS LAST, created_at DESC
                 LIMIT 1
                """, rs -> rs.next() ? new Cycle(rs.getInt("seats"), rs.getBigDecimal("amount_inr"), rs.getString("billing_cycle"),
                        rs.getString("status"), instant(rs.getTimestamp("current_period_start")),
                        instant(rs.getTimestamp("current_period_end")), instant(rs.getTimestamp("trial_ends_at"))) : null, tenantId);

        List<CompanyRow> rows = companies(tenantId);
        return split(business, cycle, rows).withExtraCharge(extraCharge(tenantId));
    }

    /**
     * This cycle's extra users (owner, 7 Oct 2026; ExtraUsersJob): from the cycle's record once the
     * notice has gone out (3 days before the charge), otherwise counted so far from the daily readings.
     * Monthly plans only; null without V144_4, without a monthly paid subscription, or in the trial.
     */
    ExtraCharge extraCharge(UUID tenantId) {
        if (!extras.ready()) return null;
        // The same subscription, cycle and price the job charges (ExtraUsersService.hrmsSubscription).
        ExtraUsersService.HrmsSubscription sub = extras.hrmsSubscription(tenantId).orElse(null);
        if (sub == null) return null;
        LocalDate chargeOn = sub.nextChargeAt().atZone(ExtraUsersService.IST).toLocalDate();

        List<Map<String, Object>> recorded = jdbc.queryForList("""
                SELECT extra_users, amount_inr, status, peak_active, peak_day, by_company::text AS by_company
                  FROM platform.extra_user_charges WHERE tenant_id = ? AND cycle_end = ?
                """, tenantId, sub.cycleEnd());
        if (!recorded.isEmpty()) {
            Map<String, Object> r = recorded.get(0);
            return new ExtraCharge(chargeOn, (String) r.get("status"), ((Number) r.get("extra_users")).intValue(),
                    (BigDecimal) r.get("amount_inr"), ((Number) r.get("peak_active")).intValue(),
                    r.get("peak_day") == null ? null : ((java.sql.Date) r.get("peak_day")).toLocalDate(),
                    parseShares((String) r.get("by_company")));
        }
        if (!sub.cycleStart().isBefore(sub.cycleEnd())) return null;   // still in the free trial
        ExtraUsers.Result r = ExtraUsers.compute(sub.seats(), sub.unitPriceInr(),
                extras.readings(tenantId, sub.cycleStart(), sub.cycleEnd()));
        return new ExtraCharge(chargeOn, "SO_FAR", r.extraUsers(), r.amountInr(), r.peakActive(), r.peakDay(), r.byCompany());
    }

    private static List<ExtraUsers.CompanyShare> parseShares(String json) {
        try {
            return List.of(new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, ExtraUsers.CompanyShare[].class));
        } catch (Exception e) {
            return List.of();
        }
    }

    /** The business's companies with their active employees (RLS: read with the tenant bound). */
    private List<CompanyRow> companies(UUID tenantId) {
        java.util.Map<UUID, CompanyBillingDetails.Details> billing = details.companies(tenantId);
        UUID before = TenantContext.getTenantId();
        UUID beforeCore = com.hrms.core.tenant.TenantContext.getTenantId();
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            return jdbc.query("""
                    SELECT c.id, c.name, c.is_active,
                           (SELECT count(*) FROM hrms.employees e
                             WHERE e.tenant_id = c.tenant_id AND e.company_id = c.id AND e.is_active = TRUE) AS employees
                      FROM org.companies c
                     WHERE c.tenant_id = ?
                     ORDER BY c.name
                    """, (rs, n) -> {
                        UUID id = rs.getObject("id", UUID.class);
                        CompanyBillingDetails.Details d = billing.get(id);
                        return new CompanyRow(id, rs.getString("name"), d == null ? null : d.legalName(),
                                d == null ? null : d.gstin(), d == null ? null : d.pan(), rs.getBoolean("is_active"),
                                d == null ? null : d.address(), rs.getInt("employees"));
                    }, tenantId);
        } finally {
            if (before == null) TenantContext.clear(); else TenantContext.setTenantId(before);
            if (beforeCore == null) com.hrms.core.tenant.TenantContext.clear(); else com.hrms.core.tenant.TenantContext.setTenantId(beforeCore);
        }
    }

    /** The arithmetic, separate so it can be tested without a database. */
    static Breakdown split(Business business, Cycle cycle, List<CompanyRow> rows) {
        // An archived company stays on the statement only while people still count against it.
        List<CompanyRow> shown = rows.stream().filter(r -> r.active() || r.employees() > 0).toList();
        int used = shown.stream().mapToInt(CompanyRow::employees).sum();

        if (cycle == null || cycle.seats() <= 0 || cycle.amountInr() == null) {
            List<CompanyLine> lines = shown.stream().map(r -> new CompanyLine(r.id(), r.name(), r.legalName(), r.gstin(),
                    r.pan(), r.address(), r.employees(), null)).toList();
            return new Breakdown(business, null, null, null, null, null, 0, used, null, lines, 0, null, Math.max(0, used), null,
                    "No paid subscription yet: amounts appear once autopay is set up.");
        }

        BigDecimal perSeat = cycle.amountInr().divide(BigDecimal.valueOf(cycle.seats()), 6, RoundingMode.HALF_UP);
        int covered = Math.min(used, cycle.seats());
        int unused = Math.max(0, cycle.seats() - used);
        int extra = Math.max(0, used - cycle.seats());

        // Within the bought seats each employee costs one seat; when there are more employees than
        // seats, the cycle's amount is shared in proportion (the extras are billed at cycle end).
        BigDecimal billedPerEmployee = used == 0 ? BigDecimal.ZERO
                : perSeat.multiply(BigDecimal.valueOf(covered)).divide(BigDecimal.valueOf(used), 6, RoundingMode.HALF_UP);
        List<CompanyLine> lines = new ArrayList<>();
        for (CompanyRow r : shown) {
            lines.add(new CompanyLine(r.id(), r.name(), r.legalName(), r.gstin(), r.pan(), r.address(), r.employees(),
                    money(billedPerEmployee.multiply(BigDecimal.valueOf(r.employees())))));
        }
        BigDecimal unusedAmount = money(perSeat.multiply(BigDecimal.valueOf(unused)));

        // Rounding: the lines must add up to exactly what is charged.
        BigDecimal total = money(cycle.amountInr());
        BigDecimal sum = lines.stream().map(CompanyLine::amountInr).reduce(BigDecimal.ZERO, BigDecimal::add).add(unusedAmount);
        BigDecimal diff = total.subtract(sum);
        if (diff.signum() != 0) {
            if (unused > 0 || lines.isEmpty()) {
                unusedAmount = unusedAmount.add(diff);
            } else {
                CompanyLine biggest = lines.stream().max(Comparator.comparing(CompanyLine::amountInr)).orElseThrow();
                lines.set(lines.indexOf(biggest), biggest.withAmount(biggest.amountInr().add(diff)));
            }
        }

        boolean trial = cycle.trialEndsAt() != null && cycle.trialEndsAt().isAfter(Instant.now());
        return new Breakdown(business, cycle.billingCycle(), cycle.status(), cycle.periodStart(), cycle.periodEnd(),
                money(perSeat), cycle.seats(), used, total, lines, unused, unusedAmount, extra,
                extra == 0 ? null : money(perSeat.multiply(BigDecimal.valueOf(extra))),
                trial ? "Free trial: nothing is charged until the trial ends." : null);
    }

    private static BigDecimal money(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP);
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String join(String... parts) {
        String s = String.join(", ", java.util.Arrays.stream(parts).filter(p -> p != null && !p.isBlank()).map(String::trim).toList());
        return s.isBlank() ? null : s;
    }

    public record Business(String name, String gstin, String pan, String address) {}

    record Cycle(int seats, BigDecimal amountInr, String billingCycle, String status,
                 Instant periodStart, Instant periodEnd, Instant trialEndsAt) {}

    record CompanyRow(UUID id, String name, String legalName, String gstin, String pan, boolean active,
                      String address, int employees) {}

    public record CompanyLine(UUID companyId, String name, String legalName, String gstin, String pan,
                              String address, int employees, BigDecimal amountInr) {
        CompanyLine withAmount(BigDecimal a) {
            return new CompanyLine(companyId, name, legalName, gstin, pan, address, employees, a);
        }
    }

    public record Breakdown(Business business, String billingCycle, String status, Instant periodStart, Instant periodEnd,
                            BigDecimal pricePerSeatInr, int seatsBought, int seatsUsed, BigDecimal amountInr,
                            List<CompanyLine> companies, int unusedSeats, BigDecimal unusedSeatsAmountInr,
                            int extraUsers, BigDecimal extraUsersAmountInr, String note, ExtraCharge extraCharge) {
        Breakdown(Business business, String billingCycle, String status, Instant periodStart, Instant periodEnd,
                  BigDecimal pricePerSeatInr, int seatsBought, int seatsUsed, BigDecimal amountInr,
                  List<CompanyLine> companies, int unusedSeats, BigDecimal unusedSeatsAmountInr,
                  int extraUsers, BigDecimal extraUsersAmountInr, String note) {
            this(business, billingCycle, status, periodStart, periodEnd, pricePerSeatInr, seatsBought, seatsUsed, amountInr,
                    companies, unusedSeats, unusedSeatsAmountInr, extraUsers, extraUsersAmountInr, note, null);
        }

        Breakdown withExtraCharge(ExtraCharge e) {
            return new Breakdown(business, billingCycle, status, periodStart, periodEnd, pricePerSeatInr, seatsBought, seatsUsed,
                    amountInr, companies, unusedSeats, unusedSeatsAmountInr, extraUsers, extraUsersAmountInr, note, e);
        }
    }

    /**
     * This cycle's extra users: {@code status} SO_FAR (counted so far, before the notice), NOTIFIED (the
     * owner was told; added just before the charge), ADDING / ADDED (on the charge on {@code chargeOn}),
     * FAILED (being retried) or NONE.
     */
    public record ExtraCharge(LocalDate chargeOn, String status, int extraUsers, BigDecimal amountInr,
                              int peakActive, LocalDate peakDay, List<ExtraUsers.CompanyShare> byCompany) {}
}
