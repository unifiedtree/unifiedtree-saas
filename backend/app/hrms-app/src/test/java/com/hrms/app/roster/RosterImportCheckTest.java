package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.ImportProblem;
import com.hrms.api.roster.RosterContract.ImportRow;
import com.hrms.api.roster.RosterContract.Level;
import com.hrms.api.roster.RosterContract.MatchedBy;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.api.roster.plan.PlanFacts;
import com.hrms.app.roster.RosterImportCheck.Outcome;
import com.hrms.app.roster.RosterImportCheck.Target;
import com.hrms.app.roster.RosterSheetParser.ParsedSheet;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static com.hrms.app.roster.ImportFixture.A;
import static com.hrms.app.roster.ImportFixture.ANITHA;
import static com.hrms.app.roster.ImportFixture.B;
import static com.hrms.app.roster.ImportFixture.BUILDING_2;
import static com.hrms.app.roster.ImportFixture.C;
import static com.hrms.app.roster.ImportFixture.G;
import static com.hrms.app.roster.ImportFixture.JAN_1;
import static com.hrms.app.roster.ImportFixture.KIRAN;
import static com.hrms.app.roster.ImportFixture.LAKSHMI;
import static com.hrms.app.roster.ImportFixture.MEERA;
import static com.hrms.app.roster.ImportFixture.PRAVEEN;
import static com.hrms.app.roster.ImportFixture.RAJ_TECH;
import static com.hrms.app.roster.ImportFixture.RAVI;
import static com.hrms.app.roster.ImportFixture.SHIVA;
import static com.hrms.app.roster.ImportFixture.TECHNICAL;
import static com.hrms.app.roster.ImportFixture.facts;
import static com.hrms.app.roster.ImportFixture.januaryHeader;
import static com.hrms.app.roster.ImportFixture.januaryRow;
import static com.hrms.app.roster.ImportFixture.sheet;
import static com.hrms.app.roster.ImportFixture.technical;
import static org.assertj.core.api.Assertions.assertThat;

/** One test per import rule of design §1.7 ("People" and "Per-cell results"), with the row and column it reports. */
class RosterImportCheckTest {

    private static LocalDate jan(int d) {
        return JAN_1.withDayOfMonth(d);
    }

    private static Outcome run(List<List<Object>> rows, Target t, PlanFacts f, List<PlannerPerson> people) {
        ParsedSheet s = RosterSheetParser.parse("roster.xlsx", ImportFixture.xlsx(rows), t.start(), t.end());
        return RosterImportCheck.cells(s, RosterImportCheck.match(s, people, t), f, t);
    }

    private static Outcome run(List<List<Object>> rows, Target t, PlanFacts f) {
        return run(rows, t, f, ImportFixture.everyone());
    }

    private static Outcome run(List<List<Object>> rows) {
        return run(rows, technical(), facts(ImportFixture.everyone()));
    }

    private static List<List<Object>> one(PlannerPerson p, Map<Integer, String> codes) {
        return sheet(januaryHeader(), List.of(januaryRow(p, codes)));
    }

    /** A sheet with only "Employee" and the 31 days (people matched by name). */
    private static List<List<Object>> byName(String... names) {
        List<Object> header = new ArrayList<>(List.of("Employee"));
        for (int d = 1; d <= 31; d++) header.add(String.format("%02d", d));
        List<List<Object>> rows = new ArrayList<>(List.of(header));
        for (String n : names) rows.add(new ArrayList<>(List.of(n, "A")));
        return rows;
    }

    private static ImportProblem only(Outcome o, String code) {
        List<ImportProblem> found = o.problems().stream().filter(p -> p.code().equals(code)).toList();
        assertThat(found).as("problems with code " + code + " in " + o.problems()).hasSize(1);
        return found.get(0);
    }

    // ── people ───────────────────────────────────────────────────────────────

