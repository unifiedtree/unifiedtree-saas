package com.hrms.api.quota;

import com.hrms.employee.quota.SeatOverageDetectedEvent;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import com.unifiedtree.saas.trial.TenantAdminLookup.AdminUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Fan-out for the "your workspace is over its paid seat cap" warning.
 *
 * <p><b>Why this exists.</b> On 2026-08-22 the client asked that tenants
 * <em>already</em> over the paid seat cap on the day {@code SeatQuotaEnforcer}'s
 * hard 402 shipped (nclever, unifiedtree01 — grandfathered) be told, in-app,
 * to set up autopay for the extra headcount, and be left running through the
 * current billing period. The hard block for <em>new</em> customers is
 * unchanged: they hit {@code SEAT_LIMIT_EXCEEDED} on the create that would
 * push them over, and never satisfy the event's guard at all. This alert is
 * therefore self-selecting — only workspaces that were let over the cap
 * historically will ever fire it.
 *
 * <p><b>Trigger.</b> Fires on
 * {@link SeatOverageDetectedEvent}, which
 * {@link com.hrms.employee.quota.SeatQuotaService} publishes from its
 * seat-usage read (which the dashboard's Seats-Usage tile polls every 30
 * seconds). No cron: the frontend's own polling is the trigger, and the
 * dedup row below cheap-outs every subsequent call for the rest of the
 * month.
 *
 * <p><b>Cross-module event.</b> {@code hrms-employee} deliberately does not
 * depend on {@code platform-notifications} / {@code platform-saas}, so it
 * can't fan out directly. An in-process {@code ApplicationEvent} is the
 * seam: the read publishes the event, this listener (which does have the
 * deps) does the work.
 *
 * <p><b>Dedup.</b> Bells that shout every 30 seconds are indistinguishable
 * from broken. Emitted at most once per (tenant, calendar month) via a claim
 * row in {@code platform.seat_overage_notifications} — the primary key
 * {@code (tenant_id, notified_month)} + {@code INSERT ... ON CONFLICT DO
 * NOTHING} makes the claim race-free even when two admins are looking at
 * their dashboards simultaneously. The DDL bootstrap for the table lives in
 * {@link com.hrms.app.config.SeatOverageSchemaBootstrap}.
 *
 * <p><b>Transaction shape.</b>
 * <ul>
 *   <li>{@code @TransactionalEventListener(AFTER_COMMIT, fallbackExecution =
 *       true)} — fires after the publisher's seat-usage read commits (same
 *       convention as {@code DomainEventListener}). {@code fallbackExecution}
 *       covers the corner case where a non-tx path publishes the event.</li>
 *   <li>{@code @Transactional} on the listener method — the publisher's
 *       readOnly tx has already closed at this point, so this opens a fresh
 *       writable tx on a fresh connection. {@code TenantAwareDataSource}
 *       re-issues {@code SET LOCAL app.tenant_id} from the request thread's
 *       still-bound {@code TenantContext}, so RLS reads (admin lookup) and
 *       writes ({@code notif.notifications} via
 *       {@link AppNotificationService#create}) all fire under the right
 *       tenant. Putting the annotation here (not on a private helper) is
 *       what makes it take effect — Spring @Transactional only wraps
 *       proxy-entry methods, and self-invocation of a private helper would
 *       bypass the proxy.</li>
 * </ul>
 *
 * <p><b>Fail-quiet.</b> Every downstream step is wrapped. The listener
 * itself only rethrows if the claim INSERT itself fails, so a broken send is
 * not worth spamming the admin about every 30 seconds — the persisted claim
 * row silences re-emission for the month regardless. A notification failure
 * must not surface as a seat-usage read failure — the whole point of a
 * warning is to help, not to break the page it's supposed to appear on.
 *
 * <p>TODO(billing-ceiling): this alert is a one-time grandfather bridge.
 * Once the Razorpay ceiling flow ships (see roadmap) every tenant will hit
 * the hard 402 the moment they'd exceed cap and this class can be deleted
 * along with the {@code BILLING_OVER_CAP} enum value and the dedup table.
 */
@Component
public class SeatOverageNotifier {

    private static final Logger log = LoggerFactory.getLogger(SeatOverageNotifier.class);

    private final JdbcTemplate jdbc;
    private final TenantAdminLookup adminLookup;
    private final AppNotificationService appNotifications;

    public SeatOverageNotifier(JdbcTemplate jdbc,
                               TenantAdminLookup adminLookup,
                               AppNotificationService appNotifications) {
        this.jdbc = jdbc;
        this.adminLookup = adminLookup;
        this.appNotifications = appNotifications;
    }

    /**
     * Entry point Spring proxies. Anything called on {@code this} inside the
     * method bypasses the proxy, so no @Transactional helper method here —
     * everything runs in the ONE tx started by this annotation.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    @Transactional
    public void onSeatOverageDetected(SeatOverageDetectedEvent e) {
        UUID tenantId = e.tenantId();
        int purchased = e.purchased();
        int current   = e.current();
        if (tenantId == null) return;
        // Defence in depth — the publisher already guards these.
        if (purchased <= 0 || current <= purchased) return;

        // Cheap check first so the 30-second dashboard poll doesn't do a
        // wasted claim INSERT for the rest of the month. Correctness still
        // comes from the ON CONFLICT below — this SELECT is an optimisation,
        // not the source of truth.
        try {
            Integer existing = jdbc.queryForObject("""
                    SELECT COUNT(*) FROM platform.seat_overage_notifications
                     WHERE tenant_id = ?
                       AND notified_month = DATE_TRUNC('month', now())::date
                    """, Integer.class, tenantId);
            if (existing != null && existing > 0) return;
        } catch (Exception ex) {
            // Table might not exist yet on a very fresh deploy before the
            // bootstrap runs — fall through to the claim insert, which will
            // fail the same way and get logged there. Never fatal.
            log.debug("seat overage precheck skipped for tenant={}: {}", tenantId, ex.toString());
        }

        int claimed;
        try {
            claimed = jdbc.update("""
                    INSERT INTO platform.seat_overage_notifications (tenant_id, notified_month)
                    VALUES (?, DATE_TRUNC('month', now())::date)
                    ON CONFLICT (tenant_id, notified_month) DO NOTHING
                    """, tenantId);
        } catch (Exception ex) {
            log.warn("seat overage claim skipped for tenant={}: {}", tenantId, ex.toString());
            return;
        }
        // Zero rows means someone else claimed this month first (or the row
        // already existed). Either way, do not emit twice.
        if (claimed == 0) return;

        try {
            List<AdminUser> admins = adminLookup.findAdminUsers(tenantId);
            if (admins.isEmpty()) {
                log.warn("BILLING_OVER_CAP: tenant {} has no admins to notify (purchased={}, current={})",
                        tenantId, purchased, current);
                return;
            }
            String title = "Seat cap exceeded";
            String body = "You have " + current + " active employees but only "
                    + purchased + " paid seats. Your existing team keeps working, "
                    + "but adding a new employee will be blocked until you cover "
                    + "the extras. Set up autopay on the plan page — charges "
                    + "start next billing cycle.";
            for (AdminUser a : admins) {
                Map<String, Object> data = new HashMap<>();
                data.put("route", "/plan");
                data.put("purchased", purchased);
                data.put("current", current);
                try {
                    appNotifications.create(tenantId, a.employeeId(),
                            AppNotificationType.BILLING_OVER_CAP, title, body, data);
                } catch (Exception ex) {
                    log.warn("in-app BILLING_OVER_CAP notify failed for admin {} of tenant {}: {}",
                            a.employeeId(), tenantId, ex.getMessage());
                }
            }
            log.info("BILLING_OVER_CAP tenant={} purchased={} current={} admins-notified={}",
                    tenantId, purchased, current, admins.size());
        } catch (RuntimeException ex) {
            // TenantAdminLookup rethrows on RLS / connectivity trouble. We do
            // NOT rethrow — that would roll back the claim row and re-fire the
            // event on every 30-second dashboard poll for the rest of the
            // month. Keep the claim; the operator sees the WARN and can
            // resend by hand once the underlying lookup is healthy. Repeat
            // send would spam far more than a missed send would starve.
            log.warn("BILLING_OVER_CAP fan-out failed for tenant={}: {}",
                    tenantId, ex.getMessage());
        }
    }
}
