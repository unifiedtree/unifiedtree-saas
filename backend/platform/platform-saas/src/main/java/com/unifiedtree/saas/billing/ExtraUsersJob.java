package com.unifiedtree.saas.billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.saas.billing.ExtraUsersService.HrmsSubscription;
import com.unifiedtree.saas.payment.RazorpayClient;
import com.unifiedtree.saas.payment.RazorpayProperties;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

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
 *   <li><b>Notice</b> — from 3 days before the charge of a business's MONTHLY HRMS subscription (one per
 *       business, {@link ExtraUsersService#hrmsSubscriptions}): the cycle's extras so far (highest day −
 *       seats bought, never below 0) are recorded once ({@code platform.extra_user_charges}) and, when
 *       there are any, the owner and super admins are told "N extra users will be billed on <date>"
 *       (in-app, push, email; once per person).</li>
 *   <li><b>Charge</b> — in the last 2 hours before the charge: the cycle is claimed once (status
 *       ADDING, so no two runs or instances can charge it), recounted, and the extras × the full-month
 *       per-user price are added to that charge as a Razorpay subscription add-on.</li>
 * </ol>
 * Never charged twice (review 7 Oct 2026):
 * <ul>
 *   <li>only ACTIVE subscriptions: a PAST_DUE one is Razorpay retrying a charge that already carries
 *       its add-on (E2); a cycle is keyed by the subscription's period, which a retry doesn't move, and a
 *       business with an add-on for an overlapping cycle isn't charged again;</li>
 *   <li>one charge per business and cycle (E4; also a unique key in V144_4);</li>
 *   <li>a definite refusal (4xx, gateway not configured, no price) is FAILED and tried again on the next
 *       run; an unknown outcome (no answer, timeout, 5xx), or a claim interrupted mid-call, is UNKNOWN
 *       and never tried again (E3): someone checks Razorpay first. Logged as EXTRA_USERS_UNKNOWN;</li>
 *   <li>a cycle whose charge passed without an add-on is MISSED, logged as EXTRA_USERS_MISSED.</li>
 * </ul>
 * Both log tokens are meant for a Cloud Logging alert. Yearly plans are left out until the owner
 * decides how their extras are charged. Nothing during the free trial counts. Does nothing until V144_4
 * is applied.
 */
@Component
public class ExtraUsersJob {

