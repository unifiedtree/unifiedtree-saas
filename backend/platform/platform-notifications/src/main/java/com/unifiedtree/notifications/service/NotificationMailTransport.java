package com.unifiedtree.notifications.service;

/**
 * Sends one notification email. Implemented in the application layer
 * ({@code com.hrms.api.mail.MailServiceNotificationTransport}) over the
 * configured mail provider; this module only composes the message.
 *
 * <p>Implementations may throw; callers log and carry on (a failed email never
 * fails the action that caused it).
 */
public interface NotificationMailTransport {
    void send(String to, String toName, String subject, String html);
}
