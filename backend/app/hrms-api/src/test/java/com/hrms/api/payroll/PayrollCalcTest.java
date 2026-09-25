package com.hrms.api.payroll;

import com.hrms.payroll.engine.PayrollEngine;
import com.hrms.payroll.engine.PayrollEngine.ComponentDef;
import com.hrms.payroll.engine.PayrollEngine.EarningLine;
import com.hrms.payroll.lop.LopCalculator;
import com.hrms.payroll.lop.LopCalculator.DayStatus;
import com.hrms.payroll.lop.LopCalculator.LopInput;
import com.hrms.payroll.lop.LopCalculator.LopResult;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The rules payroll applies around the engine (V143.11): weekly offs per
 * employee and company, working days, custom pay cycles, LWF months, fixed and
 * switched-off components, and hidden payslip lines. September 2026 starts on a
 * Tuesday and has 30 days: 5 Tuesdays and Wednesdays, 4 of every other day.
 */
class PayrollCalcTest {

    private static final YearMonth SEP = YearMonth.of(2026, 9);
    private static final Set<Integer> SUN_ONLY = Set.of(7);
    private static final Set<Integer> FRI_SAT = Set.of(5, 6);

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    // ── Weekly offs ──────────────────────────────────────────────────────────

    @Test
    void employeesOwnWeeklyOffWinsOverTheCompanys() {
        assertThat(PayrollCalc.resolveOffDays("7", FRI_SAT)).containsExactly(7);
        assertThat(PayrollCalc.resolveOffDays(" 5 , 6 ", SUN_ONLY)).containsExactlyInAnyOrder(5, 6);
    }

    @Test
    void companyWeeklyOffAppliesWhenTheEmployeeHasNone() {
        assertThat(PayrollCalc.resolveOffDays(null, FRI_SAT)).containsExactlyInAnyOrder(5, 6);
        assertThat(PayrollCalc.resolveOffDays("", SUN_ONLY)).containsExactly(7);
        assertThat(PayrollCalc.resolveOffDays("junk,9", SUN_ONLY)).containsExactly(7);
    }

    @Test
    void saturdayAndSundayWhenNothingIsSet() {
        assertThat(PayrollCalc.resolveOffDays(null, Set.of())).containsExactlyInAnyOrder(6, 7);
        assertThat(PayrollCalc.resolveOffDays(null, null)).containsExactlyInAnyOrder(6, 7);
        assertThat(PayrollCalc.companyOffDays(new Integer[]{null, 0, 7, 8})).containsExactly(7);
        assertThat(PayrollCalc.companyOffDays(null)).isEmpty();
    }

    @Test
    void workingDaysFollowTheWorkWeek() {
        LocalDate s = SEP.atDay(1), e = SEP.atEndOfMonth();
        assertThat(PayrollCalc.workingDays(s, e, PayrollCalc.SAT_SUN, Set.of())).isEqualTo(22);
        assertThat(PayrollCalc.workingDays(s, e, SUN_ONLY, Set.of())).isEqualTo(26);   // 6-day week
        assertThat(PayrollCalc.workingDays(s, e, FRI_SAT, Set.of())).isEqualTo(22);
        // A holiday on a working day comes off; one on a weekly off doesn't count twice.
        Set<LocalDate> hol = Set.of(LocalDate.of(2026, 9, 15), LocalDate.of(2026, 9, 6)); // Tue, Sun
        assertThat(PayrollCalc.workingDays(s, e, SUN_ONLY, hol)).isEqualTo(25);
        assertThat(PayrollCalc.workingDays(s, e, FRI_SAT, hol)).isEqualTo(20);
    }

    @Test
    void dayStatusesMarkTheEmployeesOwnWeeklyOffs() {
        List<DayStatus> friSat = PayrollCalc.dayStatuses(SEP.atDay(1), SEP.atEndOfMonth(), Map.of(), Map.of(), Set.of(), FRI_SAT);
        assertThat(friSat).hasSize(30);
        assertThat(friSat.get(3)).isEqualTo(DayStatus.WEEKEND);  // Fri 4 Sep
        assertThat(friSat.get(4)).isEqualTo(DayStatus.WEEKEND);  // Sat 5 Sep
        assertThat(friSat.get(5)).isEqualTo(DayStatus.PRESENT);  // Sun 6 Sep is a working day
        assertThat(friSat.stream().filter(d -> d == DayStatus.WEEKEND).count()).isEqualTo(8);

        List<DayStatus> sixDay = PayrollCalc.dayStatuses(SEP.atDay(1), SEP.atEndOfMonth(), Map.of(), Map.of(), Set.of(), SUN_ONLY);
        assertThat(sixDay.stream().filter(d -> d == DayStatus.WEEKEND).count()).isEqualTo(4);
        assertThat(sixDay.get(4)).isEqualTo(DayStatus.PRESENT);  // Saturday is worked
    }

