package com.hrms.app.config;

import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Component / entity / repository scan for the canonical profile.
 *
 * <p>Only packages that target the new canonical schemas are loaded.
 *
 * <p>Excluded packages and why:
 * <ul>
 *   <li>{@code com.hrms.auth}, {@code com.hrms.tenant}, {@code com.hrms.notification} — fully
 *       superseded by canonical platform packages ({@code com.unifiedtree.*}).</li>
 *   <li>{@code com.hrms.core.tenant.*} Hibernate-filter isolation — replaced by RLS (V012).</li>
 *   <li>Geofence + face-checkin endpoints ({@code /geo-fence/check}, {@code /face-checkin}, etc.)
 *       are excluded via {@code LegacyAttendanceExtrasController} which carries
 *       {@code @Profile("!canonical")} — those endpoints simply do not load here.</li>
 * </ul>
 */
@Configuration
@Profile("canonical")
@ComponentScan(basePackages = {
        // shared kernel
        "com.hrms.core.exception",
        "com.hrms.core.audit",
        "com.hrms.core.crypto",

        // canonical business modules
        "com.hrms.employee.workforce",
        "com.hrms.employee.service",
        "com.hrms.employee.repository",
        "com.hrms.employee.mapper",
        // Seat-quota enforcement aspect + service + exception advice
        // (SEAT_LIMIT_EXCEEDED → HTTP 402). Fixes the audit report where an
        // admin exceeded the workspace's paid seat count.
        "com.hrms.employee.quota",

        // onboarding + profile
        "com.hrms.employee.entity",

        // attendance (canonical schemas: attendance.*, V007 + V028)
        "com.hrms.attendance",

        // leave (canonical schemas: leave_mgmt.*, V008/V022/V024 + V028)
        "com.hrms.leave",

        // letters module
        "com.hrms.letters",

        // payroll module (seeder @Service; LopCalculator is a pure POJO, not scanned)
        "com.hrms.payroll.service",

        // expense module (canonical schema: expense_mgmt.*, V067)
        "com.hrms.expense",

        // Phase-3 modules (canonical schemas advance_mgmt/fnf_mgmt/hiring_mgmt/performance_mgmt, V068-V071)
        "com.hrms.advance",
        "com.hrms.fnf",
        "com.hrms.hiring",
        "com.hrms.performance",
        "com.hrms.document",
        "com.hrms.learning",
        "com.hrms.compliance",
        "com.hrms.policy",
        "com.hrms.pli",
        "com.hrms.integration",
        "com.hrms.notiftemplate",

        // MSG91 SMS OTP client (Msg91Client) — kept in the hrms-notification
        // module for cohesion with the other outbound delivery services.
        // NOTE: com.hrms.notification (the legacy in-app notification code)
        // is deliberately NOT scanned in canonical; only the msg91 subpackage
        // is imported so we do not resurrect the retired NotificationService.
        "com.hrms.notification.msg91",

        // canonical REST controllers
        "com.hrms.api.workforce",
        "com.hrms.api.settings",
        // Paywall guards, enabled 2026-08-10. SubscriptionAccessGuard (402 for
        // HALTED-past-grace / CANCELLED / EXPIRED / COMPLETED) and
        // TenantModuleGuard (403 for modules the workspace hasn't provisioned).
        //
        // Isolated in its own tiny package so the legacy com.hrms.api.saas
        // (which drags in PasswordEncoder + JwtTokenProvider + MailService,
        // none scanned in canonical-prod) can stay dead. Adding
        // com.hrms.api.saas here directly failed rev 00074 / 00075 startup —
        // saasguard is the correct target. Guards fail OPEN on unknown status
        // and on tenants with no subscription row (grandfathered demo /
        // signup-in-flight workspaces), so enabling does not sign anyone out
        // who was legitimately paying. Companion fix
        // SubscriptionStateReconciler.onCancelled deactivates tenant_modules
        // when a mandate is cancelled — same deploy.
        "com.hrms.api.saasguard",
        "com.hrms.api.auth.canonical",
        "com.hrms.api.rbac",
        "com.hrms.api.employee",
        "com.hrms.api.onboarding",
        "com.hrms.api.audit",
        "com.hrms.api.attendance",
        "com.hrms.api.leave",
        // WFH controller lives in its own package under api/wfh. Previously
        // missing from this scan — the WfhController class was on the
        // classpath but Spring never instantiated it as a bean, so POST
        // /v1/wfh fell through to the default static-resource handler and
        // clients saw a generic "The requested resource was not found" 404.
        "com.hrms.api.wfh",
        "com.hrms.api.letters",
        "com.hrms.api.invitation",
        "com.hrms.api.mail",
        // com.hrms.api.trial is INTENTIONALLY absent.
        //
        // It holds TrialLifecycleJob + TrialNotificationService, which act on
        // platform.subscriptions rows with plan_type='TRIAL' — mandate-less
        // free trials created by the old marketing-site signup. That flow is
        // retired: PublicSaasController./signup-request now returns 410 GONE
        // ("Signup now requires an autopay mandate"), so no new TRIAL row can
        // be created. The only trial the product offers today is the 7-day
        // one behind an authorised autopay mandate, and activate() writes
        // those as plan_type='PAID' — which this job does not look at.
        //
        // Scanning the package would therefore do nothing useful and one
        // harmful thing: it would flip whatever legacy TRIAL rows remain to
        // EXPIRED, and EXPIRED is a 402 in SubscriptionAccessGuard's decision
        // table. Enable this only alongside reintroducing a mandate-less
        // trial, and audit the leftover rows first.
        "com.hrms.api.modulereq",
        "com.hrms.api.access",
        "com.hrms.api.probation",
        "com.hrms.api.payroll",
        "com.hrms.api.expense",
        "com.hrms.api.advance",
        "com.hrms.api.fnf",
        "com.hrms.api.hiring",
        "com.hrms.api.performance",
        "com.hrms.api.document",
        "com.hrms.api.learning",
        "com.hrms.api.compliance",
        "com.hrms.api.policy",
        "com.hrms.api.pli",
        "com.hrms.api.integration",
        "com.hrms.api.notiftemplate",
        // MSG91 phone-auth OTP endpoints (OtpController, OtpProviderController).
        // Response shape is identical to /v1/auth/firebase-verify so the mobile
        // JWT-consumer + auth store need zero changes.
        "com.hrms.api.otp",
        // /v1/workspace/seats/usage — seat quota widget.
        "com.hrms.api.quota",
        // /v1/users/me + /v1/users/me/avatar — profile lookup + avatar upload.
        "com.hrms.api.users",

        // app-layer: reports, bulk import, jobs
        "com.hrms.app.reports",
        "com.hrms.app.bulk",
        "com.hrms.app.jobs",
        "com.hrms.app.config",

        // all new platform code
        "com.unifiedtree"
})
@EntityScan(basePackages = {
        "com.hrms.employee.workforce.entity",
        "com.hrms.employee.entity",
        "com.hrms.attendance.entity",
        "com.hrms.leave.entity",
        "com.hrms.expense.entity",
        "com.hrms.advance.entity",
        "com.hrms.fnf.entity",
        "com.hrms.hiring.entity",
        "com.hrms.performance.entity",
        "com.hrms.document.entity",
        "com.hrms.learning.entity",
        "com.hrms.compliance.entity",
        "com.hrms.policy.entity",
        "com.hrms.pli.entity",
        "com.hrms.integration.entity",
        "com.hrms.notiftemplate.entity",
        "com.hrms.letters.domain",
        "com.unifiedtree.settings.entity",
        "com.unifiedtree.auth.entity",
        "com.unifiedtree.rbac.entity",
        "com.unifiedtree.audit.entity",
        "com.unifiedtree.notifications.entity",
        "com.hrms.api.invitation"
})
@EnableJpaRepositories(basePackages = {
        "com.hrms.employee.workforce.repository",
        "com.hrms.employee.repository",
        "com.hrms.attendance.repository",
        "com.hrms.leave.repository",
        "com.hrms.expense.repository",
        "com.hrms.advance.repository",
        "com.hrms.fnf.repository",
        "com.hrms.hiring.repository",
        "com.hrms.performance.repository",
        "com.hrms.document.repository",
        "com.hrms.learning.repository",
        "com.hrms.compliance.repository",
        "com.hrms.policy.repository",
        "com.hrms.pli.repository",
        "com.hrms.integration.repository",
        "com.hrms.notiftemplate.repository",
        "com.hrms.letters.repository",
        "com.unifiedtree.settings.repository",
        // Per-workspace branding (logo upload → Cloudflare R2). Added
        // 2026-08-10 for the "customer sees their own logo instead of the
        // hard-coded UnifiedTree one" feature.
        "com.unifiedtree.settings.branding",
        "com.unifiedtree.auth.repository",
        "com.unifiedtree.rbac.repository",
        "com.unifiedtree.audit.repository",
        "com.unifiedtree.notifications.repository",
        "com.hrms.api.invitation"
})
public class CanonicalProfileScan {
}
