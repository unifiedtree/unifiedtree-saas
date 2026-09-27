package com.hrms.attendance.service;

import com.hrms.attendance.entity.AttendanceEventLog;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.enums.AttendanceEventType;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * The rules behind a person's own day on the web (V143.53 redesign: breaks,
 * BW-26, and undo check-out, BW-25), kept free of Spring so they are tested on
 * their own.
 *
 * <p><b>Breaks</b> are only BREAK_START / BREAK_END rows in
 * attendance.event_logs (the check has always allowed them). They never touch
 * the attendance record, so worked hours, overtime and pay are exactly what
 * they were: check-in to check-out. They only let "Your day" pause its timer.
 *
 * <p><b>Undo check-out</b> takes back the person's OWN check-out, on the same
 * day, within {@link #UNDO_WINDOW}. A check-out someone else recorded (HR's
 * manual entry, an approved fix, a manager's assisted punch) is not theirs to
 * take back.
 */
public final class SelfPunchRules {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** How long after checking out a person may take it back. */
    public static final Duration UNDO_WINDOW = Duration.ofMinutes(10);

    // Refusal codes (the API's errorCode).
    public static final String NOT_CHECKED_IN = "NOT_CHECKED_IN";
    public static final String NOT_CHECKED_OUT = "NOT_CHECKED_OUT";
    public static final String UNDO_NOT_OWN = "CHECKOUT_UNDO_NOT_OWN";
    public static final String UNDO_WINDOW_PASSED = "CHECKOUT_UNDO_WINDOW_PASSED";
    public static final String UNDO_DECIDED = "CHECKOUT_UNDO_DECIDED";

    private SelfPunchRules() {}

    /** One break: when it started, and when it ended (null while it is still on). */
    public record BreakSpan(Instant startedAt, Instant endedAt) {}

    /**
     * The breaks of one day. {@code breakMinutes} counts the finished breaks and
     * the open one up to {@code now}.
     */
    public record BreakState(boolean onBreak, Instant openSince, int breakMinutes, List<BreakSpan> breaks) {
        public static final BreakState NONE = new BreakState(false, null, 0, List.of());
    }

    /**
     * Pairs a day's BREAK_START / BREAK_END events into breaks. Oldest first,
     * whatever order they come in. A start while a break is already open, or an
     * end with none open, is ignored, so an odd log can never produce a negative
     * or double-counted break.
     */
    public static BreakState breaks(List<AttendanceEventLog> events, Instant now) {
        if (events == null || events.isEmpty()) return BreakState.NONE;
        List<AttendanceEventLog> sorted = events.stream()
                .filter(e -> e != null && e.getEventAt() != null
                        && (e.getEventType() == AttendanceEventType.BREAK_START || e.getEventType() == AttendanceEventType.BREAK_END))
                .sorted(Comparator.comparing(AttendanceEventLog::getEventAt))
                .toList();
        List<BreakSpan> spans = new ArrayList<>();
        Instant open = null;
        long seconds = 0;
        for (AttendanceEventLog e : sorted) {
            if (e.getEventType() == AttendanceEventType.BREAK_START) {
                if (open == null) open = e.getEventAt();
            } else if (open != null) {
                Instant end = e.getEventAt().isBefore(open) ? open : e.getEventAt();
                spans.add(new BreakSpan(open, end));
                seconds += Duration.between(open, end).getSeconds();
                open = null;
            }
        }
        if (open != null) {
            spans.add(new BreakSpan(open, null));
            if (now != null && now.isAfter(open)) seconds += Duration.between(open, now).getSeconds();
        }
        return new BreakState(open != null, open, (int) (seconds / 60), List.copyOf(spans));
    }

    /**
     * Why this person may NOT take back the check-out on {@code record}, as an
     * error code, or null when they may.
     *
     * @param today              today in India
     * @param punchedOutByOther  a manager or HR punched them out (assisted punch)
     * @param overtimeDecided    someone already approved or rejected the day's overtime
     */
    public static String undoRefusal(AttendanceRecord record, LocalDate today, Instant now,
                                     boolean punchedOutByOther, boolean overtimeDecided) {
        if (record == null || record.getCheckInAt() == null) return NOT_CHECKED_IN;
        if (record.getCheckOutAt() == null) return NOT_CHECKED_OUT;
        if (record.isManualEntry() || record.isRegularized() || punchedOutByOther) return UNDO_NOT_OWN;
        Instant out = record.getCheckOutAt();
        if (!today.equals(record.getAttendanceDate()) || !today.equals(out.atZone(IST).toLocalDate())) return UNDO_WINDOW_PASSED;
        if (now.isBefore(out) || Duration.between(out, now).compareTo(UNDO_WINDOW) > 0) return UNDO_WINDOW_PASSED;
        if (overtimeDecided) return UNDO_DECIDED;
        return null;
    }

    /** Until when the check-out on {@code record} can be taken back (check-out + 10 minutes), or null without one. */
    public static Instant undoUntil(AttendanceRecord record) {
        return record == null || record.getCheckOutAt() == null ? null : record.getCheckOutAt().plus(UNDO_WINDOW);
    }

    /** The plain-English sentence for a refusal code. */
    public static String undoMessage(String code) {
        return switch (code) {
            case NOT_CHECKED_IN -> "You haven't checked in today, so there's no check-out to undo.";
            case NOT_CHECKED_OUT -> "You haven't checked out yet, so there's nothing to undo.";
            case UNDO_NOT_OWN -> "HR or your manager recorded this check-out, so only they can change it. Ask them, or raise a fix request.";
            case UNDO_WINDOW_PASSED -> "A check-out can be undone only on the same day, within 10 minutes. Raise a fix request instead.";
            case UNDO_DECIDED -> "Today's overtime has already been reviewed, so the check-out can't be undone. Raise a fix request instead.";
            default -> "The check-out can't be undone.";
        };
    }
}