    @Test
    void leaveThenAttendanceThenHolidayThenWeeklyOff() {
        LocalDate sat = LocalDate.of(2026, 9, 5);
        LocalDate sun = LocalDate.of(2026, 9, 6);
        List<DayStatus> days = PayrollCalc.dayStatuses(SEP.atDay(1), SEP.atEndOfMonth(),
                Map.of(sat, DayStatus.PAID_LEAVE), Map.of(sat, DayStatus.UNAUTHORIZED_ABSENT, sun, DayStatus.PRESENT),
                Set.of(sun), PayrollCalc.SAT_SUN);
        assertThat(days.get(4)).isEqualTo(DayStatus.PAID_LEAVE);
        assertThat(days.get(5)).isEqualTo(DayStatus.PRESENT);
    }

    /** Absent Friday and Monday in a 6-day week: Saturday is a worked (paid) day, so nothing is sandwiched. */
    @Test
    void sixDayWeekNoLongerSandwichesSaturday() {
        Map<LocalDate, DayStatus> att = Map.of(
                LocalDate.of(2026, 9, 4), DayStatus.UNAUTHORIZED_ABSENT,
                LocalDate.of(2026, 9, 7), DayStatus.UNAUTHORIZED_ABSENT);
        assertThat(lop(att, SUN_ONLY, true).lopDays()).isEqualByComparingTo("2.0");
        // Old rule (Sat+Sun for everyone) took four days for the same attendance.
        assertThat(lop(att, PayrollCalc.SAT_SUN, true).lopDays()).isEqualByComparingTo("4.0");
    }

    /** Absent Thursday and Sunday in a Friday–Saturday week: the weekend between them is sandwiched. */
    @Test
    void friSatWeekSandwichesItsOwnWeekend() {
        Map<LocalDate, DayStatus> att = Map.of(
                LocalDate.of(2026, 9, 3), DayStatus.UNAUTHORIZED_ABSENT,
                LocalDate.of(2026, 9, 6), DayStatus.UNAUTHORIZED_ABSENT);
        LopResult r = lop(att, FRI_SAT, true);
        assertThat(r.lopDays()).isEqualByComparingTo("4.0");
        assertThat(r.paidDays()).isEqualByComparingTo("26.0");
        assertThat(lop(att, FRI_SAT, false).lopDays()).isEqualByComparingTo("2.0");
    }

    @Test
    void fullMonthIsFullyPaidWhateverTheWeek() {
        for (Set<Integer> week : List.of(PayrollCalc.SAT_SUN, SUN_ONLY, FRI_SAT)) {
            LopResult r = lop(Map.of(), week, true);
            assertThat(r.paidDays()).isEqualByComparingTo("30.0");
            assertThat(r.lopDays()).isEqualByComparingTo("0.0");
        }
    }

    private static LopResult lop(Map<LocalDate, DayStatus> attendance, Set<Integer> offDays, boolean sandwich) {
        List<DayStatus> days = PayrollCalc.dayStatuses(SEP.atDay(1), SEP.atEndOfMonth(), Map.of(), attendance, Set.of(), offDays);
        return LopCalculator.calculate(new LopInput(days, sandwich, 0, 0, null, null, SEP));
    }

    // ── Pay cycle and pay date ─────────────────────────────────────────────────

    @Test
    void startDayOneIsTheCalendarMonth() {
        PayrollCalc.Period p = PayrollCalc.cyclePeriod(SEP, 1);
        assertThat(p.start()).isEqualTo(LocalDate.of(2026, 9, 1));
        assertThat(p.end()).isEqualTo(LocalDate.of(2026, 9, 30));
        assertThat(p.days()).isEqualTo(30);
        assertThat(PayrollCalc.cyclePeriod(YearMonth.of(2027, 2), 1).end()).isEqualTo(LocalDate.of(2027, 2, 28));
    }

