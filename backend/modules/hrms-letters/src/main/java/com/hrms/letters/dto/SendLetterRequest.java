package com.hrms.letters.dto;

/**
 * Email a generated letter. {@code requestSignature} (redesign BW-76, optional)
 * asks the employee to sign it (click to accept) in My letters.
 */
public record SendLetterRequest(
        String toEmail,
        String ccEmail,
        Boolean requestSignature
) {
    /** Today's shape (no signature asked). */
    public SendLetterRequest(String toEmail, String ccEmail) {
        this(toEmail, ccEmail, null);
    }

    public boolean signatureAsked() {
        return Boolean.TRUE.equals(requestSignature);
    }
}
