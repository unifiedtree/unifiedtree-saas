package com.hrms.app.reports;

import com.hrms.app.reports.HeadcountWorkbook.Row;
import com.hrms.app.reports.HeadcountWorkbook.Workbook;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** The dashboard's headcount workbook (D2 fiscal year, as-of statuses, permissions), without a database. */
class HeadcountWorkbookTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 25);

    private static Row row(String code, String status, LocalDate joined) {
        return new Row(UUID.randomUUID(), code, "Asha", null, code, code.toLowerCase() + "@acme.test", "FEMALE",
                "FULL_TIME", status, true, joined, joined, null, null, null, null, null,
                "Engineering", "Developer", "Pune", "Ravi Kumar");
    }

    private static Row with(Row r, String field, Object v) {
        return new Row(r.id(), r.code(), r.firstName(), r.middleName(), r.lastName(), r.workEmail(), r.gender(),
                field.equals("type") ? (String) v : r.employmentType(), r.employmentStatus(), r.active(),
                r.dateOfJoining(), r.createdOn(),
                field.equals("probationEnd") ? (LocalDate) v : r.probationEndDate(),
                field.equals("confirmed") ? (LocalDate) v : r.confirmationDate(),
                field.equals("noticeStart") ? (LocalDate) v : r.noticeStartDate(),
                field.equals("lastDay") ? (LocalDate) v : r.lastWorkingDay(), r.dateOfTermination(),
                field.equals("department") ? (String) v : r.department(), r.designation(),
                field.equals("branch") ? (String) v : r.branch(), r.manager());
    }

    private static Workbook build(LocalDate asOf, List<Row> rows, boolean employees, boolean gender) {
        return HeadcountWorkbook.build("Acme Industries", asOf, TODAY, "APRIL", rows, employees, gender);
    }

    @Test void todayUsesTheCurrentStatuses() {
        List<Row> rows = List.of(
                row("E1", "ACTIVE", LocalDate.of(2024, 1, 10)),
                row("E2", "PROBATION", LocalDate.of(2026, 9, 1)),
                with(row("E3", "NOTICE_PERIOD", LocalDate.of(2023, 5, 1)), "lastDay", LocalDate.of(2026, 10, 15)),
                with(row("E4", "EXITED", LocalDate.of(2022, 1, 1)), "lastDay", LocalDate.of(2026, 9, 5)),
                row("E5", "SUSPENDED", LocalDate.of(2021, 1, 1)));
        Workbook w = build(TODAY, rows, true, false);
        assertEquals(4, w.totals().total());
        assertEquals(1, w.totals().active());
        assertEquals(1, w.totals().probation());
        assertEquals(1, w.totals().onNotice());
        assertEquals(1, w.totals().suspended());
        assertEquals(1, w.totals().joinedThisMonth());
        assertEquals(1, w.totals().leftThisMonth());
        assertFalse(w.pastDate());
    }

    @Test void aPastDateIsWorkedOutFromTheDates() {
        LocalDate asOf = LocalDate.of(2026, 6, 30);
        List<Row> rows = List.of(
                // not joined yet on 30 June
                row("P1", "PROBATION", LocalDate.of(2026, 9, 1)),
                // confirmed later, so still on probation then
                with(row("P2", "ACTIVE", LocalDate.of(2026, 5, 1)), "confirmed", LocalDate.of(2026, 8, 1)),
                // probation over by then, no confirmation date recorded
                with(row("P3", "ACTIVE", LocalDate.of(2026, 1, 1)), "probationEnd", LocalDate.of(2026, 6, 1)),
                // serving notice then, left since
                with(with(row("P4", "EXITED", LocalDate.of(2020, 1, 1)), "noticeStart", LocalDate.of(2026, 6, 15)),
                        "lastDay", LocalDate.of(2026, 7, 15)),
                // left the day before
                with(row("P5", "EXITED", LocalDate.of(2020, 1, 1)), "lastDay", LocalDate.of(2026, 6, 29)));
        Workbook w = build(asOf, rows, true, false);
        assertTrue(w.pastDate());
        assertEquals(3, w.totals().total());
        assertEquals(1, w.totals().probation());
        assertEquals(1, w.totals().active());
        assertEquals(1, w.totals().onNotice());
        assertEquals(1, w.totals().leftThisMonth());
        assertEquals(List.of("P2", "P3", "P4"), w.employees().stream().map(HeadcountWorkbook.Person::employeeCode).toList());
        assertEquals("On notice", w.employees().get(2).status());
        assertEquals("2026-07-15", w.employees().get(2).noticeLastDay());
    }

    @Test void theLastWorkingDayStillCounts() {
        Row leaver = with(row("L1", "EXITED", LocalDate.of(2020, 1, 1)), "lastDay", LocalDate.of(2026, 6, 30));
        assertEquals(1, build(LocalDate.of(2026, 6, 30), List.of(leaver), false, false).totals().total());
        assertEquals(0, build(LocalDate.of(2026, 7, 1), List.of(leaver), false, false).totals().total());
    }

    @Test void breakdownsUseNamesNeverIds() {
        List<Row> rows = List.of(
                row("A1", "ACTIVE", LocalDate.of(2024, 1, 1)),
                with(row("A2", "ACTIVE", LocalDate.of(2024, 1, 1)), "department", null),
                with(with(row("A3", "PROBATION", LocalDate.of(2026, 9, 2)), "type", "CONTRACT"), "branch", " "));
        Workbook w = build(TODAY, rows, true, false);
        assertEquals("Engineering", w.byDepartment().get(0).name());
        assertEquals(2, w.byDepartment().get(0).total());
        assertEquals("No department", w.byDepartment().get(1).name());
        assertTrue(w.byBranch().stream().anyMatch(g -> g.name().equals("No branch")));
        assertTrue(w.byEmploymentType().stream().anyMatch(g -> g.name().equals("Contract") && g.probation() == 1));
        assertTrue(w.byEmploymentType().stream().anyMatch(g -> g.name().equals("Full-time") && g.total() == 2));
        String everything = w.toString();
        for (Row r : rows) assertFalse(everything.contains(r.id().toString()), "row id leaked");
    }

    @Test void theEmployeeListAndGenderNeedTheirPermissions() {
        List<Row> rows = List.of(row("G1", "ACTIVE", LocalDate.of(2024, 1, 1)));
        Workbook none = build(TODAY, rows, false, false);
        assertFalse(none.employeesIncluded());
        assertNull(none.employees());
        assertFalse(none.genderIncluded());
        assertNull(none.byGender());
        Workbook all = build(TODAY, rows, true, true);
        assertEquals(1, all.employees().size());
        assertEquals("Female", all.byGender().get(0).name());
        HeadcountWorkbook.Person p = all.employees().get(0);
        assertEquals("Asha G1", p.name());
        assertEquals("Ravi Kumar", p.reportingManager());
        assertEquals("Full-time", p.employmentType());
        assertEquals("2024-01-01", p.dateOfJoining());
    }

    @Test void fiscalYearComesFromTheCompanyStartMonth() {
        HeadcountWorkbook.FiscalYear april = HeadcountWorkbook.fiscalYear(LocalDate.of(2026, 9, 25), "APRIL");
        assertEquals(LocalDate.of(2026, 4, 1), april.from());
        assertEquals(LocalDate.of(2027, 3, 31), april.to());
        assertEquals("FY 2026-27", april.label());
        HeadcountWorkbook.FiscalYear beforeApril = HeadcountWorkbook.fiscalYear(LocalDate.of(2027, 2, 10), "april");
        assertEquals(LocalDate.of(2026, 4, 1), beforeApril.from());
        HeadcountWorkbook.FiscalYear jan = HeadcountWorkbook.fiscalYear(LocalDate.of(2026, 9, 25), "JANUARY");
        assertEquals("FY 2026", jan.label());
        assertEquals(LocalDate.of(2026, 12, 31), jan.to());
        assertEquals("APRIL", HeadcountWorkbook.fiscalYear(LocalDate.of(2026, 9, 25), null).startMonth());
        assertEquals("APRIL", HeadcountWorkbook.fiscalYear(LocalDate.of(2026, 9, 25), "Q1").startMonth());
    }

    @Test void joinersAndLeaversThisFiscalYear() {
        List<Row> rows = List.of(
                row("F1", "ACTIVE", LocalDate.of(2026, 4, 1)),
                row("F2", "ACTIVE", LocalDate.of(2026, 3, 31)),
                with(row("F3", "EXITED", LocalDate.of(2020, 1, 1)), "lastDay", LocalDate.of(2026, 5, 5)));
        Workbook w = build(TODAY, rows, false, false);
        assertEquals(1, w.totals().joinedThisFiscalYear());
        assertEquals(1, w.totals().leftThisFiscalYear());
        assertEquals("FY 2026-27", w.fiscalYear().label());
    }
}
