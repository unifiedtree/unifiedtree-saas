package com.hrms.api.letters;

import java.util.UUID;

/**
 * HR sent a letter that asks for the employee's signature (redesign BW-76).
 * Published inside the send's transaction; {@link LetterSignatureNotifier}
 * tells the employee ({@code letters.signature_requested}) after it commits.
 *
 * @param requestedBy who asked, for example "Priya Rao"; null when unknown
 */
public record LetterSignatureRequestedEvent(UUID tenantId, UUID letterId, UUID employeeId, String letterSubject,
                                            String requestedBy) {}
