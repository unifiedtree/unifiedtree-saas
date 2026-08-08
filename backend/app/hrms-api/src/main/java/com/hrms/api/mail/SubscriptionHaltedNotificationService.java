package com.hrms.api.mail;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.saas.event.SubscriptionHaltedEvent;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import com.unifiedtree.saas.trial.TenantAdminLookup.AdminUser;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Fan-out for a genuine subscription-halted transition: Razorpay exhausted
 * its own charge retries and stopped trying. We tell every workspace admin
 * (in-app + push + email) so they can update their payment method BEFORE
 * the 7-day access-grace window expires.
 *
 * <p><b>Why this lives in {@code com.hrms.api.mail}.</b> It was originally
 * written into {@code com.hrms.api.saas}, which is NOT component-scanned
 * under the {@code canonical} profile that production runs
 * ({@code SPRING_PROFILES_ACTIVE=canonical,canonical-prod}, see
 * {@code CanonicalProfileScan}). The bean was never instantiated, the
 * {@code @EventListener} was never registered, and every halt published to
 * zero listeners — correct code that never executed. {@code com.hrms.api.saas}
 * cannot simply be added to the scan: its legacy {@code SaasPlatformService} /
 * {@code PublicSaasController} beans target {@code public.*} tables that do
 * not exist in the canonical schema and would break context startup.
 * {@link WorkspaceWelcomeEmailListener} hit this exact wall first and solved
 * it the same way — see its class javadoc. Keep new event listeners here.
 *
 * <p>Design mirrors {@code TrialNotificationService}: best-effort per admin
 * (a broken email address for admin A must NOT stop admin B from getting
 * notified), deep-link {@code /plan} for the mobile inbox tap. Async so a
 * slow mail provider does NOT hold the webhook thread open (Razorpay retries
 * on non-2xx within seconds).
 *
 * <p>Firing gated at the source: {@code SubscriptionStateReconciler.onHalted}
 * only publishes the event when the UPDATE row-count is > 0 — i.e. when this
 * call was the one that actually transitioned the row from non-HALTED to
 * HALTED. Every subsequent reconciler sweep or inline access-guard check
 * sees status=HALTED and skips the publish. Admins get exactly ONE email
 * per halt cycle, not one per hour. The flip side of that guard is that
 * delivery is at-most-once: if this listener dies mid-send (pod eviction,
 * SMTP outage) no later sweep re-publishes, and the admin is never told.
 * Accepted for now; a durable outbox is the correct long-term fix.
 */
