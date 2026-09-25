package com.hrms.api.mail;

import java.util.List;

/**
 * Immutable email message. Both {@link SmtpMailService} and {@link BrevoMailService}
 * consume this record — swap providers by changing {@code unifiedtree.mail.provider}.
 *
 * <p>{@code fromName} is the display name on the From line. White label: an
 * email sent on behalf of a workspace (invitations, password resets, probation
 * reminders, offers, letters) carries the workspace or company name there, never
 * the vendor's. Null means the platform default ({@code unifiedtree.mail.from-name}),
 * which is used only for platform-level mail (signup, billing, internal alerts).
 */
public record EmailMessage(
    String to,
    String toName,      // nullable — used in "Name <email>" formatting
    String subject,
    String htmlBody,
    String textBody,    // nullable — plain-text fallback
    List<String> cc,    // nullable or empty
    List<Attachment> attachments,
    String fromName     // nullable — sender display name; null = platform default
) {
    public record Attachment(String filename, String contentType, byte[] bytes) {}
    public EmailMessage(String to, String toName, String subject, String htmlBody, String textBody, List<String> cc,
                        List<Attachment> attachments) {
        this(to, toName, subject, htmlBody, textBody, cc, attachments, null);
    }
    public EmailMessage(String to, String toName, String subject, String htmlBody, String textBody, List<String> cc) {
        this(to, toName, subject, htmlBody, textBody, cc, List.of(), null);
    }
    /** Convenience constructor for simple one-recipient emails with no CC. */
    public static EmailMessage simple(String to, String subject, String htmlBody) {
        return new EmailMessage(to, null, subject, htmlBody, null, List.of());
    }
    /** The same message sent under {@code name} (a workspace or company name). */
    public EmailMessage withFromName(String name) {
        return new EmailMessage(to, toName, subject, htmlBody, textBody, cc, attachments, safeName(name));
    }
    /** The From display name to use: this message's own, else {@code fallback}. */
    public String senderName(String fallback) {
        String own = safeName(fromName);
        return own == null ? fallback : own;
    }
    /** One line, no control characters, at most 70 characters; null when blank. */
    static String safeName(String name) {
        if (name == null) return null;
        String s = name.replaceAll("[\\p{Cntrl}\"<>]", " ").replaceAll("\\s+", " ").strip();
        if (s.isEmpty()) return null;
        return s.length() > 70 ? s.substring(0, 70).strip() : s;
    }
}
