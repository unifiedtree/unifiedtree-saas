package com.hrms.api.invitation;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

/**
 * Sends invitation / password-reset emails OUT OF BAND so a slow or unreachable
 * SMTP server never blocks the HTTP request that created the token. Runs on the
 * dedicated {@code invitationEmailExecutor} pool and records the outcome on the
 * token row ({@code send_status} / {@code send_attempted_at} / {@code last_send_error})
 * so the UI can show queued / sent / failed and offer a retry.
 *
 * <p>This is intentionally a SEPARATE bean from {@code InvitationService}: an
 * {@code @Async} method invoked from within the same class bypasses the Spring
 * proxy and would run synchronously, defeating the whole point.
 *
 * <p>The caller fires this from a transaction {@code afterCommit} hook, so by the
 * time the email is attempted the token row is already committed and visible to
 * the status-update transaction below.
 */
@Component
public class InvitationEmailSender {

    private static final Logger log = LoggerFactory.getLogger(InvitationEmailSender.class);
    private static final int MAX_ERROR_LEN = 500;

    private final MailService mailService;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public InvitationEmailSender(MailService mailService,
                                 JdbcTemplate jdbc,
                                 PlatformTransactionManager txManager) {
        this.mailService = mailService;
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txManager);
    }

    @Async("invitationEmailExecutor")
    public void sendAndTrack(UUID tokenId, UUID tenantId, String to, String subject, String bodyHtml) {
        String status;
        String error = null;
        try {
            mailService.send(EmailMessage.simple(to, subject, bodyHtml));
            status = "SENT";
            log.info("Invitation email sent to {} (token {})", to, tokenId);
        } catch (Exception e) {
            status = "FAILED";
            error = truncate(e.getMessage());
            log.error("Invitation email send FAILED for token {} to {}", tokenId, to, e);
        }
        recordOutcome(tokenId, tenantId, status, error);
    }

    /**
     * Persist the delivery outcome in its own short transaction. {@code invitation_tokens}
     * is RLS-scoped via {@code current_tenant_id()}, so we re-bind the tenant on this
     * pool thread's connection (the request's TenantContext does not propagate here).
     */
    private void recordOutcome(UUID tokenId, UUID tenantId, String status, String error) {
        try {
            tx.executeWithoutResult(s -> {
                jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
                jdbc.update(
                    "UPDATE auth.invitation_tokens "
                        + "SET send_status = ?, send_attempted_at = now(), last_send_error = ? "
                        + "WHERE id = ?",
                    status, error, tokenId);
            });
        } catch (Exception e) {
            // Never throw from the async path — the email outcome is best-effort bookkeeping.
            log.error("Failed to record invitation send status '{}' for token {}", status, tokenId, e);
        }
    }

    private static String truncate(String s) {
        if (s == null || s.isBlank()) return "Email send failed (no detail)";
        return s.length() <= MAX_ERROR_LEN ? s : s.substring(0, MAX_ERROR_LEN);
    }
}
