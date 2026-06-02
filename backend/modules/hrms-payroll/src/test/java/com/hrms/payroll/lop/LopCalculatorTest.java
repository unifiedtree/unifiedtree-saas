package com.hrms.payroll.lop;

import com.hrms.payroll.lop.LopCalculator.DayStatus;
import com.hrms.payroll.lop.LopCalculator.LopInput;
import com.hrms.payroll.lop.LopCalculator.LopResult;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pure unit tests for {@link LopCalculator} — one per LOP rule case documented
 * in docs/PAYROLL-LOP-RULES.md. April 2026 (30 days) is used for clean arithmetic.
 * Every test also asserts the invariant paidDays + lopDays == totalCalendar.
 */
class LopCalculatorTest {

    private static final YearMonth APRIL = YearMonth.of(2026, 4); // 30 days

    private static List<DayStatus> days(int n, DayStatus s) {
        return new ArrayList<>(Collections.nCopies(n, s));
    }

    private static LopInput in(List<DayStatus> days) {
        return new LopInput(days, false, 0, 0, APRIL.atDay(1), null, APRIL);
    }

    private static void assertResult(LopResult r, String paid, String lop) {
        assertThat(r.paidDays()).isEqualByComparingTo(paid);
        assertThat(r.lopDays()).isEqualByComparingTo(lop);
        assertThat(r.totalCalendar()).isEqualTo(30);
        assertThat(r.paidDays().add(r.lopDays())).isEqualByComparingTo("30.0");
    }

    // 1 ─────────────────────────────────────────────────────────────────────
    @Test
    void allPresent_fullPaid() {
        assertResult(LopCalculator.calculate(in(days(30, DayStatus.PRESENT))), "30.0", "0.0");
    }

    // 2 ─────────────────────────────────────────────────────────────────────
    @Test
    void weekendsAndHolidaysArePaid() {
        List<DayStatus> d = days(22, DayStatus.PRESENT);
        d.addAll(days(6, DayStatus.WEEKEND));
        d.addAll(days(2, DayStatus.HOLIDAY));
        assertResult(LopCalculator.calculate(in(d)), "30.0", "0.0");
    }

    // 3 ─────────────────────────────────────────────────────────────────────
    @Test
    void paidLeaveCountsAsPaid() {
        List<DayStatus> d = days(25, DayStatus.PRESENT);
        d.addAll(days(5, DayStatus.PAID_LEAVE));
        assertResult(LopCalculator.calculate(in(d)), "30.0", "0.0");
    }

    // 4 ─────────────────────────────────────────────────────────────────────
    @Test
    void lopLeaveCountsAsLop() {
        List<DayStatus> d = days(27, DayStatus.PRESENT);
        d.addAll(days(3, DayStatus.LOP_LEAVE));
        assertResult(LopCalculator.calculate(in(d)), "27.0", "3.0");
    }

    // 5 ─────────────────────────────────────────────────────────────────────
    @Test
    void unauthorizedAbsentIsLop() {
        List<DayStatus> d = days(28, DayStatus.PRESENT);
        d.addAll(days(2, DayStatus.UNAUTHORIZED_ABSENT));
        assertResult(LopCalculator.calculate(in(d)), "28.0", "2.0");
    }

    // 6 ─────────────────────────────────────────────────────────────────────
    @Test
    void halfDayLeaveSplits() {
        List<DayStatus> d = days(29, DayStatus.PRESENT);
        d.add(DayStatus.HALF_DAY_LEAVE);
        assertResult(LopCalculator.calculate(in(d)), "29.5", "0.5");
    }

    // bracket [LOP, WEEKEND, WEEKEND, HOLIDAY, HOLIDAY, LOP] between PRESENT blocks
    private static List<DayStatus> sandwichDays() {
        List<DayStatus> d = days(12, DayStatus.PRESENT);
        d.add(DayStatus.LOP_LEAVE);
        d.add(DayStatus.WEEKEND);
        d.add(DayStatus.WEEKEND);
        d.add(DayStatus.HOLIDAY);
        d.add(DayStatus.HOLIDAY);
        d.add(DayStatus.LOP_LEAVE);
        d.addAll(days(12, DayStatus.PRESENT));   // 12 + 6 + 12 = 30
        return d;
    }

    // 7 ─────────────────────────────────────────────────────────────────────
    @Test
    void sandwichRuleConvertsBracketedHoliday() {
        LopInput i = new LopInput(sandwichDays(), true, 0, 0, APRIL.atDay(1), null, APRIL);
        assertResult(LopCalculator.calculate(i), "24.0", "6.0");
    }

    // 8 ─────────────────────────────────────────────────────────────────────
    @Test
    void sandwichRuleOffKeepsHolidayPaid() {
        LopInput i = new LopInput(sandwichDays(), false, 0, 0, APRIL.atDay(1), null, APRIL);
        assertResult(LopCalculator.calculate(i), "28.0", "2.0");
    }

    // 9 ─────────────────────────────────────────────────────────────────────
    @Test
    void lateMarksAccrueLopAtThreshold() {
        LopInput i = new LopInput(days(30, DayStatus.PRESENT), false, 3, 7, APRIL.atDay(1), null, APRIL);
        assertResult(LopCalculator.calculate(i), "28.0", "2.0"); // floor(7/3) = 2
    }

    // 10 ────────────────────────────────────────────────────────────────────
    @Test
    void preJoinAndPostExitDaysAreLop() {
        LopInput i = new LopInput(days(30, DayStatus.PRESENT), false, 0, 0,
            LocalDate.of(2026, 4, 6),   // days 1-5 pre-join
            LocalDate.of(2026, 4, 25),  // days 26-30 post-exit
            APRIL);
        assertResult(LopCalculator.calculate(i), "20.0", "10.0");
    }
}
