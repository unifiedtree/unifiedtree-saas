package com.hrms.api.mail;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

/**
 * SMTP-backed {@link MailService}.
 *
 * <p>Active when {@code unifiedtree.mail.provider=smtp} (the default).
 * Works with:
 * <ul>
 *   <li>Mailpit on port 1025 for local dev (no auth, no TLS)</li>
 *   <li>Gmail SMTP on port 587 with STARTTLS</li>
 *   <li>Any other RFC-compliant SMTP relay</li>
 * </ul>
 *
 * <p>Configuration via env vars:
 * <pre>
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_AUTH, SMTP_TLS
 *   MAIL_FROM_EMAIL, MAIL_FROM_NAME
 * </pre>
 */
@Service
@ConditionalOnProperty(name = "unifiedtree.mail.provider", havingValue = "smtp", matchIfMissing = true)
public class SmtpMailService implements MailService {

    private static final Logger log = LoggerFactory.getLogger(SmtpMailService.class);

    private final JavaMailSender mailSender;

    @Value("${unifiedtree.mail.from-email:noreply@unifiedtree.com}")
    private String fromEmail;

    @Value("${unifiedtree.mail.from-name:UnifiedTree}")
    private String fromName;

    public SmtpMailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @Override
    public void send(EmailMessage msg) {
        try {
            MimeMessage mime = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(mime, false, "UTF-8");
            helper.setFrom(fromEmail, fromName);
            helper.setTo(msg.to());
            helper.setSubject(msg.subject());

            if (msg.htmlBody() != null && !msg.htmlBody().isBlank()) {
                helper.setText(msg.htmlBody(), true);
            } else if (msg.textBody() != null) {
                helper.setText(msg.textBody(), false);
            }

            if (msg.cc() != null && !msg.cc().isEmpty()) {
                helper.setCc(msg.cc().toArray(new String[0]));
            }

            mailSender.send(mime);
            log.info("SMTP email sent to {}: {}", msg.to(), msg.subject());
        } catch (MessagingException | java.io.UnsupportedEncodingException e) {
            throw new MailDeliveryException("SMTP send failed to " + msg.to(), e);
        }
    }
}
