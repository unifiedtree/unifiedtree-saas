package com.hrms.api.hiring;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Durable record of every offer email send (hiring_mgmt.offer_email_attempts,
 * V141). Kept behind an interface so the delivery state machine can be
 * exercised against an in-memory store in tests — the failure cases (provider
 * rejection, timeout, lost DB write after acceptance) cannot be produced
 * safely against the running mail catcher.
 */
public interface OfferEmailAttemptStore {

    String PENDING = "PENDING";
    String ACCEPTED = "ACCEPTED";
    String NOT_SENT = "NOT_SENT";
    String UNCERTAIN = "UNCERTAIN";

    record Attempt(UUID id, UUID offerId, String recipient, String status, String failureReason,
                   String requestedBy, Instant createdAt, Instant completedAt,
                   String resolvedBy, String resolutionNote) {}

    /** The offer's unresolved attempt (PENDING or UNCERTAIN), if any. */
    Optional<Attempt> openAttempt(UUID offerId);

    /** Record a new PENDING attempt; returns its id. */
    UUID start(UUID offerId, String recipient, String requestedBy);

    /** Finish an attempt with the provider outcome. */
    void complete(UUID attemptId, String status, String failureReason);

    /** Operator-recorded outcome for a PENDING/UNCERTAIN attempt. */
    void resolve(UUID attemptId, String status, String resolvedBy, String note);

    Optional<Attempt> find(UUID attemptId);

    List<Attempt> list(UUID offerId);
}
