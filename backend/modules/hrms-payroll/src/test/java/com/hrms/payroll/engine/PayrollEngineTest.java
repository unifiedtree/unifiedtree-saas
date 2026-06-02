package com.hrms.payroll.engine;

import com.hrms.payroll.engine.PayrollEngine.ComponentDef;
import com.hrms.payroll.engine.PayrollEngine.EarningLine;
import com.hrms.payroll.engine.PayrollEngine.EmployeeStructureCfg;
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
 * Pure-unit tests for {@link PayrollEngine} (Prompt 13a) — 11 tests over a clean
 * 30-day month (April 2026) so the arithmetic is exact. No Spring, no DB; the
 * engine is a pure function so every case also implies determinism.
 */
class PayrollEngineTest {

    private static final YearMonth APRIL = YearMonth.of(2026, 4); // 30 days

    private static final ComponentDef BASIC   = new ComponentDef("BASIC", "Basic Salary", "EARNING", false, 10);
    private static final ComponentDef HRA     = new ComponentDef("HRA", "House Rent Allowance", "EARNING", false, 20);
    private static final ComponentDef SPECIAL = new ComponentDef("SPECIAL", "Special Allowance", "EARNING", false, 30);

    private static final StatutoryConfig NONE = new StatutoryConfig(
        false, null, null, null, false,
        false, null, null, null,
        false, null);

    private static StatutoryConfig pfOn() {
        return new StatutoryConfig(true, bd("12.000"), bd("12.000"), bd("15000"), true,
            false, null, null, null, false, null);
    }

    private static StatutoryConfig esiOn() {
        return new StatutoryConfig(false, null, null, null, false,
            true, bd("0.750"), bd("3.250"), bd("21000"), false, null);
    }

    private static StatutoryConfig ptOn(String amount) {
        return new StatutoryConfig(false, null, null, null, false,
            false, null, null, null, true, bd(amount));
    }

    private static StatutoryConfig allOn() {
        return new StatutoryConfig(true, bd("12.000"), bd("12.000"), bd("15000"), true,
            true, bd("0.750"), bd("3.250"), bd("21000"), true, bd("200"));
    }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    /** Full attendance: 30 paid / 0 lop (factor 1.0). */
    private static LopResult fullMonth() {
        return LopCalculator.calculate(new LopInput(
            Collections.nCopies(30, DayStatus.PRESENT), false, 0, 0, APRIL.atDay(1), null, APRIL));
    }

    private static PayrollEngineInput input(List<EarningLine> earnings, LopResult lop,
                                            StatutoryConfig st, EmployeeStructureCfg emp) {
        return new PayrollEngineInput(earnings, lop, st, emp, APRIL);
    }

    private static EarningLine line(ComponentDef c, String amount) {
        return new EarningLine(c, bd(amount));
    }

    private static BigDecimal lineAmt(PayrollResult r, String code) {
        return r.lines().stream().filter(l -> l.componentCode().equals(code))
            .map(PayrollEngine.PayslipLine::amount).findFirst().orElse(null);
    }

    private static boolean hasLine(PayrollResult r, String code) {
        return r.lines().stream().anyMatch(l -> l.componentCode().equals(code));
    }

    // ── Test 1 ───────────────────────────────────────────────────────────────

