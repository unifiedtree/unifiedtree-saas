package com.hrms.api.mail;

/**
 * Provider-agnostic email abstraction.
 *
 * <p>Active implementation is selected by {@code unifiedtree.mail.provider}:
 * <ul>
 *   <li>{@code smtp} (default) — {@link SmtpMailService}, works with Mailpit for local dev
 *       and any SMTP server (Gmail, SendGrid, etc.) in production.</li>
 *   <li>{@code brevo} — {@link BrevoMailService}, uses the Brevo transactional REST API.
 *       Requires {@code BREVO_API_KEY} env var.</li>
 * </ul>
 *
 * <p>On failure both implementations throw {@link MailDeliveryException} — callers
 * decide whether to propagate or swallow.
 */
public interface MailService {
    void send(EmailMessage message);
}
