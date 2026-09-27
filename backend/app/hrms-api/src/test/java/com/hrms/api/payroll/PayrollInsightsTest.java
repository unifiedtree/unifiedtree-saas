package com.hrms.api.payroll;

import com.hrms.api.payroll.PayrollInsights.Check;
import com.hrms.api.payroll.PayrollInsights.Due;
import com.hrms.api.payroll.PayrollInsights.Note;
import com.hrms.api.payroll.PayrollInsights.Person;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Month;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** The rules behind the redesign's payroll read models (BW-50 to BW-57). No database. */
class PayrollInsightsTest {

    private static BigDecimal bd(String v) { return new BigDecimal(v); }

    private static final LocalDate START = LocalDate.of(2026, 9, 1);
    private static final LocalDate END = LocalDate.of(2026, 9, 30);

    // ── BW-50 run fields ──────────────────────────────────────────────────────

    @Test
    void changeIsAgainstThePreviousFigureWithOneDecimal() {
        assertEquals(bd("10.0"), PayrollInsights.changePercent(bd("55000"), bd("50000")));
        assertEquals(bd("-12.5"), PayrollInsights.changePercent(bd("35000"), bd("40000")));
        assertEquals(bd("0.0"), PayrollInsights.changePercent(bd("100"), bd("100")));
        assertNull(PayrollInsights.changePercent(bd("100"), null), "not in the previous run");
        assertNull(PayrollInsights.changePercent(bd("100"), BigDecimal.ZERO), "no division by zero");
        assertNull(PayrollInsights.changePercent(null, bd("100")));
    }

    @Test
    void aNewJoinerJoinedInsideThePeriodAndIsProratedOnlyAfterDayOne() {
        assertTrue(PayrollInsights.newJoiner(START, START, END));
        assertFalse(PayrollInsights.prorated(START, START, END), "joined on day one: a full month");
        assertTrue(PayrollInsights.newJoiner(LocalDate.of(2026, 9, 7), START, END));
        assertTrue(PayrollInsights.prorated(LocalDate.of(2026, 9, 7), START, END));
        assertFalse(PayrollInsights.newJoiner(LocalDate.of(2026, 8, 31), START, END));
        assertFalse(PayrollInsights.newJoiner(LocalDate.of(2026, 10, 1), START, END));
        assertFalse(PayrollInsights.newJoiner(null, START, END));
        assertFalse(PayrollInsights.prorated(null, START, END));
    }

    @Test
    void theBankTestIsTheBankFilesOwn() {
        assertTrue(PayrollInsights.bankUsable(true, "HDFC0001234"));
        assertFalse(PayrollInsights.bankUsable(false, "HDFC0001234"));
        assertFalse(PayrollInsights.bankUsable(true, "HDFC1001234"), "fifth character must be 0");
        assertFalse(PayrollInsights.bankUsable(true, null));
        assertEquals("READY", PayrollInsights.bankStatus(true, "SBIN0000001"));
        assertEquals("SKIPPED_MISSING_DETAILS", PayrollInsights.bankStatus(false, null));
        assertEquals("SKIPPED_INVALID_IFSC", PayrollInsights.bankStatus(true, "bad"));
        assertNull(PayrollInsights.bankProblem(true, "SBIN0000001"));
        assertEquals("No primary bank account on file", PayrollInsights.bankProblem(false, null));
        assertEquals("Invalid IFSC: bad", PayrollInsights.bankProblem(true, "bad"));
    }

    @Test
    void needsReviewComesFromTheReviewChecksOnly() {
        assertEquals(List.of(), PayrollInsights.reviewReasons(bd("10.0"), true, false), "exactly 10% is not more than 10%");
        assertEquals(List.of("VARIANCE"), PayrollInsights.reviewReasons(bd("10.1"), true, false));
        assertEquals(List.of("VARIANCE"), PayrollInsights.reviewReasons(bd("-25.0"), true, false));
        assertEquals(List.of("MISSING_BANK", "FNF_IN_PROGRESS"), PayrollInsights.reviewReasons(null, false, true));
        assertEquals(Set.of("VARIANCE", "MISSING_BANK", "FNF_IN_PROGRESS"), PayrollInsights.REVIEW_KEYS);
    }

    // ── BW-51 checks before you lock ──────────────────────────────────────────

    private static Person person(String name, String net, String change, boolean bank, boolean fnf, LocalDate joined, String lop) {
        return new Person(UUID.nameUUIDFromBytes(name.getBytes()), name, net == null ? null : bd(net),
                change == null ? null : bd(change), bank, fnf, joined, lop == null ? null : bd(lop));
    }