    @Test
    void matchesByEmployeeCodeInAnyCase() {
        List<Object> row = januaryRow(RAVI, Map.of(1, "A"));
        row.set(0, "R. Kumar");
        row.set(1, "tv-101");
        Outcome o = run(sheet(januaryHeader(), List.of(row)));

        ImportRow r = o.rows().get(0);
        assertThat(r.employeeId()).isEqualTo(RAVI.employeeId());
        assertThat(r.matchedBy()).isEqualTo(MatchedBy.CODE);
        assertThat(r.sheetEmployee()).isEqualTo("R. Kumar");
        assertThat(only(o, "RECORD_DIFFERS").severity()).isEqualTo(Level.info);
        assertThat(only(o, "RECORD_DIFFERS").message()).contains("name 'R. Kumar' (the record says 'Ravi Kumar')");
        assertThat(o.summary().errors()).isZero();
    }

    @Test
    void matchesByNameWithinTheRostersScope() {
        // Two people are called Raj Kumar, one in Technical and one in Admin: the Technical roster picks its own.
        Outcome o = run(byName("raj  kumar"));
        assertThat(o.rows().get(0).employeeId()).isEqualTo(RAJ_TECH.employeeId());
        assertThat(o.rows().get(0).matchedBy()).isEqualTo(MatchedBy.NAME);
        assertThat(o.summary().errors()).isZero();
    }

    @Test
    void twoPeopleWithTheSameNameNeedTheEmployeeCode() {
        Target companyWide = ImportFixture.target(null, null, null, null, true, Set.of());
        Outcome o = run(byName("Raj Kumar"), companyWide, facts(ImportFixture.everyone()));
        ImportProblem p = only(o, "AMBIGUOUS_NAME");
        assertThat(p.severity()).isEqualTo(Level.error);
        assertThat(p.rowNo()).isEqualTo(2);
        assertThat(p.column()).isEqualTo("A");
        assertThat(p.message()).isEqualTo("2 people are called Raj Kumar; add the employee code.");
        assertThat(o.rows().get(0).employeeId()).isNull();
        assertThat(o.members()).isEmpty();
    }

