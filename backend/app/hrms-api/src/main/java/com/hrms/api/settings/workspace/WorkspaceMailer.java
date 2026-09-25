package com.hrms.api.settings.workspace;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Emails about workspace security and the danger zone (export ready,
 * reset/delete scheduled or cancelled, two-factor turned off by an admin).
 *
 * <p>White-label: every email names the WORKSPACE, never the platform. Links
 * point at the workspace's own address.
 *
 * <p>Recipients are looked up on the caller's thread (RLS needs the tenant);
 * sending happens after the transaction commits, on a background thread, so a
 * slow mail server never holds a request open and nothing is emailed for a
 * change that rolled back. Delivery is best-effort per recipient.
 */
@Component
public class WorkspaceMailer {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceMailer.class);

    private final MailService mail;
    private final JdbcTemplate jdbc;
    private final String baseUrl;
    private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "workspace-mailer");
        t.setDaemon(true);
        return t;
    });

    public WorkspaceMailer(MailService mail, JdbcTemplate jdbc,
                           @Value("${unifiedtree.mail.invite-url-base:${unifiedtree.invitation.platform-base-url:http://localhost:3001}}") String baseUrl) {
        this.mail = mail;
        this.jdbc = jdbc;
        this.baseUrl = baseUrl;
    }

    @PreDestroy
    void stop() {
        sender.shutdown();
    }

    /** Active owners, super admins and admins of the bound workspace. */
    public List<String> ownerAndAdminEmails(UUID tenantId) {
        return jdbc.queryForList("""
                SELECT DISTINCT lower(uc.email)
                  FROM rbac.user_roles ur
                  JOIN rbac.roles r ON r.id = ur.role_id
                  JOIN auth.user_credentials uc ON uc.id = ur.user_id
                 WHERE ur.tenant_id = ?
                   AND r.code IN ('OWNER', 'SUPER_ADMIN', 'ADMIN')
                   AND uc.is_active
                   AND uc.email IS NOT NULL
                 ORDER BY 1
                """, String.class, tenantId);
    }

    public String workspaceName(UUID tenantId) {
        List<String> rows = jdbc.queryForList("SELECT display_name FROM platform.tenants WHERE id = ?", String.class, tenantId);
        return rows.isEmpty() || rows.get(0) == null ? "Your workspace" : rows.get(0);
    }

    /** Link into the workspace's own web address. */
    public String link(UUID tenantId, String path) {
        List<String> rows = jdbc.queryForList("SELECT subdomain FROM platform.tenants WHERE id = ?", String.class, tenantId);
        String slug = rows.isEmpty() ? null : rows.get(0);
        if (baseUrl.contains("localhost") || slug == null) return baseUrl + path;
        return "https://" + slug + "." + baseUrl.replaceFirst("https?://", "") + path;
    }

    /** Queue emails to go out once the current transaction commits (or now, if none). */
    public void sendAfterCommit(List<EmailMessage> messages) {
        if (messages == null || messages.isEmpty()) return;
        Runnable send = () -> sender.submit(() -> {
            for (EmailMessage m : messages) {
                try {
                    mail.send(m);
                } catch (Exception e) {
                    log.warn("workspace email '{}' to {} failed: {}", m.subject(), m.to(), e.getMessage());
                }
            }
        });
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { send.run(); }
            });
        } else {
            send.run();
        }
    }

    /** A plain, neutral email body: a heading, paragraphs (already HTML-escaped) and an optional button. */
    public static String html(String workspace, String heading, List<String> paragraphs, String buttonLabel, String buttonUrl) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div style=\"font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0F172A\">");
        sb.append("<p style=\"font-size:13px;color:#64748B;margin:0 0 8px\">").append(esc(workspace)).append("</p>");
        sb.append("<h1 style=\"font-size:20px;font-weight:700;margin:0 0 16px\">").append(esc(heading)).append("</h1>");
        for (String p : paragraphs) {
            sb.append("<p style=\"font-size:15px;line-height:1.6;color:#334155;margin:0 0 14px\">").append(p).append("</p>");
        }
        if (buttonLabel != null && buttonUrl != null) {
            sb.append("<div style=\"margin:24px 0\"><a href=\"").append(esc(buttonUrl))
              .append("\" style=\"display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600\">")
              .append(esc(buttonLabel)).append("</a></div>");
        }
        sb.append("<p style=\"font-size:12px;color:#64748B;margin:24px 0 0\">You are receiving this because you are an owner or admin of ")
          .append(esc(workspace)).append(", or this change was made on your account.</p></div>");
        return sb.toString();
    }

    public static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }
}
