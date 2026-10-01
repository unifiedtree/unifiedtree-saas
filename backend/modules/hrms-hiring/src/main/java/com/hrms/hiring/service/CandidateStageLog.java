package com.hrms.hiring.service;

import com.hrms.hiring.enums.CandidateStage;

import java.util.UUID;

/**
 * The candidate's stage history (hiring_mgmt.candidate_stage_events, V143.59).
 * {@link HiringService} calls it for every move, inside the transaction that
 * makes the move, so a move and its history row commit or roll back together.
 * The API layer supplies the JDBC implementation; it skips the write while the
 * migration is not applied, and never swallows any other database error.
 */
public interface CandidateStageLog {

    /** What caused the move; stored as the event kind. */
    enum Kind { ADDED, STAGE_CHANGE, OFFER_CREATED, OFFER_ACCEPTED, CONVERTED }

    /** {@code from} is null when the candidate was just added. */
    void record(UUID candidateId, CandidateStage from, CandidateStage to, Kind kind);

    /** For tests and for wiring without the API layer: records nothing. */
    CandidateStageLog NONE = (candidateId, from, to, kind) -> { };
}