    @Test
    void everyCheckWithItsPeopleInAFixedOrder() {
        Person asha = person("Asha", "50000", "12.0", true, false, null, null);
        Person ravi = person("Ravi", "40000", null, false, false, LocalDate.of(2026, 9, 7), "2");
        Person meena = person("Meena", "30000", "-3.0", true, true, null, null);
        UUID skipped = UUID.randomUUID();
        List<Check> checks = PayrollInsights.checks(List.of(asha, ravi, meena), List.of(skipped), START, END, "Aug 2026");

        assertEquals(List.of("VARIANCE", "MISSING_BANK", "PRORATED_JOINERS", "FNF_IN_PROGRESS", "SKIPPED", "LOP"),
                checks.stream().map(Check::key).toList());
        Map<String, Check> byKey = new HashMap<>();
        checks.forEach(c -> byKey.put(c.key(), c));

        assertEquals("1 employee changed more than 10% from Aug 2026", byKey.get("VARIANCE").text());
        assertEquals(List.of(asha.employeeId()), byKey.get("VARIANCE").employeeIds());
        assertEquals("WARNING", byKey.get("VARIANCE").severity());
        assertTrue(byKey.get("VARIANCE").needsReview());

        assertEquals("1 employee is missing bank details", byKey.get("MISSING_BANK").text());
        assertEquals("CRITICAL", byKey.get("MISSING_BANK").severity());
        assertTrue(byKey.get("MISSING_BANK").needsReview());

        assertEquals("1 new joiner is prorated from 7 Sep", byKey.get("PRORATED_JOINERS").text());
        assertEquals("INFO", byKey.get("PRORATED_JOINERS").severity());
        assertFalse(byKey.get("PRORATED_JOINERS").needsReview());

        assertEquals("Full & final for Meena is in progress", byKey.get("FNF_IN_PROGRESS").text());
        assertTrue(byKey.get("FNF_IN_PROGRESS").needsReview());

        assertEquals("1 employee was left out: no salary structure", byKey.get("SKIPPED").text());
        assertEquals(List.of(skipped), byKey.get("SKIPPED").employeeIds());
        assertFalse(byKey.get("SKIPPED").needsReview());

        assertEquals("1 employee has loss of pay this month", byKey.get("LOP").text());
        assertEquals(1, byKey.get("LOP").count());
    }

    @Test
    void checksCountPeopleAndSayItInPlainWords() {
        List<Person> people = List.of(
                person("A", "100", "20.0", false, true, LocalDate.of(2026, 9, 10), "1"),
                person("B", "100", "-30.0", false, true, LocalDate.of(2026, 9, 12), "1"));
        Map<String, Check> byKey = new HashMap<>();
        PayrollInsights.checks(people, List.of(UUID.randomUUID(), UUID.randomUUID()), START, END, null)
                .forEach(c -> byKey.put(c.key(), c));
        assertEquals("2 employees changed more than 10% from the previous month", byKey.get("VARIANCE").text());
        assertEquals("2 employees are missing bank details", byKey.get("MISSING_BANK").text());
        assertEquals("2 new joiners are prorated", byKey.get("PRORATED_JOINERS").text());
        assertEquals("Full & final is in progress for 2 employees", byKey.get("FNF_IN_PROGRESS").text());
        assertEquals("2 employees were left out: no salary structure", byKey.get("SKIPPED").text());
        assertEquals("2 employees have loss of pay this month", byKey.get("LOP").text());
    }

    @Test
    void aCleanRunHasNoChecksAndNobodyWithoutPayIsFlaggedForTheBank() {
        assertEquals(List.of(), PayrollInsights.checks(List.of(person("A", "100", "5.0", true, false, null, "0")),
                List.of(), START, END, "Aug 2026"));
        // Zero net pay is left out of the bank file, so a missing account doesn't matter.
        assertEquals(List.of(), PayrollInsights.checks(List.of(person("Z", "0", null, false, false, null, null)),
                null, START, END, "Aug 2026"));
        assertEquals(List.of(), PayrollInsights.checks(List.of(), List.of(), START, END, null));
    }

    // ── BW-52 statutory dues ──────────────────────────────────────────────────

    @Test
    void duesHaveTheLegalDatesAndTdsOnlyWhenARunHasIt() {
        Map<String, BigDecimal> amounts = new HashMap<>();
        amounts.put("PF_EMPLOYEE", bd("1800"));
        amounts.put("PF_EMPLOYER", bd("1800"));
        amounts.put("ESI_EMPLOYEE", bd("75"));
        amounts.put("ESI_EMPLOYER", bd("325"));
        amounts.put("PT", bd("200"));
        List<Due> dues = PayrollInsights.statutoryDues(amounts, 2026, 9);
        assertEquals(List.of("PF", "ESI", "PT"), dues.stream().map(Due::scheme).toList(), "no LWF, no TDS lines");
        assertEquals(new Due("PF", "Provident fund", bd("1800"), bd("1800"), bd("3600"), "2026-10-15"), dues.get(0));
        assertEquals("2026-10-15", dues.get(1).dueDate());
        assertEquals(bd("400"), dues.get(1).total());
        assertNull(dues.get(2).dueDate(), "PT's date depends on the state");

        amounts.put("TDS", bd("5000"));
        amounts.put("LWF_EMPLOYEE", bd("10"));
        List<Due> withTds = PayrollInsights.statutoryDues(amounts, 2026, 12);
        assertEquals(List.of("PF", "ESI", "PT", "LWF", "TDS"), withTds.stream().map(Due::scheme).toList());
        assertEquals("2027-01-15", withTds.get(0).dueDate(), "December's dues fall in January");
        assertEquals("2027-01-07", withTds.get(4).dueDate());
        assertNull(withTds.get(3).dueDate());
    }

