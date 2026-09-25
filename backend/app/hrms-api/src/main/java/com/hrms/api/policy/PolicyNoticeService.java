package com.hrms.api.policy;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.AppNotificationService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.util.HtmlUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Emails and in-app notices about policies (V143.23): "a new policy was
 * published" when the author ticked "Email everyone when published", and
 * reminders to acknowledge (the author's "Remind" and the optional automatic
 * reminder N days after publishing).
 *
 * <p>Every notice is a row in {@code policy_mgmt.policy_notices} first (the
 * outbox, and the record of who was told what), then sent by
 * {@link #dispatchPending}: right after the request commits on a background
 * thread, and every two minutes by {@link PolicyNoticeJob} for anything left
 * over (a restart, a mail outage). PUBLISHED and AUTO_REMINDER reach a person
 * at most once per policy version (a unique index); a manual reminder skips
 * anyone reminded in the last 24 hours.
 *
 * <p>Recipients are the workspace's live employees (active, on probation or
 * serving notice), the same people the policy page counts. Messages are signed
 * with the company's name.
 */
@Service
public class PolicyNoticeService {

    private static final Logger log = LoggerFactory.getLogger(PolicyNoticeService.class);
    private static final int BATCH = 25;
    private static final int MAX_ATTEMPTS = 3;
    static final String LIVE = "e.is_active = TRUE AND e.employment_status IN ('ACTIVE','PROBATION','NOTICE_PERIOD')";
    /** Has this employee acknowledged the policy's current version? */
    private static final String ACKED = """
            EXISTS (SELECT 1 FROM policy_mgmt.policy_acknowledgements a
                     WHERE a.policy_id = p.id AND a.employee_id = e.id
                       AND a.policy_version IS NOT DISTINCT FROM p.policy_version)""";
    private static final String EMAIL = """
            COALESCE(NULLIF(TRIM(e.email), ''),
                     (SELECT u.email FROM auth.user_credentials u
                       WHERE u.employee_id = e.id AND u.is_active = TRUE LIMIT 1))""";

    private final JdbcTemplate jdbc;
    private final MailService mail;
    private final AppNotificationService notifications;
    private final TransactionTemplate tx;
    private final ExecutorService executor = new ThreadPoolExecutor(1, 1, 60, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(100), r -> { Thread t = new Thread(r, "policy-notices"); t.setDaemon(true); return t; },
            new ThreadPoolExecutor.DiscardPolicy());

    @Value("${unifiedtree.mail.invite-url-base:${INVITE_URL_BASE:http://localhost:3001}}")
    private String appBaseUrl;