    private static final Logger log = LoggerFactory.getLogger(ExtraUsersJob.class);
    static final Duration NOTICE_BEFORE = Duration.ofDays(3);
    static final Duration CHARGE_BEFORE = Duration.ofHours(2);
    /** A claim older than this never finished: the server stopped mid-call, so the outcome is unknown. */
    static final Duration INTERRUPTED_AFTER = Duration.ofMinutes(15);
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
        try {
            extras.forgetOldReadings();
            markInterrupted(now);
            markMissed(now);
        } catch (RuntimeException e) {
            log.warn("extra users: housekeeping failed: {}", e.getMessage());
        }
        for (HrmsSubscription s : extras.hrmsSubscriptions()) {
            if (!"ACTIVE".equals(s.status())) continue;
            if (!s.nextChargeAt().isAfter(now) || s.nextChargeAt().isAfter(now.plus(NOTICE_BEFORE))) continue;
            try {
                handle(s, now);
            } catch (RuntimeException e) {
                log.warn("extra users: subscription {} failed: {}", s.id(), e.getMessage());
            }
        }
    }

    void handle(HrmsSubscription s, Instant now) {
        LocalDate cycleEnd = s.cycleEnd();
        // An add-on already made (or maybe made) for an overlapping cycle of this business: never again.
        Integer overlapping = jdbc.queryForObject("""
                SELECT count(*) FROM platform.extra_user_charges
                 WHERE tenant_id = ? AND cycle_end > ? AND cycle_end <> ? AND status IN ('ADDING', 'ADDED', 'UNKNOWN')
                """, Integer.class, s.tenantId(), s.cycleStart(), cycleEnd);
        if (overlapping != null && overlapping > 0) {
            log.warn("extra users: business {} already has an add-on for a cycle overlapping {} – {}; not charged again",
                    s.tenantId(), s.cycleStart(), cycleEnd);
            return;
        }
        ExtraUsers.Result r = ExtraUsers.compute(s.seats(), s.unitPriceInr(),
                s.cycleStart().isBefore(cycleEnd) ? extras.readings(s.tenantId(), s.cycleStart(), cycleEnd) : List.of());
        boolean priced = s.unitPriceInr().signum() > 0;

        // Notice (once per business and cycle).
        String noticeStatus = r.extraUsers() == 0 ? "NONE" : priced ? "NOTIFIED" : "FAILED";
        int inserted = jdbc.update("""
                INSERT INTO platform.extra_user_charges
                    (subscription_id, cycle_end, tenant_id, seats_bought, peak_active, peak_day, extra_users,
                     unit_price_inr, amount_inr, by_company, status, error, notified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """, s.id(), cycleEnd, s.tenantId(), r.seatsBought(), r.peakActive(), r.peakDay(),
                r.extraUsers(), r.unitPriceInr(), r.amountInr(), byCompanyJson(r), noticeStatus,
                "FAILED".equals(noticeStatus) ? NO_PRICE : null, "NOTIFIED".equals(noticeStatus) ? Timestamp.from(now) : null);
        if (inserted == 1 && "NOTIFIED".equals(noticeStatus)) notifyAdmins(s, r);
        if (inserted == 1 && "FAILED".equals(noticeStatus)) {
            log.error("EXTRA_USERS_NO_PRICE tenant={} sub={} : {} extra users this cycle but no per-user price is known",
                    s.tenantId(), s.razorpaySubscriptionId(), r.extraUsers());
        }

        // Charge (claimed once; recounted).
        if (now.isBefore(s.nextChargeAt().minus(CHARGE_BEFORE))) return;
        int claimed = jdbc.update("""
                UPDATE platform.extra_user_charges SET status = 'ADDING', updated_at = now()
                 WHERE subscription_id = ? AND cycle_end = ? AND status IN ('NOTIFIED', 'NONE', 'FAILED')
                """, s.id(), cycleEnd);
        if (claimed != 1) return;   // added, unknown, missed, or another run has it
        if (r.extraUsers() == 0) {
            finish(s, r, "NONE", null, null);
            return;
        }
        if (!priced) {
            finish(s, r, "FAILED", null, NO_PRICE);
            return;
        }
        if (!props.isConfigured()) {
            finish(s, r, "FAILED", null, "Payment gateway not configured");
            return;
        }
        try {
            String addon = razorpay.createSubscriptionAddon(s.razorpaySubscriptionId(),
                    "Extra users (" + r.extraUsers() + ")",
                    "Active employees above the seats bought, " + s.cycleStart().format(DAY) + " – " + cycleEnd.minusDays(1).format(DAY),
                    r.unitPriceInr().movePointRight(2).setScale(0, java.math.RoundingMode.HALF_UP).longValueExact(), r.extraUsers());
            finish(s, r, "ADDED", addon, null);
            log.info("extra users: added {} x ₹{} to subscription {} charge on {} (addon {})",
                    r.extraUsers(), r.unitPriceInr(), s.razorpaySubscriptionId(), chargeDay(s), addon);
        } catch (org.springframework.web.server.ResponseStatusException e) {
            // A definite refusal: nothing was created, the next run tries again until the charge passes.
            finish(s, r, "FAILED", null, e.getReason());
            log.warn("extra users: Razorpay refused the add-on for subscription {} (will retry): {}", s.razorpaySubscriptionId(), e.getReason());
        } catch (RuntimeException e) {
            // AddonOutcomeUnknown, or anything else: Razorpay may have created it. Never retried.
            finish(s, r, "UNKNOWN", null, "Outcome unknown, check Razorpay before doing anything: " + e.getMessage());
            log.error("EXTRA_USERS_UNKNOWN tenant={} sub={} cycle_end={} : add-on of {} x ₹{} may or may not exist at Razorpay ({}); "
                            + "NOT retried — check the subscription's add-ons in the Razorpay dashboard",
                    s.tenantId(), s.razorpaySubscriptionId(), cycleEnd, r.extraUsers(), r.unitPriceInr(), e.getMessage());
        }
    }

    private static final String NO_PRICE = "No per-user price is known for this subscription";

    /** Claims that never finished (the server stopped mid-call): the add-on may exist, so UNKNOWN, never retried. */
    void markInterrupted(Instant now) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                UPDATE platform.extra_user_charges
                   SET status = 'UNKNOWN', error = 'Interrupted while adding, check Razorpay before doing anything', updated_at = now()
                 WHERE status = 'ADDING' AND updated_at < ?
                RETURNING tenant_id, subscription_id, cycle_end, extra_users
                """, Timestamp.from(now.minus(INTERRUPTED_AFTER)));
        for (Map<String, Object> r : rows) {
            log.error("EXTRA_USERS_UNKNOWN tenant={} subscription={} cycle_end={} : interrupted while adding {} extra users; "
                    + "NOT retried — check Razorpay", r.get("tenant_id"), r.get("subscription_id"), r.get("cycle_end"), r.get("extra_users"));
        }
    }

    /** Cycles whose charge day has passed with the extras never added: nothing billed, so someone must look. */
    void markMissed(Instant now) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                UPDATE platform.extra_user_charges SET status = 'MISSED', updated_at = now()
                 WHERE status IN ('NOTIFIED', 'FAILED') AND cycle_end < ?
                RETURNING tenant_id, subscription_id, cycle_end, extra_users, amount_inr, error
                """, now.atZone(ExtraUsersService.IST).toLocalDate());
        for (Map<String, Object> r : rows) {
            log.error("EXTRA_USERS_MISSED tenant={} subscription={} cycle_end={} : {} extra users (₹{}) were never added to the charge ({})",
                    r.get("tenant_id"), r.get("subscription_id"), r.get("cycle_end"), r.get("extra_users"), r.get("amount_inr"),
                    r.get("error") == null ? "the job did not run in the charge window" : r.get("error"));
        }
    }

    private void finish(HrmsSubscription s, ExtraUsers.Result r, String status, String addonId, String error) {
        jdbc.update("""
                UPDATE platform.extra_user_charges SET
                    seats_bought = ?, peak_active = ?, peak_day = ?, extra_users = ?, unit_price_inr = ?, amount_inr = ?,
                    by_company = ?::jsonb, status = ?, razorpay_addon_id = ?, error = ?,
                    added_at = CASE WHEN ? = 'ADDED' THEN now() ELSE added_at END, updated_at = now()
                 WHERE subscription_id = ? AND cycle_end = ?
                """, r.seatsBought(), r.peakActive(), r.peakDay(), r.extraUsers(), r.unitPriceInr(), r.amountInr(),
                byCompanyJson(r), status, addonId, error, status, s.id(), s.cycleEnd());
    }

    private static LocalDate chargeDay(HrmsSubscription s) {
        return s.nextChargeAt().atZone(ExtraUsersService.IST).toLocalDate();
    }

    private void notifyAdmins(HrmsSubscription s, ExtraUsers.Result r) {
        Map<String, String> values = Map.of(
                "extraUsers", r.extraUsers() + (r.extraUsers() == 1 ? " extra user" : " extra users"),
                "dueDate", chargeDay(s).format(DAY),
                "amount", BillingReminderJob.rupees(r.amountInr()));
        Map<String, Object> data = Map.of("route", "/settings/billing", "subscriptionId", s.id().toString(), "kind", "EXTRA_USERS");
        TenantContext.setTenantId(s.tenantId());
        try {
            Set<UUID> told = new HashSet<>();
            for (TenantAdminLookup.AdminUser a : admins.findAdminUsers(s.tenantId())) {
                if (told.add(a.employeeId())) dispatcher.dispatch(s.tenantId(), a.employeeId(), "billing.extra_users", values, data);
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
}
