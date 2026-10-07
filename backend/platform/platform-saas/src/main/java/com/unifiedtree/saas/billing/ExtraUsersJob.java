package com.unifiedtree.saas.billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Extra users billed at the end of each cycle (owner, 7 Oct 2026). Every 30 minutes:
 * <ol>
 *   <li><b>Readings</b> — each paying business's active employees per company today
 *       ({@code platform.seat_usage_daily}, the day's highest kept).</li>
 *   <li><b>Notice</b> — from 3 days before a MONTHLY subscription's charge: the cycle's extras so far
 *       (highest day − seats bought, never below 0) are recorded once
 *       ({@code platform.extra_user_charges}) and, when there are any, the owner and super admins are
 *       told "N extra users will be billed on <date>" (in-app, push, email; once per person).</li>
 *   <li><b>Charge</b> — in the last 2 hours before the charge: the cycle is claimed once (status
 *       ADDING, so no two runs or instances can charge it), recounted, and the extras × the full-month
 *       per-user price are added to that charge as a Razorpay subscription add-on. A failure is kept as
 *       FAILED and retried on the next run until the charge time passes.</li>
 * </ol>
 * Yearly plans are left out until the owner decides how their extras are charged. Nothing during the
 * free trial counts. Does nothing until V144_4 is applied.
 */
@Component
public class ExtraUsersJob {

    private static final Logger log = LoggerFactory.getLogger(ExtraUsersJob.class);
    static final Duration NOTICE_BEFORE = Duration.ofDays(3);
    static final Duration CHARGE_BEFORE = Duration.ofHours(2);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final JdbcTemplate jdbc;
    private final ExtraUsersService extras;
    private final TenantAdminLookup admins;
    private final NotificationDispatcher dispatcher;
    private final RazorpayClient razorpay;
    private final RazorpayProperties props;
    private final ObjectMapper json = new ObjectMapper();

    public ExtraUsersJob(JdbcTemplate jdbc, ExtraUsersService extras, TenantAdminLookup admins,
                         NotificationDispatcher dispatcher, RazorpayClient razorpay, RazorpayProperties props) {
        this.jdbc = jdbc;
        this.extras = extras;
        this.admins = admins;
        this.dispatcher = dispatcher;
        this.razorpay = razorpay;
        this.props = props;
    }

    @Scheduled(cron = "${unifiedtree.billing.extra-users.cron:0 */30 * * * *}", zone = "Asia/Kolkata")
    public void run() {
        runAt(Instant.now());
    }

    public void runAt(Instant now) {
        if (!extras.ready()) return;
        for (UUID tenant : jdbc.queryForList("""
                SELECT DISTINCT tenant_id FROM platform.subscriptions
                 WHERE tenant_id IS NOT NULL AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'HALTED')
                """, UUID.class)) {
            try {
                extras.recordToday(tenant);
            } catch (RuntimeException e) {
                log.warn("extra users: reading for tenant {} failed: {}", tenant, e.getMessage());
            }
        }
        for (Cycle c : cyclesEndingWithin(now, NOTICE_BEFORE)) {
            try {
                handle(c, now);
            } catch (RuntimeException e) {
                log.warn("extra users: subscription {} failed: {}", c.subscriptionId(), e.getMessage());
            }
        }
    }

    record Cycle(UUID subscriptionId, UUID tenantId, int seats, BigDecimal unitPriceInr, Instant nextChargeAt,
                 Instant trialEndsAt, String razorpaySubscriptionId) {}

    List<Cycle> cyclesEndingWithin(Instant now, Duration window) {
        return jdbc.query("""
                SELECT id, tenant_id, seats, unit_price_inr, next_charge_at, trial_ends_at, razorpay_subscription_id
                  FROM platform.subscriptions
                 WHERE billing_cycle = 'MONTHLY'
                   AND status IN ('ACTIVE', 'PAST_DUE')
                   AND razorpay_subscription_id IS NOT NULL
                   AND next_charge_at > ? AND next_charge_at <= ?
                """, (rs, n) -> new Cycle(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                        rs.getInt("seats"), rs.getBigDecimal("unit_price_inr"), instant(rs.getTimestamp("next_charge_at")),
                        instant(rs.getTimestamp("trial_ends_at")), rs.getString("razorpay_subscription_id")),
                Timestamp.from(now), Timestamp.from(now.plus(window)));
    }

    void handle(Cycle c, Instant now) {
        LocalDate[] window = ExtraUsersService.cycle(c.nextChargeAt(), c.trialEndsAt());
        LocalDate cycleEnd = c.nextChargeAt().atZone(ExtraUsersService.IST).toLocalDate();
        ExtraUsers.Result r = ExtraUsers.compute(c.seats(), c.unitPriceInr(),
                window[0].isBefore(window[1]) ? extras.readings(c.tenantId(), window[0], window[1]) : List.of());

        // Notice (once per cycle).
        int inserted = jdbc.update("""
                INSERT INTO platform.extra_user_charges
                    (subscription_id, cycle_end, tenant_id, seats_bought, peak_active, peak_day, extra_users,
                     unit_price_inr, amount_inr, by_company, status, notified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
                ON CONFLICT (subscription_id, cycle_end) DO NOTHING
                """, c.subscriptionId(), cycleEnd, c.tenantId(), r.seatsBought(), r.peakActive(), r.peakDay(),
                r.extraUsers(), r.unitPriceInr(), r.amountInr(), byCompanyJson(r), r.extraUsers() > 0 ? "NOTIFIED" : "NONE",
                r.extraUsers() > 0 ? Timestamp.from(now) : null);
        if (inserted == 1 && r.extraUsers() > 0) notifyAdmins(c, r, cycleEnd);

        // Charge (claimed once; recounted).
        if (now.isBefore(c.nextChargeAt().minus(CHARGE_BEFORE))) return;
        int claimed = jdbc.update("""
                UPDATE platform.extra_user_charges SET status = 'ADDING', updated_at = now()
                 WHERE subscription_id = ? AND cycle_end = ? AND status IN ('NOTIFIED', 'NONE', 'FAILED')
                """, c.subscriptionId(), cycleEnd);
        if (claimed != 1) return;   // already added, or another run has it
        if (r.extraUsers() == 0) {
            finish(c, cycleEnd, r, "NONE", null, null);
            return;
        }
        if (!props.isConfigured()) {
            finish(c, cycleEnd, r, "FAILED", null, "Payment gateway not configured");
            return;
        }
        try {
            String addon = razorpay.createSubscriptionAddon(c.razorpaySubscriptionId(),
                    "Extra users (" + r.extraUsers() + ")",
                    "Active employees above the seats bought, " + window[0].format(DAY) + " – " + window[1].minusDays(1).format(DAY),
                    r.unitPriceInr().movePointRight(2).longValueExact(), r.extraUsers());
            finish(c, cycleEnd, r, "ADDED", addon, null);
            log.info("extra users: added {} x ₹{} to subscription {} charge on {} (addon {})",
                    r.extraUsers(), r.unitPriceInr(), c.razorpaySubscriptionId(), cycleEnd, addon);
        } catch (RuntimeException e) {
            finish(c, cycleEnd, r, "FAILED", null, e.getMessage());
            log.warn("extra users: Razorpay add-on for subscription {} failed (will retry): {}", c.razorpaySubscriptionId(), e.getMessage());
        }
    }

    private void finish(Cycle c, LocalDate cycleEnd, ExtraUsers.Result r, String status, String addonId, String error) {
        jdbc.update("""
                UPDATE platform.extra_user_charges SET
                    seats_bought = ?, peak_active = ?, peak_day = ?, extra_users = ?, unit_price_inr = ?, amount_inr = ?,
                    by_company = ?::jsonb, status = ?, razorpay_addon_id = ?, error = ?,
                    added_at = CASE WHEN ? = 'ADDED' THEN now() ELSE added_at END, updated_at = now()
                 WHERE subscription_id = ? AND cycle_end = ?
                """, r.seatsBought(), r.peakActive(), r.peakDay(), r.extraUsers(), r.unitPriceInr(), r.amountInr(),
                byCompanyJson(r), status, addonId, error, status, c.subscriptionId(), cycleEnd);
    }

    private void notifyAdmins(Cycle c, ExtraUsers.Result r, LocalDate cycleEnd) {
        Map<String, String> values = Map.of(
                "extraUsers", r.extraUsers() + (r.extraUsers() == 1 ? " extra user" : " extra users"),
                "dueDate", cycleEnd.format(DAY),
                "amount", BillingReminderJob.rupees(r.amountInr()));
        Map<String, Object> data = Map.of("route", "/settings/billing", "subscriptionId", c.subscriptionId().toString(), "kind", "EXTRA_USERS");
        TenantContext.setTenantId(c.tenantId());
        try {
            Set<UUID> told = new HashSet<>();
            for (TenantAdminLookup.AdminUser a : admins.findAdminUsers(c.tenantId())) {
                if (told.add(a.employeeId())) dispatcher.dispatch(c.tenantId(), a.employeeId(), "billing.extra_users", values, data);
            }
        } finally {
            TenantContext.clear();
        }
    }

    private String byCompanyJson(ExtraUsers.Result r) {
        try {
            return json.writeValueAsString(r.byCompany());
        } catch (Exception e) {
            return "[]";
        }
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
