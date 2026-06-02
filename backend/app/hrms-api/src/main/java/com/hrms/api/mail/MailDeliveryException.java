package com.hrms.api.mail;

/** Thrown when an email cannot be delivered via any configured provider. */
public class MailDeliveryException extends RuntimeException {
    public MailDeliveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
