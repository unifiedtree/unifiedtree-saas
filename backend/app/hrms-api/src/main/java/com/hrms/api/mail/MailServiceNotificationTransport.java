package com.hrms.api.mail;

import com.unifiedtree.notifications.service.NotificationMailTransport;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Lets the notification dispatcher (platform-notifications) send the emails
 * people opt into, through whichever mail provider is configured
 * ({@link MailService}: SMTP or Brevo).
 */
@Component
public class MailServiceNotificationTransport implements NotificationMailTransport {

    private final MailService mail;

    public MailServiceNotificationTransport(MailService mail) {
        this.mail = mail;
    }

    @Override
    public void send(String to, String toName, String subject, String html) {
        mail.send(new EmailMessage(to, toName, subject, html, null, List.of()));
    }
}
