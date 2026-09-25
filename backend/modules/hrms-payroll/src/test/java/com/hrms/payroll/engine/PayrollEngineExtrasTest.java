package com.hrms.payroll.engine;

import com.hrms.payroll.engine.PayrollEngine.ComponentDef;
import com.hrms.payroll.engine.PayrollEngine.EarningLine;
import com.hrms.payroll.engine.PayrollEngine.EmployeeStructureCfg;
import com.hrms.payroll.engine.PayrollEngine.Extras;
import com.hrms.payroll.engine.PayrollEngine.FlatLine;
import com.hrms.payroll.engine.PayrollEngine.PayrollEngineInput;
import com.hrms.payroll.engine.PayrollEngine.PayrollResult;
import com.hrms.payroll.engine.PayrollEngine.StatutoryConfig;
import com.hrms.payroll.lop.LopCalculator;
import com.hrms.payroll.lop.LopCalculator.DayStatus;
import com.hrms.payroll.lop.LopCalculator.LopInput;
import com.hrms.payroll.lop.LopCalculator.LopResult;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * What payroll adds on top of the structure (V143.11): the approved PLI
 * incentive (paid in full, outside the PF/ESI base), Labour Welfare Fund in its
 * months, fixed-amount deductions, and the LOP calculator over a custom cycle.
 */
class PayrollEngineExtrasTest {

    private static final YearMonth APRIL = YearMonth.of(2026, 4); // 30 days
    private static final ComponentDef BASIC = new ComponentDef("BASIC", "Basic Salary", "EARNING", false, 10);
    private static final ComponentDef PLI = new ComponentDef("PLI_INCENTIVE", "Performance incentive", "EARNING", false, 45);
    private static final ComponentDef CANTEEN = new ComponentDef("CANTEEN", "Canteen", "DEDUCTION", false, 110);
    private static final EmployeeStructureCfg ENROLLED = new EmployeeStructureCfg("ENROLLED", true, true);

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    private static StatutoryConfig allOn() {
        return new StatutoryConfig(true, bd("12.000"), bd("12.000"), bd("15000"), true,
            true, bd("0.750"), bd("3.250"), bd("21000"), true, bd("200"));
    }

    private static LopResult paidDays(int paid) {
        List<DayStatus> d = new ArrayList<>(Collections.nCopies(paid, DayStatus.PRESENT));
        while (d.size() < 30) d.add(DayStatus.UNAUTHORIZED_ABSENT);
        return LopCalculator.calculate(new LopInput(d, false, 0, 0, null, null, APRIL));
    }

    private static PayrollResult run(LopResult lop, Extras extras) {
        return PayrollEngine.compute(new PayrollEngineInput(
            List.of(new EarningLine(BASIC, bd("20000"))), lop, allOn(), ENROLLED, APRIL), extras);
    }

    private static BigDecimal amt(PayrollResult r, String code) {
        return r.lines().stream().filter(l -> l.componentCode().equals(code))
            .map(PayrollEngine.PayslipLine::amount).findFirst().orElse(null);
    }

    @Test
    void noExtrasIsExactlyTheOldCalculation() {
        LopResult full = paidDays(30);
        PayrollResult before = PayrollEngine.compute(new PayrollEngineInput(
            List.of(new EarningLine(BASIC, bd("20000"))), full, allOn(), ENROLLED, APRIL));
        assertThat(run(full, Extras.NONE)).isEqualTo(before);
        assertThat(run(full, null)).isEqualTo(before);
    }