    @Test
    void customCycleEndsInTheRunsMonth() {
        PayrollCalc.Period p = PayrollCalc.cyclePeriod(SEP, 26);
        assertThat(p.start()).isEqualTo(LocalDate.of(2026, 8, 26));
        assertThat(p.end()).isEqualTo(LocalDate.of(2026, 9, 25));
        assertThat(p.days()).isEqualTo(31);
        // Consecutive runs meet without a gap or an overlap, across a year end too.
        for (int i = 0; i < 14; i++) {
            YearMonth m = YearMonth.of(2026, 1).plusMonths(i);
            for (int start : new int[]{2, 15, 26, 29, 30, 31}) {
                assertThat(PayrollCalc.cyclePeriod(m, start).end().plusDays(1))
                        .isEqualTo(PayrollCalc.cyclePeriod(m.plusMonths(1), start).start());
            }
        }
    }

    @Test
    void startDayPastAShortMonthStartsOnItsLastDay() {
        PayrollCalc.Period mar = PayrollCalc.cyclePeriod(YearMonth.of(2027, 3), 30);
        assertThat(mar.start()).isEqualTo(LocalDate.of(2027, 2, 28));
        assertThat(mar.end()).isEqualTo(LocalDate.of(2027, 3, 29));
    }

    @Test
    void payDateIsTheProcessingDayInTheMonthThePeriodEnds() {
        assertThat(PayrollCalc.payDate(LocalDate.of(2026, 9, 30), 28)).isEqualTo(LocalDate.of(2026, 9, 28));
        assertThat(PayrollCalc.payDate(LocalDate.of(2026, 9, 25), 28)).isEqualTo(LocalDate.of(2026, 9, 28));
        assertThat(PayrollCalc.payDate(LocalDate.of(2027, 2, 28), 31)).isEqualTo(LocalDate.of(2027, 2, 28));
        assertThat(PayrollCalc.cycleEndDay(1)).isEqualTo(31);
        assertThat(PayrollCalc.cycleEndDay(26)).isEqualTo(25);
    }

    @Test
    void lopOverACustomCycleCountsItsOwnDays() {
        PayrollCalc.Period p = PayrollCalc.cyclePeriod(SEP, 26);          // 26 Aug – 25 Sep
        List<DayStatus> days = PayrollCalc.dayStatuses(p.start(), p.end(), Map.of(),
                Map.of(LocalDate.of(2026, 8, 31), DayStatus.UNAUTHORIZED_ABSENT), Set.of(), PayrollCalc.SAT_SUN);
        // Joined on 1 Sep: the six August days before joining are unpaid (the
        // absence on 31 Aug is one of them); the September days are paid.
        LopResult r = LopCalculator.calculate(new LopInput(days, false, 0, 0,
                LocalDate.of(2026, 9, 1), null, SEP, p.start()));
        assertThat(r.totalCalendar()).isEqualTo(31);
        assertThat(r.lopDays()).isEqualByComparingTo("6.0");
        assertThat(r.paidDays()).isEqualByComparingTo("25.0");
        assertThat(r.log().get(0).dayOfMonth()).isEqualTo(26);
    }

    // ── LWF ──────────────────────────────────────────────────────────────────

    @Test
    void lwfIsDueOnlyInTheConfiguredMonthsWhenSwitchedOn() {
        assertThat(PayrollCalc.lwfDue(true, List.of(6, 12), 6)).isTrue();
        assertThat(PayrollCalc.lwfDue(true, List.of(6, 12), 9)).isFalse();
        assertThat(PayrollCalc.lwfDue(false, List.of(6, 12), 12)).isFalse();
        assertThat(PayrollCalc.lwfDue(true, List.of(), 12)).isFalse();
        assertThat(PayrollCalc.lwfDue(true, null, 12)).isFalse();
    }

    // ── Components ─────────────────────────────────────────────────────────────

    private static final ComponentDef BASIC_DEF = new ComponentDef("BASIC", "Basic", "EARNING", false, 10);

    private static PayrollCalc.ComponentInfo comp(String code, String cat, String type, String amount, boolean active) {
        return new PayrollCalc.ComponentInfo(code, code, cat, false, 40, type, amount == null ? null : bd(amount), active, true);
    }

    private static PayrollCalc.StructureLine line(String code, String cat, String amount) {
        return new PayrollCalc.StructureLine(code, code, cat, false, 10, bd(amount));
    }

    private static Map<String, PayrollCalc.ComponentInfo> catalog(PayrollCalc.ComponentInfo... cs) {
        Map<String, PayrollCalc.ComponentInfo> m = new LinkedHashMap<>();
        for (PayrollCalc.ComponentInfo c : cs) m.put(c.code(), c);
        return m;
    }

