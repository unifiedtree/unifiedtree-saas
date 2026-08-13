package com.hrms.hiring.enums;

/**
 * Position of a candidate in the hiring pipeline:
 * APPLIED → SCREENING → INTERVIEW → OFFER → HIRED (forward-only)
 * Any → REJECTED or WITHDRAWN (terminal at any point).
 *
 * <p>Ordering matters: HiringService.updateStage compares ordinals to enforce
 * forward-only progression through the funnel — do NOT reorder the funnel
 * constants (APPLIED..HIRED) without updating that check. Terminal states
 * (REJECTED, WITHDRAWN) are placed after HIRED but are excluded from the
 * funnel comparison explicitly, so their position is presentation-only.
 *
 * <p>WITHDRAWN added 2026-08-13 (Bundle H) alongside the transition-matrix
 * enforcement — candidates who pull out of the process are structurally
 * different from ones we rejected, and the two used to collapse into REJECTED.
 */
public enum CandidateStage {
    APPLIED,
    SCREENING,
    INTERVIEW,
    OFFER,
    HIRED,
    REJECTED,
    WITHDRAWN
}
