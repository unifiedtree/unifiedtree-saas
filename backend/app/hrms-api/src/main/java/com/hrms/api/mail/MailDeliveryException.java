package com.hrms.api.mail;

/**
 * A mail send failed. {@link #definitelyNotSent()} is true only when the
 * provider certainly did NOT accept the message (connection refused, bad
 * credentials, recipient rejected, provider 4xx, missing configuration) — the
 * caller may then safely retry. When false, the outcome is unknown (timeout,
 * lost response, provider 5xx): the message may have been accepted, so the
 * caller must not resend automatically.
 */
public class MailDeliveryException extends RuntimeException {

    private final boolean definitelyNotSent;

    public MailDeliveryException(String message, Throwable cause) {
        this(message, cause, false);
    }

    public MailDeliveryException(String message, Throwable cause, boolean definitelyNotSent) {
        super(message, cause);
        this.definitelyNotSent = definitelyNotSent;
    }

    public boolean definitelyNotSent() {
        return definitelyNotSent;
    }
}
