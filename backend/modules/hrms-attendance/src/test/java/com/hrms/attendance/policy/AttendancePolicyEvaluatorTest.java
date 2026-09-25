package com.hrms.attendance.policy;

import com.hrms.attendance.policy.AttendancePolicyEvaluator.DayFacts;
import com.hrms.attendance.policy.AttendancePolicyEvaluator.EmployeeContext;
import com.hrms.attendance.policy.AttendancePolicyEvaluator.ManualStatus;
import com.hrms.attendance.policy.AttendancePolicyEvaluator.ShiftSlot;
import com.hrms.attendance.policy.AttendanceTimingPolicy.AfterAllowance;
import com.hrms.attendance.policy.AttendanceTimingPolicy.AllowancePeriod;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** The attendance timing policy rules (V143.10), one scenario per test. */
class AttendancePolicyEvaluatorTest {

    private static final UUID EMP = UUID.randomUUID();
    private static final UUID CO = UUID.randomUUID();
    // Monday 21 Sep 2026 .. Sunday 27 Sep 2026; "today" is Friday 25 Sep.
    private static final LocalDate MON = LocalDate.of(2026, 9, 21);
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 25);
    private static final ShiftSlot GENERAL = new ShiftSlot("General", LocalTime.of(9, 0), LocalTime.of(18, 0), 15);
    private static final EmployeeContext CTX = new EmployeeContext(EMP, LocalDate.of(2026, 1, 1), null, Set.of(6, 7));

    private static Instant ist(LocalDate d, int h, int m) {
        return d.atTime(h, m).atZone(AttendancePolicyEvaluator.IST).toInstant();
    }

    private static DayFacts punch(LocalDate d, int inH, int inM, Integer outH, Integer outM) {
        return new DayFacts(d, ist(d, inH, inM), outH == null ? null : ist(d, outH, outM), "OFFICE",
                false, false, GENERAL, false, false, null, null);
    }

    private static AttendanceTimingPolicy policy(Integer halfDayLate, Double fullDay, Double halfDay, int early,
                                                 int allowance, AllowancePeriod period, AfterAllowance after) {
        return new AttendanceTimingPolicy(CO, 15, LocalTime.of(9, 15), halfDayLate, fullDay, halfDay, early,
                allowance, period, after, DayOfWeek.MONDAY);
    }

    private static Map<LocalDate, EffectiveDay> run(AttendanceTimingPolicy p, List<DayFacts> days) {
        return AttendancePolicyEvaluator.evaluate(CTX, days, p, TODAY);
    }

    @Test
    void defaultsKeepTheOldBehaviour() {
        AttendanceTimingPolicy p = AttendanceTimingPolicy.defaults(CO);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(
                punch(MON, 9, 10, 18, 0),                 // inside the shift's 15-minute grace
                punch(MON.plusDays(1), 9, 40, 18, 0)));   // 40 minutes after the start
        assertEquals(EffectiveDay.PRESENT, r.get(MON).status());
        assertNull(r.get(MON).lateMinutes());
        assertEquals(EffectiveDay.LATE, r.get(MON.plusDays(1)).status());
        assertEquals(40, r.get(MON.plusDays(1)).lateMinutes());
        assertEquals(1.0, r.get(MON.plusDays(1)).payableFraction());
    }

    @Test
    void noShiftUsesTheCompanyStartTimeAndGrace() {
        AttendanceTimingPolicy p = AttendanceTimingPolicy.defaults(CO); // 09:15 + 15 = 09:30 cut-off
        DayFacts onTime = new DayFacts(MON, ist(MON, 9, 29), null, "OFFICE", false, false, null, false, false, null, null);
        DayFacts late = new DayFacts(MON.plusDays(1), ist(MON.plusDays(1), 9, 31), null, "OFFICE", false, false, null, false, false, null, null);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(onTime, late));
        assertEquals(EffectiveDay.PRESENT, r.get(MON).status());
        assertEquals(EffectiveDay.LATE, r.get(MON.plusDays(1)).status());
    }

    @Test
    void companyGraceAppliesWhenTheShiftHasNone() {
        ShiftSlot noGrace = new ShiftSlot("Early", LocalTime.of(9, 0), LocalTime.of(18, 0), 0);
        AttendanceTimingPolicy p = AttendanceTimingPolicy.defaults(CO).withGraceAndWeekStart(20, DayOfWeek.MONDAY);
        DayFacts d = new DayFacts(MON, ist(MON, 9, 18), ist(MON, 18, 0), "OFFICE", false, false, noGrace, false, false, null, null);
        assertEquals(EffectiveDay.PRESENT, run(p, List.of(d)).get(MON).status());
    }

    @Test
    void theClientExampleTwoLateArrivalsAWeekAreFineThenHalfDays() {
        AttendanceTimingPolicy p = policy(null, null, null, 0, 2, AllowancePeriod.WEEK, AfterAllowance.HALF_DAY);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(
                punch(MON, 10, 0, 18, 0),
                punch(MON.plusDays(1), 10, 0, 18, 0),
                punch(MON.plusDays(2), 10, 0, 18, 0)));
        assertEquals(EffectiveDay.PRESENT, r.get(MON).status());
        assertTrue(r.get(MON).withinAllowance());
        assertEquals(1, r.get(MON).allowanceUsed());
        assertEquals(EffectiveDay.PRESENT, r.get(MON.plusDays(1)).status());
        assertEquals(EffectiveDay.HALF_DAY, r.get(MON.plusDays(2)).status());
        assertEquals(0.5, r.get(MON.plusDays(2)).payableFraction());
        assertTrue(r.get(MON.plusDays(2)).note().contains("half day"));
    }

    @Test
    void theAllowanceStartsAgainEachWeek() {
        AttendanceTimingPolicy p = policy(null, null, null, 0, 1, AllowancePeriod.WEEK, AfterAllowance.KEEP_LATE);
        LocalDate prevFri = MON.minusDays(3);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(punch(prevFri, 10, 0, 18, 0), punch(MON, 10, 0, 18, 0), punch(MON.plusDays(1), 10, 0, 18, 0)));
        assertEquals(EffectiveDay.PRESENT, r.get(prevFri).status());
        assertEquals(EffectiveDay.PRESENT, r.get(MON).status(), "new week, allowance again");
        assertEquals(EffectiveDay.LATE, r.get(MON.plusDays(1)).status());
    }

    @Test
    void lossOfPayAfterTheMonthlyAllowance() {
        AttendanceTimingPolicy p = policy(null, null, null, 0, 1, AllowancePeriod.MONTH, AfterAllowance.LOSS_OF_PAY);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(punch(MON, 9, 45, 18, 0), punch(MON.plusDays(1), 9, 45, 18, 0)));
        assertEquals(EffectiveDay.PRESENT, r.get(MON).status());
        EffectiveDay second = r.get(MON.plusDays(1));
        assertEquals(EffectiveDay.LATE, second.status());
        assertTrue(second.lossOfPay());
        assertEquals(0.0, second.payableFraction());
    }

    @Test
    void arrivingPastTheHalfDayLimitIsAHalfDayEvenWithAllowanceLeft() {
        AttendanceTimingPolicy p = policy(120, null, null, 0, 5, AllowancePeriod.MONTH, AfterAllowance.KEEP_LATE);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(punch(MON, 11, 30, 18, 0), punch(MON.plusDays(1), 10, 0, 18, 0)));
        assertEquals(EffectiveDay.HALF_DAY, r.get(MON).status());
        assertEquals(EffectiveDay.PRESENT, r.get(MON.plusDays(1)).status());
        assertEquals(1, r.get(MON.plusDays(1)).allowanceUsed(), "a half day doesn't use the allowance");
    }

    @Test
    void hoursRulesMakeHalfDaysAndAbsences() {
        AttendanceTimingPolicy p = policy(null, 8.0, 4.0, 0, 0, AllowancePeriod.MONTH, AfterAllowance.KEEP_LATE);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(
                punch(MON, 9, 0, 14, 0),                 // 5 h: under 8, over 4
                punch(MON.plusDays(1), 9, 0, 12, 0),     // 3 h: under 4
                punch(MON.plusDays(2), 9, 0, 18, 0)));   // 9 h
        assertEquals(EffectiveDay.HALF_DAY, r.get(MON).status());
        assertEquals(EffectiveDay.ABSENT, r.get(MON.plusDays(1)).status());
        assertEquals(EffectiveDay.PRESENT, r.get(MON.plusDays(2)).status());
        assertEquals(300, r.get(MON).workedMinutes());
    }

    @Test
    void earlyLeaveNeedsToPassTheThreshold() {
        AttendanceTimingPolicy p = policy(null, null, null, 30, 0, AllowancePeriod.MONTH, AfterAllowance.KEEP_LATE);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(punch(MON, 9, 0, 17, 40), punch(MON.plusDays(1), 9, 0, 17, 0)));
        assertFalse(r.get(MON).earlyLeave(), "20 minutes early is inside the 30-minute threshold");
        assertTrue(r.get(MON.plusDays(1)).earlyLeave());
        assertEquals(60, r.get(MON.plusDays(1)).earlyByMinutes());
    }

    @Test
    void noPunchDaysAreAbsentOnlyOnceTheDayIsOver() {
        AttendanceTimingPolicy p = AttendanceTimingPolicy.defaults(CO);
        LocalDate sat = MON.plusDays(5);
        List<DayFacts> days = new ArrayList<>();
        days.add(DayFacts.empty(MON.plusDays(3)));                        // Thursday, past
        days.add(DayFacts.empty(TODAY));                                   // today
        days.add(new DayFacts(MON.plusDays(1), null, null, null, true, false, GENERAL, false, false, null, null)); // leave
        days.add(new DayFacts(MON.plusDays(2), null, null, null, false, true, GENERAL, false, false, null, null)); // holiday
        days.add(DayFacts.empty(sat));                                     // weekly off, future
        Map<LocalDate, EffectiveDay> r = run(p, days);
        assertEquals(EffectiveDay.ABSENT, r.get(MON.plusDays(3)).status());
        assertEquals(0.0, r.get(MON.plusDays(3)).payableFraction());
        assertEquals(EffectiveDay.NOT_MARKED, r.get(TODAY).status());
        assertEquals(EffectiveDay.ON_LEAVE, r.get(MON.plusDays(1)).status());
        assertEquals(EffectiveDay.HOLIDAY, r.get(MON.plusDays(2)).status());
        assertEquals(EffectiveDay.UPCOMING, r.get(sat).status());
    }

    @Test
    void weeklyOffPastIsWeeklyOffAndDaysBeforeJoiningAreNotTracked() {
        EmployeeContext joinedWed = new EmployeeContext(EMP, MON.plusDays(2), null, Set.of(6, 7));
        LocalDate sun = MON.minusDays(1);
        Map<LocalDate, EffectiveDay> r = AttendancePolicyEvaluator.evaluate(joinedWed,
                List.of(DayFacts.empty(sun), DayFacts.empty(MON), DayFacts.empty(MON.plusDays(3))), AttendanceTimingPolicy.defaults(CO), TODAY);
        assertEquals(EffectiveDay.NOT_TRACKED, r.get(sun).status());
        assertEquals(EffectiveDay.NOT_TRACKED, r.get(MON).status());
        assertEquals(EffectiveDay.ABSENT, r.get(MON.plusDays(3)).status());
    }

    @Test
    void aManualStatusWinsAndDoesNotUseTheAllowance() {
        AttendanceTimingPolicy p = policy(null, null, null, 0, 1, AllowancePeriod.WEEK, AfterAllowance.HALF_DAY);
        ManualStatus excused = new ManualStatus(EffectiveDay.PRESENT, "EXCUSE", "Hospital visit", "Asha Rao", Instant.now());
        DayFacts mon = new DayFacts(MON, ist(MON, 10, 0), ist(MON, 18, 0), "OFFICE", false, false, GENERAL, false, false, null, excused);
        Map<LocalDate, EffectiveDay> r = run(p, List.of(mon, punch(MON.plusDays(1), 10, 0, 18, 0)));
        EffectiveDay m = r.get(MON);
        assertEquals(EffectiveDay.PRESENT, m.status());
        assertTrue(m.manual());
        assertTrue(m.note().startsWith("Excused by Asha Rao: Hospital visit"));
        assertEquals(EffectiveDay.PRESENT, r.get(MON.plusDays(1)).status(), "the excused day didn't use the one allowance");
    }

    @Test
    void aManualAbsentOnAPunchedDayPaysNothing() {
        ManualStatus absent = new ManualStatus(EffectiveDay.ABSENT, "SET", "Punched from home without WFH", "HR", Instant.now());
        DayFacts d = new DayFacts(MON, ist(MON, 9, 0), ist(MON, 18, 0), "OFFICE", false, false, GENERAL, false, false, null, absent);
        EffectiveDay e = run(AttendanceTimingPolicy.defaults(CO), List.of(d)).get(MON);
        assertEquals(EffectiveDay.ABSENT, e.status());
        assertEquals(EffectiveDay.PRESENT, e.computedStatus());
        assertEquals(0.0, e.payableFraction());
    }

    @Test
    void aRejectedFacePunchDoesNotCount() {
        DayFacts d = new DayFacts(MON, ist(MON, 9, 0), null, "OFFICE", false, false, GENERAL, true, false, null, null);
        DayFacts today = new DayFacts(TODAY, ist(TODAY, 9, 0), null, "OFFICE", false, false, GENERAL, true, false, null, null);
        Map<LocalDate, EffectiveDay> r = run(AttendanceTimingPolicy.defaults(CO), List.of(d, today));
        assertEquals(EffectiveDay.ABSENT, r.get(MON).status());
        assertTrue(r.get(MON).punchRejected());
        assertFalse(r.get(MON).hasPunch());
        assertEquals(EffectiveDay.NOT_MARKED, r.get(TODAY).status());
    }

    @Test
    void workingOnAWeeklyOffIsPresentAndOutsideTheZoneIsFlagged() {
        LocalDate sat = MON.minusDays(2);
        DayFacts d = new DayFacts(sat, ist(sat, 11, 0), ist(sat, 15, 0), "OFFICE", false, false, GENERAL, false, true, 420, null);
        EffectiveDay e = run(AttendanceTimingPolicy.defaults(CO), List.of(d)).get(sat);
        assertEquals(EffectiveDay.PRESENT, e.status());
        assertNull(e.lateMinutes());
        assertTrue(e.outsideGeofence());
        assertEquals(420, e.distanceMeters());
    }

    @Test
    void periodStartFollowsTheWorkWeek() {
        AttendanceTimingPolicy week = new AttendanceTimingPolicy(CO, 15, LocalTime.of(9, 15), null, null, null, 0, 2,
                AllowancePeriod.WEEK, AfterAllowance.KEEP_LATE, DayOfWeek.SUNDAY);
        assertEquals(MON.minusDays(1), AttendancePolicyEvaluator.periodStart(week, MON.plusDays(2)));
        assertEquals(LocalDate.of(2026, 9, 1), AttendancePolicyEvaluator.periodStart(AttendanceTimingPolicy.defaults(CO), MON));
    }
}