    @Test
    void incentiveIsPaidInFullOutsideThePfAndEsiBase() {
        LopResult half = paidDays(15);
        PayrollResult without = run(half, Extras.NONE);
        PayrollResult with = run(half, new Extras(List.of(new FlatLine(PLI, bd("5000"))), List.of(), null, null));

        assertThat(amt(with, "BASIC")).isEqualByComparingTo("10000.00");     // pro-rated
        assertThat(amt(with, "PLI_INCENTIVE")).isEqualByComparingTo("5000.00"); // never pro-rated
        assertThat(with.gross()).isEqualByComparingTo("15000.00");
        // PF, ESI and PT are unchanged by the incentive.
        for (String code : List.of("PF_EMPLOYEE", "PF_EMPLOYER", "ESI_EMPLOYEE", "ESI_EMPLOYER", "PT")) {
            assertThat(amt(with, code)).as(code).isEqualByComparingTo(amt(without, code));
        }
        assertThat(with.net()).isEqualByComparingTo(without.net().add(bd("5000")));
    }

    @Test
    void lwfIsDeductedAndTheEmployerShareIsKeptOutOfNet() {
        PayrollResult r = run(paidDays(30), new Extras(List.of(), List.of(), bd("25"), bd("75")));
        assertThat(amt(r, "LWF_EMPLOYEE")).isEqualByComparingTo("25.00");
        assertThat(amt(r, "LWF_EMPLOYER")).isEqualByComparingTo("75.00");
        PayrollResult none = run(paidDays(30), Extras.NONE);
        assertThat(r.totalDeductions()).isEqualByComparingTo(none.totalDeductions().add(bd("25")));
        assertThat(r.totalEmployerContrib()).isEqualByComparingTo(none.totalEmployerContrib().add(bd("75")));
        assertThat(r.net()).isEqualByComparingTo(none.net().subtract(bd("25")));
    }

    @Test
    void zeroOrMissingLwfAddsNoLines() {
        PayrollResult r = run(paidDays(30), new Extras(List.of(), List.of(), BigDecimal.ZERO, null));
        assertThat(amt(r, "LWF_EMPLOYEE")).isNull();
        assertThat(amt(r, "LWF_EMPLOYER")).isNull();
    }

    @Test
    void fixedDeductionIsTakenInFullEvenOnAShortMonth() {
        PayrollResult r = run(paidDays(10), new Extras(List.of(), List.of(new FlatLine(CANTEEN, bd("300"))), null, null));
        assertThat(amt(r, "CANTEEN")).isEqualByComparingTo("300.00");
        PayrollResult none = run(paidDays(10), Extras.NONE);
        assertThat(r.net()).isEqualByComparingTo(none.net().subtract(bd("300")));
    }

    @Test
    void linesKeepAFixedOrder() {
        PayrollResult r = run(paidDays(30), new Extras(
            List.of(new FlatLine(PLI, bd("1000"))), List.of(new FlatLine(CANTEEN, bd("100"))), bd("10"), bd("20")));
        assertThat(r.lines()).extracting(PayrollEngine.PayslipLine::componentCode).containsExactly(
            "BASIC", "PLI_INCENTIVE", "PF_EMPLOYEE", "PF_EMPLOYER", "ESI_EMPLOYEE", "ESI_EMPLOYER",
            "PT", "LWF_EMPLOYEE", "LWF_EMPLOYER", "CANTEEN");
    }

    @Test
    void lopCalculatorFollowsACustomCycleStart() {
        // 26 Mar – 25 Apr: 31 days; joined 1 Apr, so the six March days are unpaid.
        LocalDate start = LocalDate.of(2026, 3, 26);
        LopResult r = LopCalculator.calculate(new LopInput(Collections.nCopies(31, DayStatus.PRESENT),
            false, 0, 0, LocalDate.of(2026, 4, 1), null, APRIL, start));
        assertThat(r.totalCalendar()).isEqualTo(31);
        assertThat(r.lopDays()).isEqualByComparingTo("6.0");
        assertThat(r.log().get(0).dayOfMonth()).isEqualTo(26);
        assertThat(r.log().get(6).dayOfMonth()).isEqualTo(1);
    }

    @Test
    void theOldConstructorStillStartsOnTheFirst() {
        LopInput in = new LopInput(Collections.nCopies(30, DayStatus.PRESENT), false, 0, 0, null, null, APRIL);
        assertThat(in.startDate()).isEqualTo(APRIL.atDay(1));
    }
}
