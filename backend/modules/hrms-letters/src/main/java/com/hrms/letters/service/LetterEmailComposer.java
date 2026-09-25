package com.hrms.letters.service;

import com.hrms.letters.domain.GeneratedLetter;

/**
 * Optional hook that lets the application layer word the email a generated
 * letter is sent in (the company's "letters.letter" notification template).
 * The letters module has no dependency on the notification templates, so the
 * implementation lives in {@code com.hrms.api.letters}.
 */
public interface LetterEmailComposer {

    /** Subject and HTML body to email. */
    record Content(String subject, String html) {}

    /**
     * @return the email to send for this letter, or null to send the letter
     *         itself (its subject and rendered body), as before
     */
    Content compose(GeneratedLetter letter);
}