@Service
public class SubscriptionHaltedNotificationService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionHaltedNotificationService.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH);

    private final TenantAdminLookup adminLookup;
    private final AppNotificationService appNotifications;
    private final MailService mail;

    public SubscriptionHaltedNotificationService(TenantAdminLookup adminLookup,
                                                 AppNotificationService appNotifications,
                                                 MailService mail) {
        this.adminLookup = adminLookup;
        this.appNotifications = appNotifications;
        this.mail = mail;
    }

    @Async
    @EventListener
    public void onHalted(SubscriptionHaltedEvent event) {
        // TenantContext propagation. @Async runs on a fresh TaskExecutor thread
        // whose ThreadLocal is empty; TenantAwareDataSource then leaves the
        // connection unbound (no SET LOCAL app.tenant_id), which makes every
        // RLS-scoped SELECT (rbac.user_roles, auth.user_credentials) return
        // zero rows and every RLS-scoped INSERT (notif.notifications) reject
        // WITH CHECK. Without this bind the admin lookup silently returns
        // empty and every halt is a no-op. Try/finally ensures the ThreadLocal
        // is cleared so a returned pool thread never carries this tenant into
        // unrelated work.
        TenantContext.setTenantId(event.tenantId());
        try {
            handle(event);
        } catch (RuntimeException e) {
            // TenantAdminLookup now rethrows on query failure so outages are
            // visible rather than looking like "this tenant has no admins".
            // Catch it here: an @Async method that throws only reaches Spring's
            // default uncaught handler, which logs without the context an
            // operator needs to act.
            log.error("SUBSCRIPTION_HALTED fan-out failed for tenant={} sub={} — "
                      + "admins were NOT notified; their grace window is running",
                    event.tenantId(), event.subscriptionId(), e);
        } finally {
            TenantContext.clear();
        }
    }

    private void handle(SubscriptionHaltedEvent event) {
        List<AdminUser> admins = adminLookup.findAdminUsers(event.tenantId());
        if (admins.isEmpty()) {
            log.warn("SUBSCRIPTION_HALTED: tenant {} has no admins to notify", event.tenantId());
            return;
        }
        String graceDate = event.graceUntil() == null
                ? "in 7 days"
                : "on " + LocalDate.ofInstant(event.graceUntil(), ZoneOffset.UTC).format(DATE_FMT);
        String subdomain = event.subdomain() == null ? "your workspace" : event.subdomain() + ".unifiedtree.com";
        String title = "Payment failed — please update your card";
        String body  = "Your autopay charge didn't go through. Access continues until " + graceDate + ".";
        String html  = emailHtml(subdomain, graceDate);

        int delivered = 0;
        for (AdminUser a : admins) {
            // 1) In-app + Expo push (best-effort per admin)
            try {
                Map<String, Object> data = new HashMap<>();
                data.put("route", "/plan");
                data.put("subscriptionId", event.subscriptionId());
                data.put("graceUntil", event.graceUntil() == null ? null : event.graceUntil().toString());
                appNotifications.create(event.tenantId(), a.employeeId(),
                        AppNotificationType.SUBSCRIPTION_HALTED, title, body, data);
            } catch (Exception ex) {
                log.warn("in-app SUBSCRIPTION_HALTED notify failed for admin {} of tenant {}: {}",
                        a.employeeId(), event.tenantId(), ex.getMessage());
            }
            // 2) Email
            if (a.email() != null && !a.email().isBlank()) {
                try {
                    mail.send(new EmailMessage(a.email(), a.displayName(),
                            "Action needed: your UnifiedTree autopay failed",
                            html, null, List.of()));
                    delivered++;
                } catch (Exception ex) {
                    log.warn("email SUBSCRIPTION_HALTED notify failed for admin {} of tenant {}: {}",
                            a.email(), event.tenantId(), ex.getMessage());
                }
            }
        }
        log.info("SUBSCRIPTION_HALTED tenant={} sub={} admins={} emails-sent={}",
                event.tenantId(), event.subscriptionId(), admins.size(), delivered);
    }

    private static String emailHtml(String subdomain, String graceDate) {
        return """
               <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0F172A">
                 <div style="text-align:center;margin-bottom:24px">
                   <div style="display:inline-block;width:56px;height:56px;background:#B91C1C;border-radius:16px;line-height:56px;color:#fff;font-size:24px;font-weight:700">!</div>
                 </div>
                 <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;text-align:center">Your autopay could not be charged</h1>
                 <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 8px;text-align:center">Workspace: <b>%s</b></p>
                 <p style="font-size:15px;line-height:1.6;color:#334155;margin:16px 0 24px">
                   We tried multiple times to charge your card / UPI for the current cycle
                   and it didn't go through. Your workspace stays fully accessible until
                   <b>%s</b> — no data is lost.
                 </p>
                 <p style="font-size:15px;line-height:1.6;color:#334155;margin:16px 0 24px">
                   Please open your workspace and update your payment method so autopay
                   can resume:
                 </p>
                 <div style="text-align:center;margin:24px 0 32px">
                   <a href="https://%s/plan" style="display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600">Update payment method</a>
                 </div>
                 <p style="font-size:13px;color:#64748B;text-align:center;margin:24px 0 0">
                   After %s, your workspace will move to read-only until autopay resumes.
                   You can restore access any time by completing a new payment — no data is deleted.
                 </p>
               </div>
               """.formatted(subdomain, graceDate, subdomain, graceDate);
    }
}