    @Test
    void aRunWithoutStatutoryLinesHasNoDues() {
        assertEquals(List.of(), PayrollInsights.statutoryDues(Map.of(), 2026, 9));
        assertEquals(List.of(), PayrollInsights.statutoryDues(Map.of("PF_EMPLOYEE", BigDecimal.ZERO), 2026, 9));
    }

    // ── BW-55 my payslips ─────────────────────────────────────────────────────

    @Test
    void notesSayWhatWasSpecialAboutTheMonth() {
        List<Note> notes = PayrollInsights.notes(bd("5000"), "Performance incentive", bd("2140.30"), null,
                BigDecimal.ZERO, "Leave encashment", LocalDate.of(2026, 4, 1));
        assertEquals(List.of(
                new Note("PLI", "Performance incentive", bd("5000"), null),
                new Note("ADVANCE_RECOVERY", "Advance recovery", bd("2140.30"), null),
                new Note("NEW_SALARY", "First month on the new salary", null, "2026-04-01")), notes);
        assertEquals(List.of(), PayrollInsights.notes(BigDecimal.ZERO, null, BigDecimal.ZERO, null, null, null, null));
    }

    @Test
    void theFinancialYearFollowsTheCompany() {
        assertEquals(Month.APRIL, PayrollInsights.fiscalYearStart(null));
        assertEquals(Month.APRIL, PayrollInsights.fiscalYearStart("not a month"));
        assertEquals(Month.JULY, PayrollInsights.fiscalYearStart(" july "));

        LocalDate[] fy = PayrollInsights.fiscalYear(LocalDate.of(2026, 9, 27), Month.APRIL);
        assertEquals(LocalDate.of(2026, 4, 1), fy[0]);
        assertEquals(LocalDate.of(2027, 3, 31), fy[1]);
        assertEquals("FY 2026–27", PayrollInsights.fiscalYearLabel(fy[0]));

        LocalDate[] early = PayrollInsights.fiscalYear(LocalDate.of(2027, 2, 10), Month.APRIL);
        assertEquals(LocalDate.of(2026, 4, 1), early[0], "February still belongs to the year that began in April");

        LocalDate[] calendar = PayrollInsights.fiscalYear(LocalDate.of(2026, 9, 27), Month.JANUARY);
        assertEquals(LocalDate.of(2026, 1, 1), calendar[0]);
        assertEquals(LocalDate.of(2026, 12, 31), calendar[1]);
        assertEquals("FY 2026", PayrollInsights.fiscalYearLabel(calendar[0]));
    }

    @Test
    void theNextPayDateFromSettingsIsTheNextProcessingDayOfAMonthWithoutARun() {
        LocalDate today = LocalDate.of(2026, 9, 27);
        assertEquals(LocalDate.of(2026, 9, 28), PayrollInsights.nextProcessingDate(today, 1, 28, Set.of()));
        assertEquals(LocalDate.of(2026, 9, 27), PayrollInsights.nextProcessingDate(today, 1, 27, Set.of()), "today counts");
        assertEquals(LocalDate.of(2026, 10, 25), PayrollInsights.nextProcessingDate(today, 1, 25, Set.of()), "passed this month");
        assertEquals(LocalDate.of(2026, 10, 28), PayrollInsights.nextProcessingDate(today, 1, 28, Set.of("2026-09")),
                "September already has a run, whose own pay date counts");
        assertEquals(LocalDate.of(2026, 9, 30), PayrollInsights.nextProcessingDate(today, 1, 31, null), "short month");
        assertEquals(LocalDate.of(2027, 2, 28), PayrollInsights.nextProcessingDate(LocalDate.of(2027, 2, 1), 1, 31, Set.of()));
        // A cycle from the 26th: the October run covers 26 Sep – 25 Oct and is paid on 28 Oct.
        assertEquals(LocalDate.of(2026, 10, 28), PayrollInsights.nextProcessingDate(today, 26, 28, Set.of()));
        assertEquals(LocalDate.of(2026, 9, 28), PayrollInsights.nextProcessingDate(LocalDate.of(2026, 9, 20), 26, 28, Set.of()));
    }

    @Test
    void periodLabelsAreShortMonths() {
        assertEquals("Sep 2026", PayrollInsights.periodLabel(9, 2026));
        assertEquals("Jan 2027", PayrollInsights.periodLabel(1, 2027));
    }
}
