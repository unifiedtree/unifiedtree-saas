package com.hrms.api.trial;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.saas.trial.TenantAdminLookup;
import com.unifiedtree.saas.trial.TenantAdminLookup.AdminUser;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Fans a single trial-lifecycle event out to every admin of a workspace via
 * BOTH the in-app notification stack (mobile inbox + Expo push) AND email.
 *
 * <p>Design rules:
 * <ul>
 *   <li>Best-effort per admin — a broken email address for admin A must not
 *       stop the notification going out to admin B. Every send is wrapped.</li>
 *   <li>Deep-link goes in {@code data.route = /billing} so the mobile inbox
 *       tap lands on the upgrade CTA (or the marketing pricing page).</li>
 *   <li>The workspace itself is NEVER modified here — the trial-expired path
 *       is notify-only; nothing gets disabled. That's an explicit product
 *       decision (see V088 migration header).</li>
 * </ul>
 */
@Service
public class TrialNotificationService {

    private static final Logger log = LoggerFactory.getLogger(TrialNotificationService.class);

    private final TenantAdminLookup adminLookup;
    private final AppNotificationService appNotifications;
    private final MailService mail;

    public TrialNotificationService(TenantAdminLookup adminLookup,
                                    AppNotificationService appNotifications,
                                    MailService mail) {
        this.adminLookup = adminLookup;
        this.appNotifications = appNotifications;
        this.mail = mail;
    }

    /** Warning fired N days before expiry (per billing_settings). */
    public int notifyEndingSoon(UUID tenantId, String subdomain, int daysLeft, String upgradeUrl) {
        // Bind tenant context — TrialLifecycleJob is @Scheduled, runs on a
        // fresh Spring scheduler thread with no ThreadLocal. Without binding,
        // TenantAwareDataSource skips SET LOCAL app.tenant_id and RLS returns
        // zero rows / rejects INSERTs on rbac.user_roles + auth.user_credentials
        // + notif.notifications. Every trial warning silently no-op'd
        // (verify caught this same bug on the halt path).
        TenantContext.setTenantId(tenantId);
        try {
            List<AdminUser> admins = adminLookup.findAdminUsers(tenantId);
            if (admins.isEmpty()) {
                log.warn("TRIAL warning: tenant {} has no admins to notify", tenantId);
                return 0;
            }
            String title = daysLeft <= 1
                    ? "Your free trial ends tomorrow"
                    : "Your free trial ends in " + daysLeft + " days";
            String body = "Subscribe now to keep using UnifiedTree without interruption.";
            String html = emailHtml(subdomain, title, body, upgradeUrl,
                    "Your free trial is ending soon. Subscribe today to keep everything you've set up.");
            return sendAll(admins, tenantId, AppNotificationType.TRIAL_ENDING_SOON, title, body,
                    html, "Free trial ending", upgradeUrl);
        } finally {
            TenantContext.clear();
        }
    }

    /** Expiry fired the first time the daily job runs after period_end. */
    public int notifyExpired(UUID tenantId, String subdomain, String upgradeUrl) {
        TenantContext.setTenantId(tenantId);  // see notifyEndingSoon for rationale
        try {
            List<AdminUser> admins = adminLookup.findAdminUsers(tenantId);
            if (admins.isEmpty()) {
                log.warn("TRIAL expired: tenant {} has no admins to notify", tenantId);
                return 0;
            }
            String title = "Your free trial has ended";
            String body = "Your workspace is still active. Please subscribe to continue using UnifiedTree.";
            String html = emailHtml(subdomain, title, body, upgradeUrl,
                    "Your free trial has ended. Your workspace is still working — please subscribe "
                            + "when you get a moment so it stays that way.");
            return sendAll(admins, tenantId, AppNotificationType.TRIAL_EXPIRED, title, body,
                    html, "Free trial ended", upgradeUrl);
        } finally {
            TenantContext.clear();
        }
    }

    // -------------------------------------------------------------------------

    private int sendAll(List<AdminUser> admins, UUID tenantId, AppNotificationType type,
                        String title, String body, String html, String emailSubject, String upgradeUrl) {
        int delivered = 0;
        for (AdminUser a : admins) {
            // In-app + Expo push
            try {
                Map<String, Object> data = new HashMap<>();
                data.put("route", "/billing");
                data.put("upgradeUrl", upgradeUrl);
                appNotifications.create(tenantId, a.employeeId(), type, title, body, data);
            } catch (Exception ex) {
                log.warn("in-app notify failed for admin {} of tenant {}: {}",
                        a.employeeId(), tenantId, ex.getMessage());
            }
            // Email
            if (a.email() != null && !a.email().isBlank()) {
                try {
                    mail.send(new EmailMessage(a.email(), a.displayName(),
                            emailSubject, html, null, List.of()));
                    delivered++;
                } catch (Exception ex) {
                    log.warn("email notify failed for admin {} of tenant {}: {}",
                            a.email(), tenantId, ex.getMessage());
                }
            }
        }
        return delivered;
    }

    private static String emailHtml(String subdomain, String title, String body,
                                    String upgradeUrl, String openingLine) {
        String safeSub = subdomain == null ? "your workspace" : subdomain + ".unifiedtree.com";
        return """
               <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0F172A">
                 <div style="text-align:center;margin-bottom:24px">
                   <div style="display:inline-block;width:56px;height:56px;background:#0F6E56;border-radius:16px;line-height:56px;color:#fff;font-size:24px;font-weight:700">UT</div>
                 </div>
                 <h1 style="font-size:22px;font-weight:700;margin:0 0 12px;text-align:center">%s</h1>
                 <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 8px;text-align:center">Workspace: <b>%s</b></p>
                 <p style="font-size:15px;line-height:1.6;color:#334155;margin:16px 0 24px">%s</p>
                 <div style="text-align:center;margin:24px 0 32px">
                   <a href="%s" style="display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600">Subscribe now</a>
                 </div>
                 <p style="font-size:13px;color:#64748B;text-align:center;margin:24px 0 0">Your workspace continues to work — we'll never lock you out.</p>
               </div>
               """.formatted(title, safeSub, openingLine + " " + body, upgradeUrl);
    }
}