    @Test
    void test1_fullMonthNoStatutory() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "50000")), fullMonth(), NONE,
            new EmployeeStructureCfg("ENROLLED", false, false)));

        assertThat(r.gross()).isEqualByComparingTo("50000.00");
        assertThat(r.totalDeductions()).isEqualByComparingTo("0.00");
        assertThat(r.net()).isEqualByComparingTo("50000.00");
        assertThat(r.lines()).hasSize(1);
        assertThat(r.warnings()).isEmpty();
    }

    // ── Test 2 ───────────────────────────────────────────────────────────────

    @Test
    void test2_pfBasic25kCappedAtCeiling() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "25000")), fullMonth(), pfOn(),
            new EmployeeStructureCfg("ENROLLED", true, false)));

        assertThat(lineAmt(r, "PF_EMPLOYEE")).isEqualByComparingTo("1800.00"); // min(25000,15000)*12%
        assertThat(lineAmt(r, "PF_EMPLOYER")).isEqualByComparingTo("1800.00");
        assertThat(r.totalDeductions()).isEqualByComparingTo("1800.00");
        assertThat(r.totalEmployerContrib()).isEqualByComparingTo("1800.00");
        assertThat(r.net()).isEqualByComparingTo("23200.00");
    }

    // ── Test 3 ───────────────────────────────────────────────────────────────

    @Test
    void test3_pfExemptedNoLines() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "25000")), fullMonth(), pfOn(),
            new EmployeeStructureCfg("EXEMPTED_FORM_11", true, false)));

        assertThat(hasLine(r, "PF_EMPLOYEE")).isFalse();
        assertThat(hasLine(r, "PF_EMPLOYER")).isFalse();
        assertThat(r.totalDeductions()).isEqualByComparingTo("0.00");
        assertThat(r.net()).isEqualByComparingTo("25000.00");
        assertThat(r.gross()).isEqualByComparingTo("25000.00");
    }

    // ── Test 4 ───────────────────────────────────────────────────────────────

    @Test
    void test4_esiBelowCeiling() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "18000")), fullMonth(), esiOn(),
            new EmployeeStructureCfg("ENROLLED", false, true)));

        assertThat(lineAmt(r, "ESI_EMPLOYEE")).isEqualByComparingTo("135.00"); // 18000*0.75%
        assertThat(lineAmt(r, "ESI_EMPLOYER")).isEqualByComparingTo("585.00"); // 18000*3.25%
        assertThat(r.totalDeductions()).isEqualByComparingTo("135.00");
        assertThat(r.totalEmployerContrib()).isEqualByComparingTo("585.00");
        assertThat(r.net()).isEqualByComparingTo("17865.00");
    }

    // ── Test 5 ───────────────────────────────────────────────────────────────

    @Test
    void test5_esiAboveCeilingSkipped() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "25000")), fullMonth(), esiOn(),
            new EmployeeStructureCfg("ENROLLED", false, true)));

        assertThat(hasLine(r, "ESI_EMPLOYEE")).isFalse();
        assertThat(hasLine(r, "ESI_EMPLOYER")).isFalse();
        assertThat(r.totalDeductions()).isEqualByComparingTo("0.00");
        assertThat(r.net()).isEqualByComparingTo("25000.00");
        assertThat(r.warnings()).anyMatch(w -> w.contains("ESI_SKIPPED"));
    }

    // ── Test 6 ───────────────────────────────────────────────────────────────

    @Test
    void test6_ptFlat() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "30000")), fullMonth(), ptOn("200"),
            new EmployeeStructureCfg("ENROLLED", false, false)));

        assertThat(lineAmt(r, "PT")).isEqualByComparingTo("200.00");
        assertThat(r.totalDeductions()).isEqualByComparingTo("200.00");
        assertThat(r.net()).isEqualByComparingTo("29800.00");
    }

    // ── Test 7 ───────────────────────────────────────────────────────────────

    @Test
    void test7_midMonthJoinerHalfGross() {
        LopResult half = LopCalculator.calculate(new LopInput(
            Collections.nCopies(30, DayStatus.PRESENT), false, 0, 0,
            LocalDate.of(2026, 4, 16), null, APRIL)); // days 1-15 pre-join → LOP → paidDays 15

        assertThat(half.paidDays()).isEqualByComparingTo("15.0");

        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "50000")), half, pfOn(),
            new EmployeeStructureCfg("ENROLLED", true, false)));

        assertThat(r.gross()).isEqualByComparingTo("25000.00");      // 50000 * 15/30
        assertThat(lineAmt(r, "BASIC")).isEqualByComparingTo("25000.00");
        assertThat(lineAmt(r, "PF_EMPLOYEE")).isEqualByComparingTo("1800.00"); // min(25000,15000)*12%
        assertThat(lineAmt(r, "PF_EMPLOYER")).isEqualByComparingTo("1800.00");
        assertThat(r.net()).isEqualByComparingTo("23200.00");
    }

    // ── Test 8 ───────────────────────────────────────────────────────────────

    @Test
    void test8_lopThreeDaysFactorPoint9() {
        List<DayStatus> d = new ArrayList<>(Collections.nCopies(27, DayStatus.PRESENT));
        d.addAll(Collections.nCopies(3, DayStatus.LOP_LEAVE)); // 27 paid / 3 lop
        LopResult lop3 = LopCalculator.calculate(new LopInput(d, false, 0, 0, APRIL.atDay(1), null, APRIL));

        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "50000")), lop3, NONE,
            new EmployeeStructureCfg("ENROLLED", false, false)));

        assertThat(r.gross()).isEqualByComparingTo("45000.00");      // 50000 * 27/30
        assertThat(lineAmt(r, "BASIC")).isEqualByComparingTo("45000.00");
        assertThat(r.net()).isEqualByComparingTo("45000.00");
    }

    // ── Test 9 ───────────────────────────────────────────────────────────────

    @Test
    void test9_allStatutoryAndDeterminism() {
        PayrollEngineInput in = input(
            List.of(line(BASIC, "18000"), line(HRA, "2000")), fullMonth(), allOn(),
            new EmployeeStructureCfg("ENROLLED", true, true));
        PayrollResult r = PayrollEngine.compute(in);

        assertThat(r.gross()).isEqualByComparingTo("20000.00");
        assertThat(lineAmt(r, "PF_EMPLOYEE")).isEqualByComparingTo("1800.00");  // min(18000,15000)*12%
        assertThat(lineAmt(r, "ESI_EMPLOYEE")).isEqualByComparingTo("150.00");  // 20000*0.75%
        assertThat(lineAmt(r, "ESI_EMPLOYER")).isEqualByComparingTo("650.00");  // 20000*3.25%
        assertThat(lineAmt(r, "PT")).isEqualByComparingTo("200.00");
        assertThat(r.totalDeductions()).isEqualByComparingTo("2150.00");        // 1800+150+200
        assertThat(r.totalEmployerContrib()).isEqualByComparingTo("2450.00");   // 1800+650
        assertThat(r.net()).isEqualByComparingTo("17850.00");                   // 20000-2150
        // net == gross − pfEmp − esiEmp − pt
        assertThat(r.net()).isEqualByComparingTo(
            r.gross().subtract(lineAmt(r, "PF_EMPLOYEE")).subtract(lineAmt(r, "ESI_EMPLOYEE")).subtract(lineAmt(r, "PT")));

        // Determinism: same input twice → structurally identical result.
        PayrollResult again = PayrollEngine.compute(in);
        assertThat(again).isEqualTo(r);
        assertThat(again.lines()).isEqualTo(r.lines());
        assertThat(again.net()).isEqualByComparingTo(r.net());
    }

    // ── Test 10 ──────────────────────────────────────────────────────────────

    @Test
    void test10_allStatutoryOff() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "30000"), line(HRA, "12000"), line(SPECIAL, "8000")),
            fullMonth(), NONE, new EmployeeStructureCfg("NOT_APPLICABLE", false, false)));

        assertThat(r.gross()).isEqualByComparingTo("50000.00");
        assertThat(r.totalDeductions()).isEqualByComparingTo("0.00");
        assertThat(r.totalEmployerContrib()).isEqualByComparingTo("0.00");
        assertThat(r.net()).isEqualByComparingTo("50000.00");
        assertThat(hasLine(r, "PF_EMPLOYEE")).isFalse();
        assertThat(hasLine(r, "ESI_EMPLOYEE")).isFalse();
        assertThat(hasLine(r, "PT")).isFalse();
        assertThat(r.warnings()).isEmpty();
    }

    // ── Test 11 ──────────────────────────────────────────────────────────────

    @Test
    void test11_negativeNetWarnedAndEmitted() {
        PayrollResult r = PayrollEngine.compute(input(
            List.of(line(BASIC, "100")), fullMonth(), ptOn("200"),
            new EmployeeStructureCfg("ENROLLED", false, false)));

        assertThat(r.gross()).isEqualByComparingTo("100.00");
        assertThat(lineAmt(r, "PT")).isEqualByComparingTo("200.00");
        assertThat(r.net()).isEqualByComparingTo("-100.00");
        assertThat(r.net().signum()).isLessThan(0);
        assertThat(r.warnings()).anyMatch(w -> w.contains("NEGATIVE_NET"));
        assertThat(hasLine(r, "PT")).isTrue();   // still fully produced
    }
}