    private static BigDecimal earning(PayrollCalc.ResolvedPay p, String code) {
        return p.earnings().stream().filter(e -> e.component().code().equals(code))
                .map(EarningLine::monthlyAmount).findFirst().orElse(null);
    }

    @Test
    void fixedEarningIsAddedWhenTheStructureDoesNotListIt() {
        PayrollCalc.ResolvedPay p = PayrollCalc.resolvePay(
                List.of(line("BASIC", "EARNING", "20000")),
                catalog(comp("BASIC", "EARNING", "FORMULA", null, true), comp("MEAL", "EARNING", "FIXED", "1500", true)),
                bd("40000"), BASIC_DEF);
        assertThat(earning(p, "BASIC")).isEqualByComparingTo("20000");
        assertThat(earning(p, "MEAL")).isEqualByComparingTo("1500");
        assertThat(p.derivedFromCtc()).isFalse();
    }

    @Test
    void theStructuresOwnAmountWinsOverTheFixedAmount() {
        PayrollCalc.ResolvedPay p = PayrollCalc.resolvePay(
                List.of(line("BASIC", "EARNING", "20000"), line("CONVEYANCE", "EARNING", "1600")),
                catalog(comp("CONVEYANCE", "EARNING", "FIXED", "2500", true)), bd("40000"), BASIC_DEF);
        assertThat(earning(p, "CONVEYANCE")).isEqualByComparingTo("1600");
        assertThat(p.earnings()).hasSize(2);
    }

    @Test
    void switchedOffComponentsAreSkipped() {
        PayrollCalc.ResolvedPay p = PayrollCalc.resolvePay(
                List.of(line("BASIC", "EARNING", "20000"), line("HRA", "EARNING", "8000")),
                catalog(comp("HRA", "EARNING", "PERCENT_OF_BASIC", null, false),
                        comp("MEAL", "EARNING", "FIXED", "1500", false),
                        comp("CANTEEN", "DEDUCTION", "FIXED", "300", false)),
                bd("40000"), BASIC_DEF);
        assertThat(earning(p, "HRA")).isNull();
        assertThat(earning(p, "MEAL")).isNull();
        assertThat(p.flatDeductions()).isEmpty();
        assertThat(earning(p, "BASIC")).isEqualByComparingTo("20000");
    }

    @Test
    void fixedDeductionUsesTheStructureAmountWhenListedElseTheCatalogue() {
        Map<String, PayrollCalc.ComponentInfo> cat = catalog(comp("CANTEEN", "DEDUCTION", "FIXED", "300", true));
        PayrollCalc.ResolvedPay dflt = PayrollCalc.resolvePay(List.of(line("BASIC", "EARNING", "20000")), cat, bd("0"), BASIC_DEF);
        assertThat(dflt.flatDeductions()).hasSize(1);
        assertThat(dflt.flatDeductions().get(0).amount()).isEqualByComparingTo("300");

        PayrollCalc.ResolvedPay own = PayrollCalc.resolvePay(
                List.of(line("BASIC", "EARNING", "20000"), line("CANTEEN", "DEDUCTION", "120")), cat, bd("0"), BASIC_DEF);
        assertThat(own.flatDeductions().get(0).amount()).isEqualByComparingTo("120");

        // A structure amount of 0 exempts the person.
        PayrollCalc.ResolvedPay none = PayrollCalc.resolvePay(
                List.of(line("BASIC", "EARNING", "20000"), line("CANTEEN", "DEDUCTION", "0")), cat, bd("0"), BASIC_DEF);
        assertThat(none.flatDeductions()).isEmpty();
    }

    @Test
    void payrollManagedAndStatutoryComponentsNeverTakeACatalogueAmount() {
        Map<String, PayrollCalc.ComponentInfo> cat = catalog(
                comp("ADVANCE_RECOVERY", "DEDUCTION", "FIXED", "999", true),
                comp("PLI_INCENTIVE", "EARNING", "FIXED", "999", true),
                new PayrollCalc.ComponentInfo("STAT_FIX", "S", "DEDUCTION", true, 1, "FIXED", bd("50"), true, true),
                comp("TRAVEL", "EARNING", "PERCENT_OF_GROSS", "999", true));
        PayrollCalc.ResolvedPay p = PayrollCalc.resolvePay(List.of(line("BASIC", "EARNING", "20000")), cat, bd("0"), BASIC_DEF);
        assertThat(p.earnings()).extracting(e -> e.component().code()).containsExactly("BASIC");
        assertThat(p.flatDeductions()).isEmpty();
    }