    @Test
    void someoneNotFoundByNameOrByCode() {
        List<Object> unknownCode = januaryRow(RAVI, Map.of(1, "A"));
        unknownCode.set(1, "XX-9");
        List<Object> unknownName = januaryRow(RAVI, Map.of(1, "A"));
        unknownName.set(0, "Nobody Here");
        unknownName.set(1, "");
        Outcome o = run(sheet(januaryHeader(), List.of(unknownCode, unknownName)));

        List<ImportProblem> notFound = o.problems().stream().filter(p -> p.code().equals("NOT_FOUND")).toList();
        assertThat(notFound).extracting(ImportProblem::rowNo, ImportProblem::column)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(3, "B"), org.assertj.core.groups.Tuple.tuple(4, "A"));
        assertThat(notFound.get(0).message()).isEqualTo("No one with the employee code 'XX-9' works in this company in January 2027.");
        assertThat(notFound.get(1).message()).startsWith("No one called 'Nobody Here' works in this company in January 2027.");
        assertThat(o.summary().matched()).isZero();
        assertThat(o.summary().errors()).isEqualTo(2);
    }

    @Test
    void someoneOutsideTheRostersDepartmentIsAnError() {
        Outcome o = run(one(MEERA, Map.of(1, "A")));
        ImportProblem p = only(o, "E2");
        assertThat(p.severity()).isEqualTo(Level.error);
        assertThat(p.column()).isEqualTo("B");
        assertThat(p.message()).isEqualTo("Meera Nair is not in Technical (they're in Admin).");
        assertThat(o.members()).isEmpty();
    }

    @Test
    void someoneOutsideTheRostersBuildingIsAnError() {
        Target building2 = ImportFixture.target(TECHNICAL, "Technical", BUILDING_2, "Building 2", true, Set.of());
        Outcome o = run(one(RAVI, Map.of(1, "A")), building2, facts(ImportFixture.everyone()));
        assertThat(only(o, "E2").message()).isEqualTo("Ravi Kumar is not at Building 2 (they're at Building 1).");
    }

    @Test
    void aDepartmentHeadCannotImportPeopleOutsideTheirDepartments() {
        Target head = ImportFixture.target(TECHNICAL, "Technical", null, null, false, Set.of(TECHNICAL));
        List<List<Object>> rows = sheet(januaryHeader(), List.of(januaryRow(MEERA, Map.of(1, "A")), januaryRow(RAVI, Map.of(1, "B"))));
        Outcome o = run(rows, head, facts(ImportFixture.everyone()));
        assertThat(only(o, "E5").message()).isEqualTo("Only HR can plan Meera Nair: they're outside the departments you head.");
        assertThat(o.members()).extracting(RosterContract.MemberIn::employeeId).containsExactly(RAVI.employeeId());
    }

    @Test
    void theSamePersonTwiceIsAnError() {
        List<Object> again = januaryRow(RAVI, Map.of(2, "B"));
        again.set(1, "");   // matched by name the second time
        Outcome o = run(sheet(januaryHeader(), List.of(januaryRow(RAVI, Map.of(1, "A")), again)));
        ImportProblem p = only(o, "DUPLICATE_ROW");
        assertThat(p.rowNo()).isEqualTo(4);
        assertThat(p.message()).isEqualTo("Ravi Kumar is also on row 3. Keep one row per person.");
        assertThat(o.members()).hasSize(1);
        assertThat(o.rows()).extracting(ImportRow::employeeId).containsExactly(RAVI.employeeId(), null);
    }

    // ── cells ────────────────────────────────────────────────────────────────

    @Test
    void shiftCodesAndWeeklyOffSpellingsInAnyCase() {
        Outcome o = run(one(RAVI, Map.of(1, "a", 2, " B ", 3, "c", 4, "w/o", 5, "OFF", 6, "wo", 7, "g")));
        assertThat(o.summary().errors()).isZero();
        List<String> cells = o.cells().get(0).cells();
        assertThat(cells.subList(0, 8)).containsExactly(A.id().toString(), B.id().toString(), C.id().toString(),
                RosterContract.WO, RosterContract.WO, RosterContract.WO, G.id().toString(), null);
        assertThat(o.cells().get(0).edited()).isEmpty();
        assertThat(o.rows().get(0).codes()).hasSize(31);
        assertThat(o.rows().get(0).codes().get(1)).isEqualTo("B");   // raw, trimmed
        assertThat(o.shiftIds()).containsExactly(A.id(), B.id(), C.id(), G.id());
    }

    @Test
    void anUnknownCodeIsAnErrorOnItsCell() {
        Outcome o = run(one(RAVI, Map.of(5, "X")));
        ImportProblem p = only(o, "UNKNOWN_CODE");
        assertThat(p.severity()).isEqualTo(Level.error);
        assertThat(p.rowNo()).isEqualTo(3);
        assertThat(p.column()).isEqualTo("J");   // day 5 = the fifth day column after A–E
        assertThat(p.date()).isEqualTo(jan(5));
        assertThat(p.message()).isEqualTo("Unknown code 'X' on 5 Jan. Use a shift code from the Codes sheet, or WO, PH, L or COFF.");
        assertThat(o.cells().get(0).cells().get(4)).isNull();
    }

    @Test
    void aDeletedShiftsCodeCantBeUsed() {
        Outcome o = run(one(RAVI, Map.of(5, "N")));
        assertThat(only(o, "UNKNOWN_CODE").message()).isEqualTo("Shift Old night (N) is no longer active, so 'N' on 5 Jan can't be used. Use another code.");
    }

    @Test
    void phWithAHolidayLeavesTheDayToTheHolidayAndWithoutOneWarnsOncePerDate() {
        PlanFacts f = facts(ImportFixture.everyone(), Map.of(jan(26), "Republic Day"), Map.of());
        List<List<Object>> rows = sheet(januaryHeader(), List.of(januaryRow(RAVI, Map.of(26, "PH", 27, "ph")),
                januaryRow(PRAVEEN, Map.of(26, "PH", 27, "PH"))));
        Outcome o = run(rows, technical(), f);

        assertThat(o.cells()).allSatisfy(r -> assertThat(r.cells().get(25)).isNull());
        ImportProblem p = only(o, "NO_HOLIDAY");
        assertThat(p.severity()).isEqualTo(Level.warning);
        assertThat(p.rowNo()).isNull();
        assertThat(p.date()).isEqualTo(jan(27));
        assertThat(p.message()).isEqualTo("No holiday on 27 Jan in Settings › Holidays (2 rows say PH). The day stays unplanned unless you add it.");
        assertThat(o.summary().errors()).isZero();
        assertThat(o.summary().warnings()).isEqualTo(1);
    }

    @Test
    void leaveAndCompOffNeedApprovedLeave() {
        Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave = new HashMap<>();
        leave.put(RAVI.employeeId(), Map.of(jan(12), ImportFixture.leave(false), jan(20), ImportFixture.compOff()));
        PlanFacts f = facts(ImportFixture.everyone(), Map.of(), leave);
        Outcome o = run(one(RAVI, Map.of(12, "L", 13, "l", 14, "L", 20, "co", 21, "C-OFF", 22, "COFF")), technical(), f);

        assertThat(o.cells().get(0).cells()).allMatch(java.util.Objects::isNull);
        ImportProblem p = only(o, "NO_LEAVE");
        assertThat(p.severity()).isEqualTo(Level.warning);
        assertThat(p.date()).isEqualTo(jan(13));
        assertThat(p.column()).isEqualTo("R");
        assertThat(p.message()).isEqualTo("No approved leave for Ravi Kumar on 13–14 Jan and 21–22 Jan. Those days stay unplanned.");
    }

    @Test
    void aShiftOnADayOfApprovedLeaveIsKeptWithAnInfo() {
        Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave = Map.of(RAVI.employeeId(), Map.of(jan(8), ImportFixture.leave(true)));
        Outcome o = run(one(RAVI, Map.of(8, "A")), technical(), facts(ImportFixture.everyone(), Map.of(), leave));
        assertThat(o.cells().get(0).cells().get(7)).isEqualTo(A.id().toString());
        ImportProblem p = only(o, "SHIFT_ON_LEAVE");
        assertThat(p.severity()).isEqualTo(Level.info);
        assertThat(p.message()).isEqualTo("Ravi Kumar has approved leave on 8 Jan; the shift is kept and the leave shows on top.");
    }

    @Test
    void aShiftOrWeeklyOffBeforeJoiningOrAfterTheLastWorkingDayIsE4() {
        PlannerPerson ravi = ImportFixture.withDates(RAVI, jan(10), jan(20));
        List<PlannerPerson> people = new ArrayList<>(ImportFixture.everyone());
        people.set(0, ravi);
        Outcome o = run(one(ravi, Map.of(5, "A", 9, "WO", 10, "B", 20, "C", 25, "B", 26, "PH")), technical(), facts(people), people);

        List<ImportProblem> e4 = o.problems().stream().filter(p -> p.code().equals("E4")).toList();
        assertThat(e4).extracting(ImportProblem::message).containsExactly(
                "Ravi Kumar joins on 10 Jan; clear 5 Jan and 9 Jan.",
                "Ravi Kumar's last working day is 20 Jan; clear 25 Jan.");
        assertThat(e4).extracting(ImportProblem::date).containsExactly(jan(5), jan(25));
        assertThat(e4).allMatch(p -> p.severity() == Level.error);
        List<String> cells = o.cells().get(0).cells();
        assertThat(cells.get(4)).isNull();
        assertThat(cells.get(8)).isNull();
        assertThat(cells.get(9)).isEqualTo(B.id().toString());
        assertThat(cells.get(19)).isEqualTo(C.id().toString());
        assertThat(cells.get(24)).isNull();
    }

    @Test
    void aCodeOnADayThatIsNotInThePeriodIsAnError() {
        LocalDate nov1 = LocalDate.of(2026, 11, 1), nov30 = LocalDate.of(2026, 11, 30);
        Target november = new Target(ImportFixture.COMPANY, nov1, nov30, TECHNICAL, "Technical", null, null, true, Set.of());
        List<Object> row = januaryRow(RAVI, Map.of(30, "A", 31, "B"));
        Outcome o = run(sheet(januaryHeader(), List.of(row)), november, facts(ImportFixture.everyone()));
        ImportProblem p = only(o, "DAY_OUTSIDE_PERIOD");
        assertThat(p.severity()).isEqualTo(Level.error);
        assertThat(p.rowNo()).isEqualTo(3);
        assertThat(p.column()).isEqualTo("AJ");
        assertThat(p.message()).isEqualTo("Day 31 isn't in the period (November 2026); leave column AJ empty.");
        assertThat(o.cells().get(0).cells()).hasSize(30);
        assertThat(o.cells().get(0).cells().get(29)).isEqualTo(A.id().toString());
    }

    @Test
    void aShiftWhoseCodeIsAReservedWordWarnsOnceAndTheCodeMeansLeave() {
        PlanFacts.Shift late = ImportFixture.shift("L", "Late", "12:00", "20:00", "FIXED", true);
        Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave = Map.of(RAVI.employeeId(), Map.of(jan(3), ImportFixture.leave(false), jan(4), ImportFixture.leave(false)));
        Outcome o = run(one(RAVI, Map.of(3, "L", 4, "L")), technical(), facts(ImportFixture.everyone(), Map.of(), leave, late));
        ImportProblem p = only(o, "RESERVED_SHIFT_CODE");
        assertThat(p.severity()).isEqualTo(Level.warning);
        assertThat(p.message()).isEqualTo("Shift Late (L) has the code L, which the import reads as leave. Give the shift another code in Shift Schedules to import it.");
        assertThat(o.cells().get(0).cells()).allMatch(java.util.Objects::isNull);
    }

    @Test
    void twoActiveShiftsWithOneCodeIsAnError() {
        PlanFacts.Shift early = new PlanFacts.Shift(UUID.randomUUID(), ImportFixture.COMPANY, "a", "Early", java.time.LocalTime.of(5, 0),
                java.time.LocalTime.of(13, 0), "FIXED", true);
        Outcome o = run(one(RAVI, Map.of(1, "A", 2, "A")), technical(), facts(ImportFixture.everyone(), Map.of(), Map.of(), early));
        assertThat(only(o, "AMBIGUOUS_SHIFT_CODE").message()).startsWith("2 shifts use the code A (");
        assertThat(o.summary().errors()).isEqualTo(1);
    }

    @Test
    void aDifferentDepartmentDesignationOrBuildingInTheSheetIsAnInfo() {
        List<Object> row = januaryRow(RAVI, Map.of(1, "A"));
        row.set(2, "HVAC");
        row.set(3, "hvac technician");   // the same, in another case
        row.set(4, "Building 9");
        Outcome o = run(sheet(januaryHeader(), List.of(row)));
        assertThat(only(o, "RECORD_DIFFERS").message()).isEqualTo("For Ravi Kumar the sheet has a different department 'HVAC' "
                + "(the record says 'Technical') and building 'Building 9' (the record says 'Building 1'). The employee record is used; "
                + "the import never changes employee records.");
    }

    @Test
    void totalsThatDifferFromTheCodesAreAnInfo() {
        List<Object> row = januaryRow(RAVI, Map.of(1, "A", 2, "B", 3, "WO"));
        row.addAll(List.of(5, 1, 0, 0, 0));
        Outcome o = run(sheet(januaryHeader(), List.of(row)));
        ImportProblem p = only(o, "TOTALS_DIFFER");
        assertThat(p.severity()).isEqualTo(Level.info);
        assertThat(p.column()).isEqualTo("AK");
        assertThat(p.message()).isEqualTo("This row's totals differ from its codes (Working days: the sheet says 5, the codes give 2). "
                + "Totals are worked out from the codes.");
    }

    @Test
    void aFileWithNoPeopleIsAnError() {
        Outcome o = run(sheet(januaryHeader(), List.of()));
        assertThat(only(o, "NO_ROWS").severity()).isEqualTo(Level.error);
        assertThat(o.summary().rows()).isZero();
    }

    @Test
    void problemsOfTheFileItselfAreIncluded() {
        List<Object> header = new ArrayList<>(januaryHeader());
        header.add("1 Jan");
        Outcome o = run(sheet(header, List.of(januaryRow(RAVI, Map.of(1, "A")))));
        assertThat(only(o, "DAY_COLUMN_TWICE").severity()).isEqualTo(Level.error);
    }

    @Test
    void membersCellsAndDesignationsFollowTheSheetOrder() {
        List<List<Object>> rows = sheet(januaryHeader(), List.of(januaryRow(SHIVA, Map.of(1, "C")), januaryRow(KIRAN, Map.of(1, "G")),
                januaryRow(RAVI, Map.of(1, "A"))));
        Outcome o = run(rows);
        assertThat(o.members()).extracting(RosterContract.MemberIn::employeeId)
                .containsExactly(SHIVA.employeeId(), KIRAN.employeeId(), RAVI.employeeId());
        assertThat(o.members()).allMatch(m -> m.rotationOffset() == 0);
        assertThat(o.designationIds()).containsExactly(ImportFixture.ELECTRICIAN.toString(), "", ImportFixture.HVAC.toString());
        assertThat(o.shiftIds()).containsExactly(A.id(), C.id(), G.id());
        assertThat(o.summary()).isEqualTo(new RosterContract.ImportSummary(3, 3, 0, 0));
    }

    @Test
    void theListOfProblemsIsCappedErrorsFirstButAllAreCounted() {
        List<List<Object>> people = new ArrayList<>();
        Map<Integer, String> bad = new HashMap<>();
        for (int d = 1; d <= 31; d++) bad.put(d, "X");
        for (int i = 0; i < 40; i++) {
            List<Object> row = januaryRow(RAVI, bad);
            row.set(0, "Person " + i);
            row.set(1, "");
            people.add(row);
        }
        Outcome o = run(sheet(januaryHeader(), people));
        int total = 40 * 31 + 40;   // every cell unknown, and nobody found
        assertThat(o.problems()).hasSize(total);
        assertThat(o.summary().errors()).isEqualTo(total);
        List<ImportProblem> listed = o.listed();
        assertThat(listed).hasSize(RosterSheetLayout.MAX_PROBLEMS_LISTED);
        assertThat(listed.get(listed.size() - 1).code()).isEqualTo("MORE_PROBLEMS");
        assertThat(listed.get(listed.size() - 1).message()).startsWith("Showing 999 of " + total + " problems.");
    }

    @Test
    void theSyntheticS13SampleImportsWithoutProblems() throws IOException {
        byte[] bytes;
        try (InputStream in = getClass().getResourceAsStream("/roster-import/s13-january-2027-sample.csv")) {
            bytes = in.readAllBytes();
        }
        List<PlannerPerson> people = List.of(RAVI, PRAVEEN, SHIVA, ANITHA,
                ImportFixture.withDesignation(KIRAN, ImportFixture.SUPERVISOR, "Supervisor"),
                ImportFixture.withDesignation(LAKSHMI, ImportFixture.SUPERVISOR, "Supervisor"));
        Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave = Map.of(RAVI.employeeId(), Map.of(jan(12), ImportFixture.leave(false)),
                ANITHA.employeeId(), Map.of(jan(20), ImportFixture.compOff()));
        PlanFacts f = facts(people, Map.of(jan(26), "Republic Day"), leave);
        Target t = technical();
        ParsedSheet s = RosterSheetParser.parse("s13-january-2027-sample.csv", bytes, t.start(), t.end());
        Outcome o = RosterImportCheck.cells(s, RosterImportCheck.match(s, people, t), f, t);

        assertThat(o.problems()).isEmpty();
        assertThat(o.summary()).isEqualTo(new RosterContract.ImportSummary(6, 6, 0, 0));
        assertThat(o.rows()).extracting(ImportRow::matchedBy).containsOnly(MatchedBy.CODE);
        // Ravi: A A B B C C WO …, leave on 12 Jan and the holiday on 26 Jan stay empty.
        List<String> ravi = o.cells().get(0).cells();
        assertThat(ravi.get(0)).isEqualTo(A.id().toString());
        assertThat(ravi.get(6)).isEqualTo(RosterContract.WO);
        assertThat(ravi.get(11)).isNull();
        assertThat(ravi.get(25)).isNull();
        assertThat(o.cells().get(4).cells().get(1)).isEqualTo(RosterContract.WO);   // Kiran: Saturday 2 Jan
        assertThat(o.cells().get(4).cells().get(0)).isEqualTo(G.id().toString());
    }
}