    public PolicyNoticeService(JdbcTemplate jdbc, MailService mail, AppNotificationService notifications,
                               PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.mail = mail;
        this.notifications = notifications;
        this.tx = new TransactionTemplate(txManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @PreDestroy
    void stop() {
        executor.shutdownNow();
    }

    public record RemindResult(int reminded, int skippedRecentlyReminded, int notAcknowledged) {}

    // ── Queueing (inside the caller's tenant transaction) ────────────────────

    /** Queue the "new policy" notice for everyone, if the policy asks for it. Returns how many were queued. */
    @Transactional
    public int queuePublished(UUID policyId, String actor) {
        return jdbc.update("""
                INSERT INTO policy_mgmt.policy_notices (tenant_id, policy_id, policy_version, employee_id, kind, email, created_by)
                SELECT p.tenant_id, p.id, COALESCE(p.policy_version, ''), e.id, 'PUBLISHED', %s, ?
                  FROM policy_mgmt.hr_policies p
                  JOIN hrms.employees e ON e.tenant_id = p.tenant_id AND %s
                 WHERE p.id = ? AND p.status = 'ACTIVE' AND p.notify_on_publish = TRUE
                ON CONFLICT (tenant_id, policy_id, employee_id, kind, policy_version)
                   WHERE kind IN ('PUBLISHED', 'AUTO_REMINDER') DO NOTHING
                """.formatted(EMAIL, LIVE), actor, policyId);
    }

    /**
     * The author's "Remind": everyone who hasn't acknowledged the current
     * version, except people reminded in the last 24 hours.
     */
    @Transactional
    public RemindResult remind(UUID policyId, String actor) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT status, acknowledgement_required FROM policy_mgmt.hr_policies WHERE id = ?", policyId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("HrPolicy", policyId);
        if (!"ACTIVE".equals(rows.get(0).get("status"))) {
            throw new BusinessRuleException("Only a published policy can be reminded about.", "POLICY_NOT_ACTIVE");
        }
        if (!Boolean.TRUE.equals(rows.get(0).get("acknowledgement_required"))) {
            throw new BusinessRuleException("This policy doesn't ask anyone to acknowledge it.", "POLICY_ACK_NOT_REQUIRED");
        }
        Integer pending = jdbc.queryForObject("""
                SELECT COUNT(*) FROM policy_mgmt.hr_policies p
                  JOIN hrms.employees e ON e.tenant_id = p.tenant_id AND %s
                 WHERE p.id = ? AND NOT %s
                """.formatted(LIVE, ACKED), Integer.class, policyId);
        int queued = jdbc.update("""
                INSERT INTO policy_mgmt.policy_notices (tenant_id, policy_id, policy_version, employee_id, kind, email, created_by)
                SELECT p.tenant_id, p.id, COALESCE(p.policy_version, ''), e.id, 'REMINDER', %s, ?
                  FROM policy_mgmt.hr_policies p
                  JOIN hrms.employees e ON e.tenant_id = p.tenant_id AND %s
                 WHERE p.id = ? AND NOT %s
                   AND NOT EXISTS (SELECT 1 FROM policy_mgmt.policy_notices n
                                    WHERE n.policy_id = p.id AND n.employee_id = e.id
                                      AND n.kind IN ('REMINDER', 'AUTO_REMINDER')
                                      AND n.created_at > now() - INTERVAL '24 hours')
                """.formatted(EMAIL, LIVE, ACKED), actor, policyId);
        int total = pending == null ? 0 : pending;
        return new RemindResult(queued, Math.max(0, total - queued), total);
    }

    /**
     * Automatic reminders due now: published policies that ask for
     * acknowledgement and have "remind after N days" set, N days after they were
     * published, to whoever hasn't acknowledged. Once per person per version.
     */
    @Transactional
    public int queueAutoReminders() {
        return jdbc.update("""
                INSERT INTO policy_mgmt.policy_notices (tenant_id, policy_id, policy_version, employee_id, kind, email, created_by)
                SELECT p.tenant_id, p.id, COALESCE(p.policy_version, ''), e.id, 'AUTO_REMINDER', %s, 'policy-reminder-job'
                  FROM policy_mgmt.hr_policies p
                  JOIN hrms.employees e ON e.tenant_id = p.tenant_id AND %s
                 WHERE p.status = 'ACTIVE' AND p.acknowledgement_required = TRUE
                   AND p.auto_remind_after_days IS NOT NULL AND p.published_at IS NOT NULL
                   AND p.published_at + make_interval(days => p.auto_remind_after_days) <= now()
                   AND NOT %s
                ON CONFLICT (tenant_id, policy_id, employee_id, kind, policy_version)
                   WHERE kind IN ('PUBLISHED', 'AUTO_REMINDER') DO NOTHING
                """.formatted(EMAIL, LIVE, ACKED));
    }

    /**
     * Safety net: a policy published in the last two days with "Email everyone"
     * whose notices were never queued (the request died after publishing) gets
     * them now. The unique index keeps everyone else from a second email.
     */
    @Transactional
    public int queueMissedPublished() {
        return jdbc.update("""
                INSERT INTO policy_mgmt.policy_notices (tenant_id, policy_id, policy_version, employee_id, kind, email, created_by)
                SELECT p.tenant_id, p.id, COALESCE(p.policy_version, ''), e.id, 'PUBLISHED', %s, 'policy-notice-job'
                  FROM policy_mgmt.hr_policies p
                  JOIN hrms.employees e ON e.tenant_id = p.tenant_id AND %s
                 WHERE p.status = 'ACTIVE' AND p.notify_on_publish = TRUE
                   AND p.published_at > now() - INTERVAL '2 days'
                   AND e.created_at <= p.published_at
                ON CONFLICT (tenant_id, policy_id, employee_id, kind, policy_version)
                   WHERE kind IN ('PUBLISHED', 'AUTO_REMINDER') DO NOTHING
                """.formatted(EMAIL, LIVE));
    }

    // ── Sending ──────────────────────────────────────────────────────────────

    /** Send this tenant's pending notices on the background thread, after the caller's commit. */
    public void dispatchSoon(UUID tenantId) {
        if (tenantId == null) return;
        executor.execute(() -> {
            com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
            com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
            try {
                dispatchPending(tenantId);
            } catch (Exception e) {
                log.warn("Policy notices for tenant {} not sent yet (the job retries): {}", tenantId, e.getMessage());
            } finally {
                com.unifiedtree.security.tenant.TenantContext.clear();
                com.hrms.core.tenant.TenantContext.clear();
            }
        });
    }

    private record Notice(UUID id, UUID tenantId, UUID policyId, UUID employeeId, String kind, String email, int attempts,
                          String title, String version, String company, String firstName, boolean ackRequired) {}

    /**
     * Send this tenant's pending notices, 25 at a time, each batch in its own
     * transaction with the rows locked (two instances never send the same one).
     * The caller has bound the tenant. Returns how many were handled.
     */
    public int dispatchPending(UUID tenantId) {
        int handled = 0;
        for (int round = 0; round < 40; round++) {
            Integer n = tx.execute(status -> {
                jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
                List<Notice> batch = jdbc.query("""
                        SELECT n.id, n.tenant_id, n.policy_id, n.employee_id, n.kind, n.email, n.attempts,
                               p.title, p.policy_version, c.name AS company, e.first_name, p.acknowledgement_required
                          FROM policy_mgmt.policy_notices n
                          JOIN policy_mgmt.hr_policies p ON p.id = n.policy_id
                          LEFT JOIN org.companies c ON c.id = p.company_id
                          LEFT JOIN hrms.employees e ON e.id = n.employee_id
                         WHERE n.status = 'PENDING'
                         ORDER BY n.created_at
                         LIMIT ?
                         FOR UPDATE OF n SKIP LOCKED
                        """, (rs, i) -> new Notice(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                        rs.getObject("policy_id", UUID.class), rs.getObject("employee_id", UUID.class), rs.getString("kind"),
                        rs.getString("email"), rs.getInt("attempts"), rs.getString("title"), rs.getString("policy_version"),
                        rs.getString("company"), rs.getString("first_name"), rs.getBoolean("acknowledgement_required")), BATCH);
                for (Notice notice : batch) send(notice);
                return batch.size();
            });
            if (n == null || n == 0) break;
            handled += n;
        }
        if (handled > 0) log.info("Policy notices: {} handled for tenant {}", handled, tenantId);
        return handled;
    }

    private void send(Notice n) {
        boolean reminder = !"PUBLISHED".equals(n.kind());
        String company = n.company() == null || n.company().isBlank() ? "Your company" : n.company();
        String title = n.title() == null ? "a policy" : n.title();
        String subject = reminder
                ? "Reminder: please read and acknowledge \"%s\"".formatted(title)
                : "%s has published a new policy: %s".formatted(company, title);
        String inAppBody = reminder
                ? "Please read \"%s\" and acknowledge it.".formatted(title)
                : "%s has published \"%s\". Please read it%s.".formatted(company, title, n.ackRequired() ? " and acknowledge it" : "");
        if (n.attempts() == 0) {
            try {
                Map<String, Object> data = new HashMap<>();
                data.put("type", reminder ? AppNotificationType.POLICY_REMINDER.name() : AppNotificationType.POLICY_PUBLISHED.name());
                data.put("policyId", n.policyId().toString());
                data.put("route", "/hrms/policies");
                notifications.create(n.tenantId(), n.employeeId(),
                        reminder ? AppNotificationType.POLICY_REMINDER : AppNotificationType.POLICY_PUBLISHED,
                        reminder ? "Policy to acknowledge" : "New policy: " + title, inAppBody, data);
            } catch (Exception e) {
                log.warn("In-app policy notice {} failed: {}", n.id(), e.getMessage());
            }
        }
        if (n.email() == null || n.email().isBlank()) {
            jdbc.update("""
                    UPDATE policy_mgmt.policy_notices
                       SET status = 'SENT', sent_at = now(), attempts = attempts + 1, error = 'No email address: in-app notice only'
                     WHERE id = ?
                    """, n.id());
            return;
        }
        try {
            mail.send(new EmailMessage(n.email(), null, subject, html(n, reminder, company, title), text(n, reminder, company, title), List.of()));
            jdbc.update("UPDATE policy_mgmt.policy_notices SET status = 'SENT', sent_at = now(), attempts = attempts + 1, error = NULL WHERE id = ?", n.id());
        } catch (Exception e) {
            boolean last = n.attempts() + 1 >= MAX_ATTEMPTS;
            jdbc.update("UPDATE policy_mgmt.policy_notices SET status = ?, attempts = attempts + 1, error = ? WHERE id = ?",
                    last ? "FAILED" : "PENDING", trim(e.getMessage()), n.id());
            log.warn("Policy email {} to employee {} failed (attempt {}): {}", n.id(), n.employeeId(), n.attempts() + 1, e.getMessage());
        }
    }

    private String link() {
        String base = appBaseUrl == null ? "" : appBaseUrl.replaceAll("/+$", "");
        return base + "/hrms/policies";
    }

    private String html(Notice n, boolean reminder, String company, String title) {
        String hi = n.firstName() == null || n.firstName().isBlank() ? "Hello," : "Hello " + esc(n.firstName()) + ",";
        String lead = reminder
                ? "This is a reminder to read <b>%s</b>%s and acknowledge it.".formatted(esc(title), version(n))
                : "%s has published a new policy, <b>%s</b>%s. Please read it%s.".formatted(esc(company), esc(title), version(n),
                        n.ackRequired() ? " and acknowledge it" : "");
        return """
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">
                  <p>%s</p>
                  <p>%s</p>
                  <p><a href="%s" style="display:inline-block;padding:10px 16px;background:#0f6e56;color:#ffffff;border-radius:8px;text-decoration:none">Open policies</a></p>
                  <p style="color:#64748b;font-size:12px">Sent by %s.</p>
                </div>
                """.formatted(hi, lead, esc(link()), esc(company));
    }

    private String text(Notice n, boolean reminder, String company, String title) {
        String hi = n.firstName() == null || n.firstName().isBlank() ? "Hello," : "Hello " + n.firstName() + ",";
        String v = n.version() == null || n.version().isBlank() ? "" : " (" + n.version() + ")";
        String lead = reminder
                ? "This is a reminder to read \"%s\"%s and acknowledge it.".formatted(title, v)
                : "%s has published a new policy, \"%s\"%s. Please read it%s.".formatted(company, title, v,
                        n.ackRequired() ? " and acknowledge it" : "");
        return hi + "\n\n" + lead + "\n\nOpen policies: " + link() + "\n\nSent by " + company + ".";
    }

    private static String version(Notice n) {
        return n.version() == null || n.version().isBlank() ? "" : " (" + esc(n.version()) + ")";
    }

    private static String esc(String s) {
        return HtmlUtils.htmlEscape(s == null ? "" : s);
    }

    private static String trim(String s) {
        if (s == null) return "Send failed";
        return s.length() > 500 ? s.substring(0, 500) : s;
    }
}
