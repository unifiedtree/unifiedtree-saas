package com.hrms.api.payroll;

import com.hrms.api.payroll.PayrollCalc.AttendancePay;
import com.hrms.payroll.lop.LopCalculator;
import com.hrms.payroll.lop.LopCalculator.DayStatus;
import com.hrms.payroll.lop.LopCalculator.LopInput;
import com.hrms.payroll.lop.LopCalculator.LopResult;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Payroll reads each day's effective attendance status (w1a hook, wave-2
 * integration). PayrollCalc.attendanceDay: status + late mark per day.
 */
class PayrollAttendanceHookTest {

    private static AttendancePay day(String record, String eff, boolean manual, boolean punched, boolean rejected, boolean lop) {
        return PayrollCalc.attendanceDay(record, eff, manual, punched, rejected, lop);
    }

    @Test
    void withoutThePolicyServiceTheStoredStatusDecidesAsBefore() {
        assertEquals(new AttendancePay(DayStatus.PRESENT, true), day("LATE", null, false, false, false, false));
        assertEquals(new AttendancePay(null, false), day("ON_TIME", null, false, false, false, false));
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day("ABSENT", null, false, false, false, false));
        assertEquals(new AttendancePay(DayStatus.HALF_DAY_LEAVE, false), day("HALF_DAY", null, false, false, false, false));
        assertEquals(new AttendancePay(DayStatus.PRESENT, false), day("PENDING_REGULARIZATION", null, false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, null, false, false, false, false));
    }

    @Test
    void presentIsPaidExactlyAsBefore() {
        // On time: the record said ON_TIME → no attendance input (holidays / weekly offs / present decide).
        assertEquals(new AttendancePay(null, false), day("ON_TIME", "PRESENT", false, true, false, false));
        // The stored status said LATE but the policy says present (inside the allowance, or the
        // company's grace is longer): still paid, and no late mark any more.
        assertEquals(new AttendancePay(DayStatus.PRESENT, false), day("LATE", "PRESENT", false, true, false, false));
    }

    @Test
    void lateIsAPaidDayWithALateMarkOrLossOfPay() {
        assertEquals(new AttendancePay(DayStatus.PRESENT, true), day("LATE", "LATE", false, true, false, false));
        // The policy's start time made an ON_TIME record late.
        assertEquals(new AttendancePay(DayStatus.PRESENT, true), day("ON_TIME", "LATE", false, true, false, false));
        // Past the allowance with "loss of pay": unpaid, and not also a late mark.
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day("LATE", "LATE", false, true, false, true));
    }

    @Test
    void halfDayAndAbsentFromThePolicy() {
        assertEquals(new AttendancePay(DayStatus.HALF_DAY_LEAVE, false), day("LATE", "HALF_DAY", false, true, false, false));
        // Worked under the half-day minimum.
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day("ON_TIME", "ABSENT", false, true, false, false));
    }

    @Test
    void aDayWithoutAPunchKeepsTheOldFallback() {
        // Payroll never turns "no punch" into an absence by itself (exception-based pay).
        assertEquals(new AttendancePay(null, false), day(null, "ABSENT", false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, "NOT_MARKED", false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, "NOT_TRACKED", false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, "UPCOMING", false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, "WEEKLY_OFF", false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, "HOLIDAY", false, false, false, false));
        assertEquals(new AttendancePay(null, false), day(null, "ON_LEAVE", false, false, false, false));
        // …except a face punch HR rejected ("not them").
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day("ABSENT", "ABSENT", false, false, true, false));
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day("LATE", "ABSENT", false, false, true, false));
    }

    @Test
    void aStatusHrStoredOnTheRecordIsKept() {
        // Manual entry with an explicit HALF_DAY / ABSENT: the policy doesn't override it.
        assertEquals(new AttendancePay(DayStatus.HALF_DAY_LEAVE, false), day("HALF_DAY", "PRESENT", false, true, false, false));
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day("ABSENT", "LATE", false, true, false, false));
        assertEquals(new AttendancePay(DayStatus.HOLIDAY, false), day("HOLIDAY", "PRESENT", false, true, false, false));
    }

    @Test
    void aReviewersStatusWins() {
        assertEquals(new AttendancePay(DayStatus.PRESENT, false), day("ABSENT", "PRESENT", true, false, false, false));
        assertEquals(new AttendancePay(DayStatus.PRESENT, false), day("LATE", "PRESENT", true, true, false, false)); // excused
        assertEquals(new AttendancePay(DayStatus.UNAUTHORIZED_ABSENT, false), day(null, "ABSENT", true, false, false, false));
        assertEquals(new AttendancePay(DayStatus.HALF_DAY_LEAVE, false), day("ON_TIME", "HALF_DAY", true, true, false, false));
        assertEquals(new AttendancePay(DayStatus.PRESENT, true), day("ON_TIME", "LATE", true, true, false, false));
    }

    /**
     * A whole month through the real LOP maths: approved leave still wins over
     * attendance, late marks only from effective LATE days, and an unconfigured
     * company (records ON_TIME / LATE, policy defaults) is paid as before.
     */
    @Test
    void aMonthThroughTheLopCalculator() {
        YearMonth ym = YearMonth.of(2026, 9);
        LocalDate start = ym.atDay(1), end = ym.atEndOfMonth();
        Set<Integer> offs = Set.of(6, 7);

        // Before: stored statuses only. 5 LATE records, 1 ABSENT record, 1 paid leave day.
        Map<LocalDate, String> records = new java.util.HashMap<>();
        for (int d : new int[] {1, 2, 3, 4, 7}) records.put(ym.atDay(d), "LATE");
        records.put(ym.atDay(8), "ABSENT");
        for (int d : new int[] {9, 10, 11}) records.put(ym.atDay(d), "ON_TIME");
        Map<LocalDate, DayStatus> leave = Map.of(ym.atDay(14), DayStatus.PAID_LEAVE);

        // After: the policy has an allowance of 3 (days 1-3 inside it → PRESENT), day 4 is
        // LATE, day 7 is LATE past the allowance with loss of pay, day 9 half day (short
        // hours), day 14 has a punch but is on approved leave.
        Map<LocalDate, String[]> eff = new java.util.HashMap<>();
        for (int d : new int[] {1, 2, 3}) eff.put(ym.atDay(d), new String[] {"PRESENT", "p"});
        eff.put(ym.atDay(4), new String[] {"LATE", "p"});
        eff.put(ym.atDay(7), new String[] {"LATE", "p", "lop"});
        eff.put(ym.atDay(8), new String[] {"ABSENT", ""});
        eff.put(ym.atDay(9), new String[] {"HALF_DAY", "p"});
        eff.put(ym.atDay(10), new String[] {"PRESENT", "p"});
        eff.put(ym.atDay(11), new String[] {"PRESENT", "p"});
        eff.put(ym.atDay(14), new String[] {"PRESENT", "p"});

        Map<LocalDate, DayStatus> beforeAtt = new java.util.HashMap<>();
        int beforeLate = 0;
        Map<LocalDate, DayStatus> afterAtt = new java.util.HashMap<>();
        int afterLate = 0;
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            String rec = records.get(d);
            AttendancePay b = day(rec, null, false, false, false, false);
            if (b.status() != null) beforeAtt.put(d, b.status());
            if (b.lateMark()) beforeLate++;
            String[] e = eff.get(d);
            AttendancePay a = e == null ? day(rec, null, false, false, false, false)
                    : day(rec, e[0], false, "p".equals(e[1]), false, e.length > 2);
            if (a.status() != null) afterAtt.put(d, a.status());
            if (a.lateMark()) afterLate++;
        }
        assertEquals(5, beforeLate);
        assertEquals(1, afterLate, "only day 4 is an effective late mark");

        LopResult before = LopCalculator.calculate(new LopInput(
                PayrollCalc.dayStatuses(start, end, leave, beforeAtt, Set.of(), offs), false, 3, beforeLate,
                null, null, ym, start));
        LopResult after = LopCalculator.calculate(new LopInput(
                PayrollCalc.dayStatuses(start, end, leave, afterAtt, Set.of(), offs), false, 3, afterLate,
                null, null, ym, start));
        // Before: 1 absent + 5 late marks / 3 = 1 → 2 LOP days.
        assertEquals(0, new BigDecimal("2").compareTo(before.lopDays()));
        // After: 1 absent + day 7 (late, loss of pay) + half of day 9; 1 late mark / 3 = 0 → 2.5.
        assertEquals(0, new BigDecimal("2.5").compareTo(after.lopDays()));
        // Approved leave on day 14 still wins over the punch.
        List<DayStatus> afterDays = new ArrayList<>(PayrollCalc.dayStatuses(start, end, leave, afterAtt, Set.of(), offs));
        assertEquals(DayStatus.PAID_LEAVE, afterDays.get(13));
    }

    @Test
    void anUnconfiguredCompanyIsPaidAsBefore() {
        // Policy defaults: no allowance, late stays late, no hour rules. The same
        // month read both ways gives the same LOP and the same late marks.
        YearMonth ym = YearMonth.of(2026, 8);
        LocalDate start = ym.atDay(1), end = ym.atEndOfMonth();
        Map<LocalDate, DayStatus> before = new java.util.HashMap<>(), after = new java.util.HashMap<>();
        int lb = 0, la = 0;
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            int dom = d.getDayOfMonth();
            if (d.getDayOfWeek().getValue() >= 6 || dom == 20) continue; // weekends; day 20: no punch
            String rec = dom % 5 == 0 ? "LATE" : "ON_TIME";
            String effStatus = "LATE".equals(rec) ? "LATE" : "PRESENT";
            AttendancePay b = day(rec, null, false, false, false, false);
            AttendancePay a = day(rec, effStatus, false, true, false, false);
            if (b.status() != null) before.put(d, b.status());
            if (a.status() != null) after.put(d, a.status());
            if (b.lateMark()) lb++;
            if (a.lateMark()) la++;
        }
        // day 20 with no punch: effective ABSENT, payroll keeps "present" as before.
        AttendancePay missing = day(null, "ABSENT", false, false, false, false);
        assertNull(missing.status());
        assertEquals(lb, la);
        assertEquals(before, after);
    }
}
