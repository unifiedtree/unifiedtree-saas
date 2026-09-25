package com.hrms.api.payroll;

import com.hrms.api.payroll.SalaryRevisionPlanner.Candidate;
import com.hrms.api.payroll.SalaryRevisionPlanner.Line;
import com.hrms.api.payroll.SalaryRevisionPlanner.Mode;
import com.hrms.api.payroll.SalaryRevisionPlanner.Plan;
import com.hrms.api.payroll.SalaryRevisionPlanner.PlannedRow;
import com.hrms.api.payroll.SalaryRevisionPlanner.RunInfo;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class SalaryRevisionPlannerTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 25);
    private static final LocalDate OCT = LocalDate.of(2026, 10, 1);
    private final UUID basic = UUID.randomUUID(), hra = UUID.randomUUID(), special = UUID.randomUUID(),
            conveyance = UUID.randomUUID(), canteen = UUID.randomUUID();

    private static BigDecimal bd(String v) { return new BigDecimal(v); }

    private Candidate person(String code, String ctc, LocalDate from, List<Line> lines) {
        BigDecimal annual = ctc == null ? null : bd(ctc);
        return new Candidate(UUID.randomUUID(), code, "Person " + code, UUID.randomUUID(), "Acme",
                null, "Finance", null, "Analyst", "G2",
                ctc == null ? null : UUID.randomUUID(), annual,
                annual == null ? null : annual.divide(bd("12"), 2, java.math.RoundingMode.HALF_UP), from, lines);
    }

    private List<Line> split50000() {
        return List.of(
                new Line(basic, "BASIC", "Basic", "EARNING", bd("25000.00")),
                new Line(hra, "HRA", "HRA", "EARNING", bd("10000.00")),
                new Line(conveyance, "CONVEYANCE", "Conveyance", "EARNING", bd("1600.00")),
                new Line(special, "SPECIAL", "Special", "EARNING", bd("13400.00")),
                new Line(canteen, "CANTEEN", "Canteen", "DEDUCTION", bd("500.00")));
    }

    @Test void percentAndAmountGiveWholeRupeeCtc() {
        assertEquals(bd("630000.00"), SalaryRevisionPlanner.newCtc(bd("600000.00"), Mode.PERCENT, bd("5")));
        assertEquals(bd("633000.00"), SalaryRevisionPlanner.newCtc(bd("600000.00"), Mode.PERCENT, bd("5.5")));
        // 3.33% of 5,55,555 = 18,500.0815 → rounds to whole rupees.
        assertEquals(bd("574055.00"), SalaryRevisionPlanner.newCtc(bd("555555.00"), Mode.PERCENT, bd("3.33")));
        assertEquals(bd("624000.00"), SalaryRevisionPlanner.newCtc(bd("600000.00"), Mode.AMOUNT, bd("24000")));
    }

    @Test void scalingKeepsEachShareAndAddsUpExactly() {
        List<Line> gross = split50000().stream().filter(l -> SalaryRevisionPlanner.isGrossLine(l.category())).toList();
        List<Line> out = SalaryRevisionPlanner.scale(gross, bd("52500.00"));
        assertEquals(bd("52500.00"), out.stream().map(Line::monthlyAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        assertEquals(bd("26250.00"), out.get(0).monthlyAmount());
        assertEquals(bd("10500.00"), out.get(1).monthlyAmount());
        assertEquals(bd("1680.00"), out.get(2).monthlyAmount());
        assertEquals(bd("14070.00"), out.get(3).monthlyAmount());
        // Awkward numbers: the rounding difference lands on the largest line only.
        List<Line> odd = SalaryRevisionPlanner.scale(List.of(
                new Line(basic, "BASIC", "Basic", "EARNING", bd("3333.33")),
                new Line(hra, "HRA", "HRA", "EARNING", bd("3333.33")),
                new Line(special, "SPECIAL", "Special", "EARNING", bd("3333.34"))), bd("10001"));
        assertEquals(bd("10001.00"), odd.stream().map(Line::monthlyAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
    }

    @Test void planScalesOwnSplitKeepsOtherLinesAndTotals() {
        Candidate a = person("E1", "600000.00", LocalDate.of(2026, 4, 1), split50000());
        Candidate b = person("E2", "300000.00", LocalDate.of(2026, 4, 1), List.of()); // no components: paid as BASIC = CTC/12
        Plan plan = SalaryRevisionPlanner.plan(List.of(a, b), Mode.PERCENT, bd("5"), OCT);
        assertEquals(2, plan.rows().size());
        PlannedRow ra = plan.rows().get(0);
        assertEquals(bd("630000.00"), ra.newCtc());
        assertEquals(bd("30000.00"), ra.difference());
        assertEquals(bd("50000.00"), ra.oldGross());
        assertEquals(bd("52500.00"), ra.newGross());
        assertEquals(bd("52500.00"), ra.newCtcMonthly());
        assertFalse(ra.derivedFromCtc());
        // The deduction line is carried over untouched.
        assertTrue(ra.newLines().stream().anyMatch(l -> l.code().equals("CANTEEN") && l.monthlyAmount().compareTo(bd("500")) == 0));
        assertEquals(bd("52500.00"), ra.newLines().stream().filter(l -> SalaryRevisionPlanner.isGrossLine(l.category()))
                .map(Line::monthlyAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        PlannedRow rb = plan.rows().get(1);
        assertTrue(rb.derivedFromCtc());
        assertTrue(rb.newLines().isEmpty());
        assertEquals(bd("315000.00"), rb.newCtc());
        assertEquals(bd("26250.00"), rb.newGross());
        assertEquals(bd("900000.00"), plan.totalOldCtc());
        assertEquals(bd("945000.00"), plan.totalNewCtc());
        assertEquals(bd("45000.00"), plan.totalDifference());
    }

    @Test void planSkipsPeopleWithoutAStructureOrWithALaterOne() {
        Candidate none = person("E3", null, null, List.of());
        Candidate later = person("E4", "480000.00", OCT, List.of());
        Candidate ok = person("E5", "480000.00", LocalDate.of(2026, 9, 1), List.of());
        Plan plan = SalaryRevisionPlanner.plan(List.of(none, later, ok), Mode.AMOUNT, bd("12000"), OCT);
        assertEquals(1, plan.rows().size());
        assertEquals("E5", plan.rows().get(0).candidate().employeeCode());
        assertEquals(bd("492000.00"), plan.rows().get(0).newCtc());
        assertEquals(List.of(SalaryRevisionPlanner.SKIP_NO_STRUCTURE, SalaryRevisionPlanner.SKIP_LATER_REVISION),
                plan.skipped().stream().map(SalaryRevisionPlanner.Skipped::reason).toList());
        assertTrue(plan.skipped().get(1).detail().contains("1 Oct 2026"));
    }

    @Test void previewKeyChangesWhenAnythingThePersonSawChanges() {
        Candidate a = person("E1", "600000.00", LocalDate.of(2026, 4, 1), split50000());
        String k1 = SalaryRevisionPlanner.plan(List.of(a), Mode.PERCENT, bd("5"), OCT).previewKey();
        assertEquals(k1, SalaryRevisionPlanner.plan(List.of(a), Mode.PERCENT, bd("5.0"), OCT).previewKey());
        assertNotEquals(k1, SalaryRevisionPlanner.plan(List.of(a), Mode.PERCENT, bd("6"), OCT).previewKey());
        assertNotEquals(k1, SalaryRevisionPlanner.plan(List.of(a), Mode.PERCENT, bd("5"), OCT.plusMonths(1)).previewKey());
        Candidate changed = new Candidate(a.employeeId(), a.employeeCode(), a.name(), a.companyId(), a.companyName(),
                null, a.department(), null, a.designation(), a.grade(), UUID.randomUUID(), bd("610000.00"), bd("50833.33"),
                a.currentEffectiveFrom(), a.lines());
        assertNotEquals(k1, SalaryRevisionPlanner.plan(List.of(changed), Mode.PERCENT, bd("5"), OCT).previewKey());
    }

    @Test void validationSaysWhatIsWrongInPlainEnglish() {
        assertEquals(OCT, SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-10-01", "Annual increment", 0, TODAY, true));
        assertEquals(LocalDate.of(2026, 9, 1), SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-09-01", "Annual increment", 0, TODAY, true));
        assertCode("REVISION_VALUE_REQUIRED", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("0"), "2026-10-01", "Annual", 0, TODAY, true));
        assertCode("REVISION_VALUE_TOO_HIGH", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("100.5"), "2026-10-01", "Annual", 0, TODAY, true));
        assertCode("REVISION_VALUE_TOO_HIGH", () -> SalaryRevisionPlanner.validate(Mode.AMOUNT, bd("10000001"), "2026-10-01", "Annual", 0, TODAY, true));
        assertCode("REVISION_DATE_NOT_MONTH_START", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-10-15", "Annual", 0, TODAY, true));
        assertCode("REVISION_DATE_IN_PAST", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-08-01", "Annual", 0, TODAY, true));
        assertCode("REVISION_DATE_TOO_FAR", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2027-11-01", "Annual", 0, TODAY, true));
        assertCode("REVISION_DATE_INVALID", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "1 Oct", "Annual", 0, TODAY, true));
        assertCode("REVISION_REASON_REQUIRED", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-10-01", " a ", 0, TODAY, true));
        // A preview doesn't need the reason yet.
        assertEquals(OCT, SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-10-01", null, 0, TODAY, false));
        assertCode("REVISION_TOO_MANY", () -> SalaryRevisionPlanner.validate(Mode.PERCENT, bd("5"), "2026-10-01", "Annual", 5001, TODAY, true));
        assertCode("REVISION_MODE_REQUIRED", () -> SalaryRevisionPlanner.mode(null));
        assertCode("REVISION_MODE_INVALID", () -> SalaryRevisionPlanner.mode("HALF"));
        assertEquals(Mode.AMOUNT, SalaryRevisionPlanner.mode("amount"));
    }

    @Test void payrollRunsThatWouldBeWronglyAffectedBlockTheRevision() {
        UUID co = UUID.randomUUID();
        RunInfo augOpen = new RunInfo(co, "Acme", 2026, 8, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31), "PROCESSING");
        RunInfo sepLocked = new RunInfo(co, "Acme", 2026, 9, LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), "LOCKED");
        RunInfo octDraft = new RunInfo(co, "Acme", 2026, 10, LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31), "DRAFT");
        RunInfo julPaid = new RunInfo(co, "Acme", 2026, 7, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31), "PAID");
        // From 1 Oct: the open August run would pick up October pay if re-processed.
        List<String> oct = SalaryRevisionPlanner.runBlockers(List.of(julPaid, augOpen, sepLocked, octDraft), OCT);
        assertEquals(1, oct.size());
        assertTrue(oct.get(0).contains("Aug 2026") && oct.get(0).contains("still open"), oct.get(0));
        // From 1 Sep: September is already locked, so the new pay can't reach it.
        List<String> sep = SalaryRevisionPlanner.runBlockers(List.of(julPaid, sepLocked), LocalDate.of(2026, 9, 1));
        assertEquals(1, sep.size());
        assertTrue(sep.get(0).contains("Sep 2026") && sep.get(0).contains("locked") && sep.get(0).contains("1 Oct 2026"), sep.get(0));
        assertTrue(SalaryRevisionPlanner.runBlockers(List.of(julPaid, octDraft), OCT).isEmpty());
    }

    @Test void monthsNotYetLockedBeforeTheDateBlockOrWarn() {
        UUID co = UUID.randomUUID(), fresh = UUID.randomUUID();
        LocalDate today = LocalDate.of(2026, 9, 25);
        RunInfo augLocked = new RunInfo(co, "Acme", 2026, 8, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31), "LOCKED");
        RunInfo sepLocked = new RunInfo(co, "Acme", 2026, 9, LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), "PAID");
        // August locked, September not run yet: from 1 Oct, the September run would pay October's pay.
        var oct = SalaryRevisionPlanner.unlockedMonthChecks(List.of(augLocked), java.util.Map.of(co, "Acme"), OCT, today);
        assertEquals(1, oct.blockers().size());
        assertTrue(oct.blockers().get(0).contains("Sep 2026") && oct.blockers().get(0).contains("1 Sep 2026"), oct.blockers().get(0));
        // From 1 Sep it is fine, and so is 1 Oct once September is locked.
        assertTrue(SalaryRevisionPlanner.unlockedMonthChecks(List.of(augLocked), java.util.Map.of(co, "Acme"), LocalDate.of(2026, 9, 1), today).blockers().isEmpty());
        assertTrue(SalaryRevisionPlanner.unlockedMonthChecks(List.of(augLocked, sepLocked), java.util.Map.of(co, "Acme"), OCT, today).blockers().isEmpty());
        // A gap in the past can't be fixed by picking an earlier date: only "lock it first".
        var late = SalaryRevisionPlanner.unlockedMonthChecks(List.of(augLocked), java.util.Map.of(co, "Acme"), OCT, LocalDate.of(2026, 10, 3));
        assertEquals(1, late.blockers().size());
        assertFalse(late.blockers().get(0).contains("or choose"), late.blockers().get(0));
        // A company that has never locked payroll: allowed, with a warning for a later month only.
        var never = SalaryRevisionPlanner.unlockedMonthChecks(List.of(), java.util.Map.of(fresh, "NewCo"), OCT, today);
        assertTrue(never.blockers().isEmpty());
        assertEquals(1, never.warnings().size());
        assertTrue(never.warnings().get(0).contains("NewCo") && never.warnings().get(0).contains("1 Sep 2026"), never.warnings().get(0));
        assertTrue(SalaryRevisionPlanner.unlockedMonthChecks(List.of(), java.util.Map.of(fresh, "NewCo"), LocalDate.of(2026, 9, 1), today).warnings().isEmpty());
        // An open earlier run is reported by runBlockers, not twice.
        RunInfo sepDraft = new RunInfo(co, "Acme", 2026, 9, LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), "DRAFT");
        var open = SalaryRevisionPlanner.unlockedMonthChecks(List.of(augLocked, sepDraft), java.util.Map.of(co, "Acme"), OCT, today);
        assertTrue(open.blockers().isEmpty() && open.warnings().isEmpty());
    }

    @Test void moneyAndChangeReadTheIndianWay() {
        assertEquals("₹6,30,000", SalaryRevisionPlanner.rupees(bd("630000.00")));
        assertEquals("₹1,00,00,000", SalaryRevisionPlanner.rupees(bd("10000000")));
        assertEquals("₹999", SalaryRevisionPlanner.rupees(bd("999")));
        assertEquals("+5%", SalaryRevisionPlanner.describe(Mode.PERCENT, bd("5.00")));
        assertEquals("+₹24,000 a year", SalaryRevisionPlanner.describe(Mode.AMOUNT, bd("24000")));
    }

    private static void assertCode(String code, org.junit.jupiter.api.function.Executable run) {
        BusinessRuleException ex = assertThrows(BusinessRuleException.class, run);
        assertEquals(code, ex.getErrorCode(), ex.getMessage());
    }
}
