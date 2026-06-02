package com.hrms.api.mail;

import java.util.List;

/**
 * Immutable email message. Both {@link SmtpMailService} and {@link BrevoMailService}
 * consume this record — swap providers by changing {@code unifiedtree.mail.provider}.
 */
public record EmailMessage(
    String to,
    String toName,      // nullable — used in "Name <email>" formatting
    String subject,
    String htmlBody,
    String textBody,    // nullable — plain-text fallback
    List<String> cc     // nullable or empty
) {
    /** Convenience constructor for simple one-recipient emails with no CC. */
    public static EmailMessage simple(String to, String subject, String htmlBody) {
        return new EmailMessage(to, null, subject, htmlBody, null, List.of());
    }
}
