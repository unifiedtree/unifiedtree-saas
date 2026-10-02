package com.hrms.api.ess.needs;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One thing on Home's "Needs you" (BW-120): something only this person can do.
 *
 * @param kind    MISSED_PUNCH_OUT, DOCUMENT_REDO, DOCUMENT_MISSING, ONBOARDING_TASK,
 *                INTERVIEW_SCORECARD, SELF_REVIEW, REVIEWS_TO_WRITE, POLICY_TO_ACCEPT, PROBATION_DECISION,
 *                ASSET_TO_CONFIRM or TIMESHEET_SENT_BACK
 * @param title   what to do, in plain words: "Fix your missed punch-out", "Upload your PAN card again"
 * @param detail  the sub-line: the day, the reason HR gave, the cycle, the names
 * @param onDate  the day it is about (a missed punch-out, an interview, a probation end); null when none
 * @param dueDate a deadline the data really has (an onboarding task's due date, a probation end); null otherwise
 * @param tone    the design's colour for it: bad (red), gold, blue or brand
 * @param refId   the record it is about, when it is one record
 * @param count   how many things the row stands for (grouped rows); 1 otherwise
 * @param link    the page where it is done
 */
public record NeedsYouItem(
        String kind,
        String title,
        String detail,
        LocalDate onDate,
        LocalDate dueDate,
        String tone,
        UUID refId,
        int count,
        String link) {

    public static final String BAD = "bad";
    public static final String GOLD = "gold";
    public static final String BLUE = "blue";
    public static final String BRAND = "brand";

    /**
     * The rows, how many things they add up to (the greeting's "N things need
     * you"), the sources that were read, and the ones that could not be.
     */
    public record Response(List<NeedsYouItem> items, int count, List<String> included, List<String> unavailable) {}
}
