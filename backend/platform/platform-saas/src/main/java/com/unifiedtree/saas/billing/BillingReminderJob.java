package com.unifiedtree.saas.billing;

import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Payment reminders (owner rules, 6 Oct 2026): from 3 days before each due date,
 * every day until paid; grace is 7 days after the due date.
 *
 * <p>Once a day (10:00 IST) for every subscription:
 * <ul>
 *   <li><b>DUE_SOON</b> — ACTIVE or TRIALING with autopay on and the next charge
 *       0–3 days away: "Payment of ₹X due in N days".</li>
 *   <li><b>OVERDUE</b> — PAST_DUE or HALTED (a charge failed): "Payment of ₹X is
 *       overdue … pay by <due + 7 days>", every day until a charge succeeds.</li>
 * </ul>
 * To the business's owner and super admins (in-app + push + email, through the
 * shared {@link NotificationDispatcher}; both events are "always sent").
 * One message per subscription per day: the day is claimed in
 * {@code platform.billing_reminders_sent} first, so several backend instances
 * never double-send. Does nothing until V144_1 is applied.
 */
@Component
public class BillingReminderJob {

    private static final Logger log = LoggerFactory.getLogger(BillingReminderJob.class);
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final int DAYS_BEFORE = 3;
    static final int GRACE_DAYS = 7;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final JdbcTemplate jdbc;
    private final BillingReminderSchema schema;
    private final TenantAdminLookup admins;
    private final NotificationDispatcher dispatcher;

    public BillingReminderJob(JdbcTemplate jdbc, BillingReminderSchema schema,
                              TenantAdminLookup admins, NotificationDispatcher dispatcher) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.admins = admins;
        this.dispatcher = dispatcher;
    }

    // Overridable for live tests (UNIFIEDTREE_BILLING_REMINDERS_CRON); production keeps 10:00 IST.
    @Scheduled(cron = "${unifiedtree.billing.reminders.cron:0 0 10 * * *}", zone = "Asia/Kolkata")
    public void daily() {
        runFor(LocalDate.now(IST));
    }

    /** One pass for the given IST day; returns how many subscriptions were reminded. */
    public int runFor(LocalDate today) {
        if (!schema.ready()) return 0;
        int sent = 0;
        for (Due d : due(today)) {
            try {
                if (claim(d, today)) {
                    notifyAdmins(d, today);
                    sent++;
                }
            } catch (RuntimeException e) {
                // One business's failure must not stop the others' reminders.
                log.warn("payment reminder for subscription {} (tenant {}) failed: {}", d.subscriptionId(), d.tenantId(), e.getMessage());
            }
        }
        if (sent > 0) log.info("payment reminders sent for {} subscription(s) on {}", sent, today);
        return sent;
    }

    /** Subscriptions that get a reminder today. */
    List<Due> due(LocalDate today) {
        return jdbc.query("""
                SELECT s.id, s.tenant_id, s.amount_inr,
                       CASE WHEN s.status IN ('PAST_DUE', 'HALTED') THEN 'OVERDUE' ELSE 'DUE_SOON' END AS kind,
                       (COALESCE(CASE WHEN s.status IN ('PAST_DUE', 'HALTED') THEN s.past_due_since END,
                                 s.next_charge_at) AT TIME ZONE 'Asia/Kolkata')::date AS due_on
                  FROM platform.subscriptions s
                 WHERE (s.status IN ('PAST_DUE', 'HALTED')
                        OR (s.status IN ('ACTIVE', 'TRIALING')
                            AND COALESCE(s.auto_renew, TRUE)
                            AND s.next_charge_at IS NOT NULL
                            AND (s.next_charge_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ? AND ?))
                """, (rs, n) -> new Due(
                        rs.getObject("id", UUID.class),
                        rs.getObject("tenant_id", UUID.class),
                        rs.getBigDecimal("amount_inr"),
                        rs.getString("kind"),
                        rs.getObject("due_on", LocalDate.class)),
                today, today.plusDays(DAYS_BEFORE));
    }

    /** Claims today's reminder for this subscription; false when already sent today. */
    private boolean claim(Due d, LocalDate today) {
        return jdbc.update("""
                INSERT INTO platform.billing_reminders_sent (subscription_id, sent_on, tenant_id, kind, due_on)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (subscription_id, sent_on) DO NOTHING
                """, d.subscriptionId(), today, d.tenantId(), d.kind(), d.dueOn()) == 1;
    }

    private void notifyAdmins(Due d, LocalDate today) {
        Map<String, String> values = values(d, today);
        String event = "OVERDUE".equals(d.kind()) ? "billing.payment_overdue" : "billing.payment_due";
        Map<String, Object> data = Map.of("route", "/plan", "subscriptionId", d.subscriptionId().toString(), "kind", d.kind());
        // TenantAdminLookup reads RLS-protected rbac/auth tables: bind the tenant on this thread.
        TenantContext.setTenantId(d.tenantId());
        try {
            // Once per person: one employee can hold two logins (e.g. an owner and an admin login).
            java.util.Set<UUID> told = new java.util.HashSet<>();
            for (TenantAdminLookup.AdminUser a : admins.findAdminUsers(d.tenantId())) {
                if (told.add(a.employeeId())) dispatcher.dispatch(d.tenantId(), a.employeeId(), event, values, data);
            }
        } finally {
            TenantContext.clear();
        }
    }

    /** The wording's placeholders: amount, dueDate, when, graceEndsOn. */
    static Map<String, String> values(Due d, LocalDate today) {
        LocalDate dueOn = d.dueOn() == null ? today : d.dueOn();
        long days = ChronoUnit.DAYS.between(today, dueOn);
        String when = days <= 0 ? "today" : days == 1 ? "tomorrow" : "in " + days + " days";
        return Map.of(
                "amount", rupees(d.amountInr()),
                "dueDate", dueOn.format(DAY),
                "when", when,
                "graceEndsOn", dueOn.plusDays(GRACE_DAYS).format(DAY));
    }

    /** ₹ with Indian grouping (₹1,25,000); Java's formatters only group in threes. */
    static String rupees(BigDecimal amount) {
        if (amount == null) return "your plan amount";
        BigDecimal a = amount.stripTrailingZeros();
        if (a.scale() < 0) a = a.setScale(0);
        String plain = a.abs().toPlainString();
        int dot = plain.indexOf('.');
        String whole = dot < 0 ? plain : plain.substring(0, dot);
        String fraction = dot < 0 ? "" : plain.substring(dot);
        StringBuilder grouped = new StringBuilder();
        int n = whole.length();
        for (int i = 0; i < n; i++) {
            int fromEnd = n - i;
            if (i > 0 && (fromEnd == 3 || (fromEnd > 3 && (fromEnd - 3) % 2 == 0))) grouped.append(',');
            grouped.append(whole.charAt(i));
        }
        return (a.signum() < 0 ? "-₹" : "₹") + grouped + fraction;
    }

    record Due(UUID subscriptionId, UUID tenantId, BigDecimal amountInr, String kind, LocalDate dueOn) {}
}