    @Test
    void noStructureEarningsFallsBackToBasicEqualToCtcPlusFixedEarnings() {
        PayrollCalc.ResolvedPay p = PayrollCalc.resolvePay(List.of(),
                catalog(comp("MEAL", "EARNING", "FIXED", "1500", true)), bd("30000"), BASIC_DEF);
        assertThat(p.derivedFromCtc()).isTrue();
        assertThat(earning(p, "BASIC")).isEqualByComparingTo("30000");
        assertThat(earning(p, "MEAL")).isEqualByComparingTo("1500");
    }

    /** Fixed earnings are pro-rated like any earning; fixed deductions are taken in full. */
    @Test
    void fixedComponentsThroughTheEngine() {
        PayrollCalc.ResolvedPay p = PayrollCalc.resolvePay(List.of(line("BASIC", "EARNING", "30000")),
                catalog(comp("MEAL", "EARNING", "FIXED", "3000", true), comp("CANTEEN", "DEDUCTION", "FIXED", "500", true)),
                bd("0"), BASIC_DEF);
        LopResult halfMonth = LopCalculator.calculate(new LopInput(
                PayrollCalc.dayStatuses(SEP.atDay(1), SEP.atEndOfMonth(), Map.of(), halfAbsent(), Set.of(), Set.of()),
                false, 0, 0, null, null, SEP));
        assertThat(halfMonth.paidDays()).isEqualByComparingTo("15.0");
        PayrollEngine.PayrollResult r = PayrollEngine.compute(new PayrollEngine.PayrollEngineInput(
                p.earnings(), halfMonth,
                new PayrollEngine.StatutoryConfig(false, null, null, null, false, false, null, null, null, false, null),
                new PayrollEngine.EmployeeStructureCfg("NOT_APPLICABLE", false, false), SEP),
                new PayrollEngine.Extras(List.of(), p.flatDeductions(), null, null));
        assertThat(amount(r, "MEAL")).isEqualByComparingTo("1500.00");
        assertThat(amount(r, "CANTEEN")).isEqualByComparingTo("500.00");
        assertThat(r.gross()).isEqualByComparingTo("16500.00");
        assertThat(r.net()).isEqualByComparingTo("16000.00");
    }

    private static Map<LocalDate, DayStatus> halfAbsent() {
        Map<LocalDate, DayStatus> m = new HashMap<>();
        for (int d = 16; d <= 30; d++) m.put(SEP.atDay(d), DayStatus.UNAUTHORIZED_ABSENT);
        return m;
    }

    private static BigDecimal amount(PayrollEngine.PayrollResult r, String code) {
        return r.lines().stream().filter(l -> l.componentCode().equals(code))
                .map(PayrollEngine.PayslipLine::amount).findFirst().orElse(null);
    }

    // ── Payslip display ────────────────────────────────────────────────────────

    @Test
    void hiddenComponentsFoldIntoOneOtherLineAndTotalsStillAddUp() {
        List<PayrollRunService.PayslipLineDto> out = PayrollCalc.foldHidden(List.of(
                new PayrollCalc.SlipLine("BASIC", "Basic", bd("20000"), true),
                new PayrollCalc.SlipLine("MEAL", "Meal", bd("1500"), false),
                new PayrollCalc.SlipLine("GIFT", "Gift", bd("500"), false),
                new PayrollCalc.SlipLine("HRA", "HRA", bd("8000"), true)), "OTHER_EARNINGS", "Other earnings");
        assertThat(out).extracting(PayrollRunService.PayslipLineDto::name).containsExactly("Basic", "HRA", "Other earnings");
        assertThat(out.get(2).amount()).isEqualByComparingTo("2000");
        assertThat(out.stream().map(PayrollRunService.PayslipLineDto::amount).reduce(BigDecimal.ZERO, BigDecimal::add))
                .isEqualByComparingTo("30000");
    }

    @Test
    void nothingFoldsWhenEveryLineIsShown() {
        List<PayrollRunService.PayslipLineDto> out = PayrollCalc.foldHidden(List.of(
                new PayrollCalc.SlipLine("PT", "Professional Tax", bd("200"), true)), "OTHER_DEDUCTIONS", "Other deductions");
        assertThat(out).hasSize(1);
        assertThat(out.get(0).code()).isEqualTo("PT");
    }
}
