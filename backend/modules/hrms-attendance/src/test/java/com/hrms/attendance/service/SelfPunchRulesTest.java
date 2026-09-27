package com.hrms.attendance.service;

import com.hrms.attendance.entity.AttendanceEventLog;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.enums.AttendanceEventType;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Breaks (BW-26) and undo check-out (BW-25): the pure rules. Breaks are paired
 * from the event log and never touch the record; a check-out can be taken back
 * only by its owner, on the same day, within 10 minutes.
 */
class SelfPunchRulesTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final LocalDate DAY = LocalDate.of(2026, 9, 28);

    private static Instant at(String hhmm) {
        return DAY.atTime(java.time.LocalTime.parse(hhmm)).atZone(IST).toInstant();
    }

    private static AttendanceEventLog event(AttendanceEventType type, String hhmm) {
        AttendanceEventLog e = new AttendanceEventLog();
        e.setEventType(type);
        e.setEventAt(at(hhmm));
        return e;
    }

    // ── breaks ───────────────────────────────────────────────────────────────

    @Test void noBreaksIsNothing() {
        assertSame(SelfPunchRules.BreakState.NONE, SelfPunchRules.breaks(List.of(), at("12:00")));
        assertSame(SelfPunchRules.BreakState.NONE, SelfPunchRules.breaks(null, at("12:00")));
    }

    @Test void finishedBreaksAreSummedAndAnOpenOneRunsToNow() {
        List<AttendanceEventLog> events = new ArrayList<>(List.of(
                event(AttendanceEventType.CHECK_IN, "09:00"),
                event(AttendanceEventType.BREAK_START, "11:00"),
                event(AttendanceEventType.BREAK_END, "11:15"),
                event(AttendanceEventType.BREAK_START, "13:00")));
        SelfPunchRules.BreakState s = SelfPunchRules.breaks(events, at("13:20"));
        assertTrue(s.onBreak());
        assertEquals(at("13:00"), s.openSince());
        assertEquals(35, s.breakMinutes());
        assertEquals(2, s.breaks().size());
        assertNull(s.breaks().get(1).endedAt());
    }

    @Test void eventsOutOfOrderAreSortedFirst() {
        SelfPunchRules.BreakState s = SelfPunchRules.breaks(List.of(
                event(AttendanceEventType.BREAK_END, "11:30"),
                event(AttendanceEventType.BREAK_START, "11:00")), at("12:00"));
        assertFalse(s.onBreak());
        assertEquals(30, s.breakMinutes());
    }

    @Test void aSecondStartOrAStrayEndNeverDoubleCounts() {
        SelfPunchRules.BreakState s = SelfPunchRules.breaks(List.of(
                event(AttendanceEventType.BREAK_END, "10:00"),     // no break open: ignored
                event(AttendanceEventType.BREAK_START, "11:00"),
                event(AttendanceEventType.BREAK_START, "11:05"),   // already on one: ignored
                event(AttendanceEventType.BREAK_END, "11:20")), at("12:00"));
        assertFalse(s.onBreak());
        assertEquals(20, s.breakMinutes());
        assertEquals(1, s.breaks().size());
    }

    // ── undo check-out ───────────────────────────────────────────────────────

    private static AttendanceRecord checkedOut(String in, String out) {
        AttendanceRecord r = new AttendanceRecord();
        r.setAttendanceDate(DAY);
        r.setCheckInAt(at(in));
        r.setCheckOutAt(out == null ? null : at(out));
        return r;
    }

    @Test void theOwnerMayUndoWithinTenMinutes() {
        AttendanceRecord r = checkedOut("09:00", "18:00");
        assertNull(SelfPunchRules.undoRefusal(r, DAY, at("18:00"), false, false));
        assertNull(SelfPunchRules.undoRefusal(r, DAY, at("18:10"), false, false));
        assertEquals(at("18:10"), SelfPunchRules.undoUntil(r));
    }

    @Test void afterTenMinutesItIsTooLate() {
        AttendanceRecord r = checkedOut("09:00", "18:00");
        assertEquals(SelfPunchRules.UNDO_WINDOW_PASSED, SelfPunchRules.undoRefusal(r, DAY, at("18:11"), false, false));
    }

    @Test void onlyTheSameDay() {
        AttendanceRecord r = checkedOut("09:00", "18:00");
        assertEquals(SelfPunchRules.UNDO_WINDOW_PASSED,
                SelfPunchRules.undoRefusal(r, DAY.plusDays(1), at("18:05"), false, false));
    }

    @Test void notInOrNotOutHasNothingToUndo() {
        assertEquals(SelfPunchRules.NOT_CHECKED_IN, SelfPunchRules.undoRefusal(null, DAY, at("18:05"), false, false));
        assertEquals(SelfPunchRules.NOT_CHECKED_OUT,
                SelfPunchRules.undoRefusal(checkedOut("09:00", null), DAY, at("18:05"), false, false));
    }

    @Test void aCheckOutSomeoneElseRecordedIsNotTheirsToUndo() {
        AttendanceRecord manual = checkedOut("09:00", "18:00");
        manual.setManualEntry(true);
        assertEquals(SelfPunchRules.UNDO_NOT_OWN, SelfPunchRules.undoRefusal(manual, DAY, at("18:05"), false, false));
        AttendanceRecord fixed = checkedOut("09:00", "18:00");
        fixed.setRegularized(true);
        assertEquals(SelfPunchRules.UNDO_NOT_OWN, SelfPunchRules.undoRefusal(fixed, DAY, at("18:05"), false, false));
        assertEquals(SelfPunchRules.UNDO_NOT_OWN,
                SelfPunchRules.undoRefusal(checkedOut("09:00", "18:00"), DAY, at("18:05"), true, false));
    }

    @Test void reviewedOvertimeLocksTheCheckOut() {
        assertEquals(SelfPunchRules.UNDO_DECIDED,
                SelfPunchRules.undoRefusal(checkedOut("09:00", "18:00"), DAY, at("18:05"), false, true));
    }

    @Test void everyRefusalHasAPlainSentence() {
        for (String code : List.of(SelfPunchRules.NOT_CHECKED_IN, SelfPunchRules.NOT_CHECKED_OUT, SelfPunchRules.UNDO_NOT_OWN,
                SelfPunchRules.UNDO_WINDOW_PASSED, SelfPunchRules.UNDO_DECIDED)) {
            String m = SelfPunchRules.undoMessage(code);
            assertFalse(m.isBlank());
            assertFalse(m.contains("_"), m);
        }
    }
}
