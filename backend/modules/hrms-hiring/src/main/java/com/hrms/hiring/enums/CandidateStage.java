package com.hrms.hiring.enums;

/**
 * Position of a candidate in the hiring pipeline:
 * APPLIED → SCREENING → INTERVIEW → OFFER → (HIRED | REJECTED)
 */
public enum CandidateStage {
    APPLIED,
    SCREENING,
    INTERVIEW,
    OFFER,
    HIRED,
    REJECTED
}
