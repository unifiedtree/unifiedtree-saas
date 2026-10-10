package com.hrms.api.roster.plan;

import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PlanCell;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PlanRow;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.RowTotals;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.core.exception.HrmsException;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.hrms.api.roster.plan.PlanFixture.*;
import static org.junit.jupiter.api.Assertions.*;

/** Generate and regenerate (design §1.3) through {@link RosterPlanner#plan}, with the design's own examples. */
class RosterPlannerTest {

    private static final LocalDate OCT1 = LocalDate.of(2026, 10, 1);   // a Thursday
    private static final LocalDate OCT31 = LocalDate.of(2026, 10, 31);

    private final PlanFixture fx = new PlanFixture();

    private List<UUID> technicians(int n) {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < n; i++) ids.add(fx.person("Tech " + (char) ('A' + i), TECH));
        return ids;
    }

    @Test
    void fourPeopleOnAABBCCWOStartOnDays0135AndDayOneIsAABC() {
        List<UUID> ids = technicians(4);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                fresh(ids.toArray(UUID[]::new)), List.of()), fx.facts());
        assertEquals(List.of(0, 1, 3, 5), out.members().stream().map(MemberIn::rotationOffset).toList());
        assertEquals(List.of("A", "A", "B", "C"), column(out, 0));
        assertEquals(List.of(0, 1, 3, 5), out.rows().stream().map(PlanRow::rotationOffset).toList());
        assertEquals("A A B B C C WO A A B B C C WO A A B B C C WO A A B B C C WO A A B", codes(out.rows().get(0)));
    }

    @Test
    void sevenPeopleGiveTwoATwoBTwoCAndOneWeeklyOffEveryDay() {
        List<UUID> ids = technicians(7);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                fresh(ids.toArray(UUID[]::new)), List.of()), fx.facts());
        assertEquals(List.of(0, 1, 2, 3, 4, 5, 6), out.members().stream().map(MemberIn::rotationOffset).toList());
        for (int i = 0; i < 31; i++) {
            List<String> col = column(out, i);
            assertEquals(2, Collections.frequency(col, "A"), "day " + i);
            assertEquals(2, Collections.frequency(col, "B"), "day " + i);
            assertEquals(2, Collections.frequency(col, "C"), "day " + i);
            assertEquals(1, Collections.frequency(col, "WO"), "day " + i);
        }
    }

    @Test
    void twoTwoTwoOneVariantsKeepEveryDayBalanced() {
        // 2+2+2+2 (eight days, two off), and the order shifted (B B C C A A WO).
        for (String p : List.of("A A B B C C WO WO", "B B C C A A WO", "A A A B B B C C C WO WO")) {
            PlanFixture f = new PlanFixture();
            int n = p.split(" ").length;
            List<UUID> ids = new ArrayList<>();
            for (int i = 0; i < n; i++) ids.add(f.person("P" + i, TECH));
            PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                    config(f.pattern(p), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD), fresh(ids.toArray(UUID[]::new)),
                    List.of()), f.facts());
            long offs = p.chars().filter(ch -> ch == 'W').count();
            for (int i = 0; i < 31; i++) {
                assertEquals(offs, Collections.frequency(column(out, i), "WO"), p + " day " + i);
            }
        }
    }

    @Test
    void startDaysAreSpreadWithinEachDesignation() {
        UUID t1 = fx.person("T1", TECH), h1 = fx.person("H1", HELPER), t2 = fx.person("T2", TECH),
                h2 = fx.person("H2", HELPER), none = fx.person("Nobody", null);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                fresh(t1, h1, t2, h2, none), List.of()), fx.facts());
        assertEquals(List.of(0, 0, 3, 3, 0), out.members().stream().map(MemberIn::rotationOffset).toList(),
                "two technicians 0 and 3, two helpers 0 and 3, no designation alone 0");
    }

    @Test
    void sameStartGivesEveryoneDayOne() {
        List<UUID> ids = technicians(3);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME),
                fresh(ids.toArray(UUID[]::new)), List.of()), fx.facts());
        assertEquals(List.of("A", "A", "A"), column(out, 0));
    }

    @Test
    void aChangedPatternRegeneratesAndKeepsEditedCells() {
        List<UUID> ids = technicians(4);
        PlanRequest first = generate(OCT1, OCT31, config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL,
                StaggerMode.SPREAD), fresh(ids.toArray(UUID[]::new)), List.of());
        PlanResponse out = RosterPlanner.plan(first, fx.facts());
        // HR edits two cells of the first person: day 2 to G, day 5 cleared.
        List<RowIn> rows = new ArrayList<>(rowsOf(out));
        RowIn r0 = rows.get(0);
        List<String> cells = new ArrayList<>(r0.cells());
        cells.set(2, fx.token("G"));
        cells.set(5, null);
        rows.set(0, new RowIn(r0.employeeId(), cells, List.of(2, 5)));

        PlanResponse again = RosterPlanner.plan(request(OCT1, OCT31, config(fx.pattern("A A A B B C C WO"),
                WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD), out.members(), List.of(), rows, true, true), fx.facts());
        PlanRow row = again.rows().get(0);
        assertEquals("G", row.cells().get(2).code());
        assertTrue(row.cells().get(2).edited());
        assertNull(row.cells().get(5).token());
        assertTrue(row.cells().get(5).edited());
        assertTrue(codes(row).startsWith("A A G B B - C WO A A A B"), "the rest follows the new 8-day pattern: " + codes(row));
        assertEquals(List.of(0, 1, 3, 5), again.members().stream().map(MemberIn::rotationOffset).toList(),
                "start days stay as they were");

        PlanResponse reset = RosterPlanner.plan(request(OCT1, OCT31, config(fx.pattern("A A A B B C C WO"),
                WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD), out.members(), List.of(), rows, true, false), fx.facts());
        assertTrue(codes(reset.rows().get(0)).startsWith("A A A B B C C WO A A A"), "Reset my edits lays the pattern again");
        assertFalse(reset.rows().get(0).cells().get(2).edited());
    }

    @Test
    void withoutRegenerateTheCellsAreTakenAsSent() {
        UUID p = fx.person("Ravi", TECH);
        RowIn row = fx.rowOf(p, "A B - WO C", 1);
        PlanResponse out = RosterPlanner.plan(request(OCT1, OCT1.plusDays(4),
                config(fx.pattern("G"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                List.of(new MemberIn(p, 3)), List.of(), List.of(row), false, false), fx.facts());
        assertEquals("A B - WO C", codes(out.rows().get(0)));
        assertTrue(out.rows().get(0).cells().get(1).edited());
        assertFalse(out.rows().get(0).cells().get(0).edited());
        assertEquals(0, out.members().get(0).rotationOffset(), "3 mod a one-day pattern");
    }

    @Test
    void aPersonAddedLaterGetsAStartDayAndOthersKeepTheirs() {
        List<UUID> ids = technicians(2);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                fresh(ids.toArray(UUID[]::new)), List.of()), fx.facts());
        assertEquals(List.of(0, 3), out.members().stream().map(MemberIn::rotationOffset).toList());
        UUID late = fx.person("Late joiner", TECH);
        List<MemberIn> members = new ArrayList<>(out.members());
        members.add(new MemberIn(late, 0));   // no row yet: the web sends 0 or -1, both mean "choose"
        PlanResponse again = RosterPlanner.plan(request(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                members, List.of(), rowsOf(out), true, true), fx.facts());
        assertEquals(List.of(0, 3, 4), again.members().stream().map(MemberIn::rotationOffset).toList(),
                "the newcomer is the 3rd of 3 technicians: floor(2 × 7 / 3) = 4");
        assertEquals(codes(out.rows().get(0)), codes(again.rows().get(0)));
    }

    @Test
    void hrCanMoveOnePersonsStartDay() {
        List<UUID> ids = technicians(2);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                fresh(ids.toArray(UUID[]::new)), List.of()), fx.facts());
        // "Start this person on pattern day 3" = offset 2.
        PlanResponse moved = RosterPlanner.plan(request(OCT1, OCT31,
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD),
                members(ids, 0, 2), List.of(), rowsOf(out), true, true), fx.facts());
        assertEquals(codes(out.rows().get(0)), codes(moved.rows().get(0)), "the other row is unchanged");
        assertEquals("B", moved.rows().get(1).cells().get(0).code());
    }

    @Test
    void fixedModeKeepsTheUsualWeeklyOffsAndLinesUpWithTheWeek() {
        UUID p = fx.person("Ravi", TECH);
        LocalDate mon = LocalDate.of(2026, 10, 5), fri = LocalDate.of(2026, 10, 30);
        fx.weeklyOffs(p, mon.minusDays(1), fri, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY);
        PlanResponse out = RosterPlanner.plan(generate(mon, fri,
                config(fx.pattern("A A A A A B B B B B"), WeeklyOffMode.FIXED, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        assertEquals("A A A A A WO WO B B B B B WO WO A A A A A WO WO B B B B B", codes(out.rows().get(0)));
        assertEquals(new RowTotals(20, 6, 0, 0, 0), out.rows().get(0).totals());
    }

    @Test
    void customModeLeavesWeeklyOffsToHrAndFlagsThemUntilPicked() {
        UUID p = fx.person("Shiva", TECH);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT1.plusDays(13),
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.CUSTOM, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        assertEquals("A A B B C C - A A B B C C -", codes(out.rows().get(0)));
        assertTrue(out.checks().warnings().stream().anyMatch(i -> i.id() == RosterContract.IssueId.W2), "no weekly off");
        assertTrue(out.checks().warnings().stream().anyMatch(i -> i.id() == RosterContract.IssueId.W1), "two days to pick");
        // HR picks the two weekly offs: both warnings go.
        List<RowIn> rows = rowsOf(out);
        List<String> cells = new ArrayList<>(rows.get(0).cells());
        cells.set(6, RosterContract.WO);
        cells.set(13, RosterContract.WO);
        PlanResponse picked = RosterPlanner.plan(request(OCT1, OCT1.plusDays(13),
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.CUSTOM, StaggerMode.SAME), out.members(), List.of(),
                List.of(new RowIn(p, cells, List.of(6, 13))), false, false), fx.facts());
        assertTrue(picked.checks().warnings().stream().noneMatch(i -> i.id() == RosterContract.IssueId.W2
                || i.id() == RosterContract.IssueId.W1), picked.checks().warnings().toString());
    }

    @Test
    void notRepeatingLeavesTheDaysAfterTheCycleEmpty() {
        UUID p = fx.person("Ravi", TECH);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT1.plusDays(6),
                config(fx.pattern("A B WO"), false, WeeklyOffMode.ROTATIONAL, StaggerMode.SAME, null, List.of()),
                fresh(p), List.of()), fx.facts());
        assertEquals("A B WO - - - -", codes(out.rows().get(0)));
        assertEquals(4, out.rows().get(0).totals().unplanned());
    }

    @Test
    void daysBeforeJoiningAndAfterLeavingStayEmpty() {
        UUID joiner = fx.person("Joiner", TECH, DEPT, null, LocalDate.of(2026, 10, 5), null);
        UUID leaver = fx.person("Leaver", TECH, DEPT, null, null, LocalDate.of(2026, 10, 28));
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31,
                config(fx.pattern("A"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(joiner, leaver), List.of()), fx.facts());
        PlanRow j = out.rows().get(0), l = out.rows().get(1);
        for (int i = 0; i < 4; i++) {
            assertNull(j.cells().get(i).token());
            assertTrue(j.cells().get(i).outside());
        }
        assertEquals("A", j.cells().get(4).code());
        assertFalse(j.cells().get(4).outside());
        for (int i = 28; i < 31; i++) assertTrue(l.cells().get(i).outside() && l.cells().get(i).token() == null);
        assertEquals("A", l.cells().get(27).code());
        assertEquals(27, j.totals().working());
        assertEquals(28, l.totals().working());
        assertTrue(out.checks().errors().isEmpty(), "generated cells never fall outside employment");
    }

    @Test
    void holidaysAndLeaveNeverChangeACellTheyShowOnTop() {
        UUID p = fx.person("Ravi", TECH);
        fx.holiday(LocalDate.of(2026, 10, 2), "Gandhi Jayanti");
        fx.leave(p, LocalDate.of(2026, 10, 5), OverlayType.L, "Casual leave", false);
        fx.leave(p, LocalDate.of(2026, 10, 6), OverlayType.COFF, "Comp off", false);
        fx.leave(p, LocalDate.of(2026, 10, 7), OverlayType.L, "Sick leave", true);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT1.plusDays(9),
                config(fx.pattern("A"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        PlanRow row = out.rows().get(0);
        assertEquals("A A A A A A A A A A", codes(row), "the planned shift stands under the overlay");
        assertEquals(new RosterContract.Overlay(OverlayType.PH, "Gandhi Jayanti", false), row.cells().get(1).overlay());
        assertEquals(OverlayType.L, row.cells().get(4).overlay().type());
        assertEquals(OverlayType.COFF, row.cells().get(5).overlay().type());
        assertTrue(row.cells().get(6).overlay().halfDay());
        assertEquals("Gandhi Jayanti", out.days().get(1).holidayName());
        assertEquals(5, out.days().get(1).weekday(), "2 Oct 2026 is a Friday");
        // Totals: a holiday, two full days of leave, the half day counts as working.
        assertEquals(new RowTotals(7, 0, 1, 2, 0), row.totals());
    }

    @Test
    void holidayBeatsLeaveOnTheSameDay() {
        UUID p = fx.person("Ravi", TECH);
        fx.holiday(OCT1, "Founders day");
        fx.leave(p, OCT1, OverlayType.L, "Casual leave", false);
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT1,
                config(fx.pattern("A"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        assertEquals(OverlayType.PH, out.rows().get(0).cells().get(0).overlay().type());
    }

    @Test
    void cellsShowShiftCodesOrTheNamesInitials() {
        PlanFacts.Shift noCode = new PlanFacts.Shift(UUID.randomUUID(), COMPANY, null, "Split shift", null, null, "FIXED", true);
        fx.put(noCode);
        UUID p = fx.person("Ravi", TECH);
        RowIn row = new RowIn(p, java.util.Arrays.asList(noCode.id().toString(), "wo", UUID.randomUUID().toString(), "", null),
                List.of());
        PlanResponse out = RosterPlanner.plan(request(OCT1, OCT1.plusDays(4), null, List.of(new MemberIn(p, 0)), List.of(),
                List.of(row), false, false), fx.facts());
        assertEquals("SS WO ? - -", codes(out.rows().get(0)), "initials, any-case WO, an unknown shift, blank = empty");
        assertEquals(RosterContract.WO, out.rows().get(0).cells().get(1).token());
    }

    @Test
    void theDaysCarryWeekdaysAcrossALeapFebruary() {
        UUID p = fx.person("Ravi", TECH);
        LocalDate feb1 = LocalDate.of(2028, 2, 1), feb29 = LocalDate.of(2028, 2, 29);
        PlanResponse out = RosterPlanner.plan(generate(feb1, feb29,
                config(fx.pattern("A B WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        assertEquals(29, out.days().size());
        assertEquals(feb29, out.days().get(28).date());
        assertEquals(2, out.days().get(28).weekday(), "29 Feb 2028 is a Tuesday");
        assertEquals("B", out.rows().get(0).cells().get(28).code(), "28 mod 3 = 1 → B");
    }

    @Test
    void aOneDayAndASixtyTwoDayRosterAreFine() {
        UUID p = fx.person("Ravi", TECH);
        PlanResponse one = RosterPlanner.plan(generate(OCT31, OCT31,
                config(fx.pattern("A"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        assertEquals(1, one.rows().get(0).cells().size());
        PlanResponse long62 = RosterPlanner.plan(generate(OCT1, OCT1.plusDays(61),
                config(fx.pattern("A"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(p), List.of()), fx.facts());
        assertEquals(62, long62.days().size());
    }

    @Test
    void badPeriodsAreRefused() {
        UUID p = fx.person("Ravi", TECH);
        for (LocalDate[] range : new LocalDate[][]{{OCT1, OCT1.plusDays(62)}, {OCT31, OCT1}, {null, OCT31}, {OCT1, null}}) {
            HrmsException e = assertThrows(HrmsException.class, () -> RosterPlanner.plan(generate(range[0], range[1],
                    config(fx.pattern("A"), WeeklyOffMode.ROTATIONAL, StaggerMode.SAME), fresh(p), List.of()), fx.facts()));
            assertEquals("ROSTER_RANGE_INVALID", e.getErrorCode());
            assertEquals(400, e.getStatus().value());
        }
        assertThrows(IllegalArgumentException.class, () -> RosterPlanner.plan(null, fx.facts()));
    }

    @Test
    void anEmptyRequestGivesAnEmptyPlan() {
        PlanResponse out = RosterPlanner.plan(new PlanRequest(OCT1, OCT31, null, null, null, null, null, null, null, true, true),
                null);
        assertEquals(31, out.days().size());
        assertTrue(out.rows().isEmpty() && out.coverage().isEmpty() && out.members().isEmpty());
        assertTrue(out.checks().errors().isEmpty() && out.checks().warnings().isEmpty());
        assertEquals("All employees assigned", out.checks().summary().stream()
                .filter(s -> s.id() == RosterContract.IssueId.W1).findFirst().orElseThrow().label());
    }

    @Test
    void duplicateMembersAndRowsAreTakenOnce() {
        UUID p = fx.person("Ravi", TECH);
        PlanResponse out = RosterPlanner.plan(request(OCT1, OCT1.plusDays(1), null,
                List.of(new MemberIn(p, 0), new MemberIn(p, 4)), List.of(),
                List.of(fx.rowOf(p, "A A"), fx.rowOf(p, "B B")), false, false), fx.facts());
        assertEquals(1, out.rows().size());
        assertEquals("A A", codes(out.rows().get(0)));
    }

    @Test
    void theSameInputAlwaysGivesTheSameAnswer() {
        List<UUID> ids = technicians(5);
        fx.holiday(LocalDate.of(2026, 10, 2), "Gandhi Jayanti");
        PlanRequest in = generate(OCT1, OCT31, config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL,
                StaggerMode.SPREAD), fresh(ids.toArray(UUID[]::new)), List.of(new StaffingIn(TECH, fx.id("C"), 2)));
        assertEquals(RosterPlanner.plan(in, fx.facts()), RosterPlanner.plan(in, fx.facts()));
    }

    @Test
    void threeHundredPeopleOverSixtyTwoDaysTakeLessThan200Ms() {
        PlanFixture big = new PlanFixture();
        List<UUID> designations = List.of(TECH, HELPER, UUID.randomUUID(), UUID.randomUUID());
        List<MemberIn> members = new ArrayList<>();
        for (int i = 0; i < 300; i++) {
            UUID id = big.person("Person " + i, designations.get(i % 4));
            members.add(new MemberIn(id, -1));
            if (i % 10 == 0) big.leave(id, OCT1.plusDays(i % 60), OverlayType.L, "Casual leave", i % 20 == 0);
        }
        big.holiday(LocalDate.of(2026, 10, 2), "Gandhi Jayanti");
        List<StaffingIn> staffing = new ArrayList<>();
        for (UUID d : designations) for (String c : List.of("A", "B", "C")) staffing.add(new StaffingIn(d, big.id(c), 20));
        PlanRequest in = generate(OCT1, OCT1.plusDays(61), config(big.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL,
                StaggerMode.SPREAD), members, staffing);
        PlanFacts facts = big.facts();
        RosterPlanner.plan(in, facts);   // warm up
        long best = Long.MAX_VALUE;
        PlanResponse out = null;
        for (int run = 0; run < 3; run++) {
            long t0 = System.nanoTime();
            out = RosterPlanner.plan(in, facts);
            best = Math.min(best, (System.nanoTime() - t0) / 1_000_000);
        }
        assertEquals(300, out.rows().size());
        assertEquals(62, out.rows().get(0).cells().size());
        assertTrue(best < 200, "took " + best + " ms");
    }

    @Test
    void everyCellIssueIdNamesAnIssueInTheResponse() {
        List<UUID> ids = technicians(3);
        UUID gone = UUID.randomUUID();
        fx.minRest = 600;
        PlanResponse out = RosterPlanner.plan(generate(OCT1, OCT31, config(fx.pattern("C A WO"), WeeklyOffMode.CUSTOM,
                StaggerMode.SPREAD), fresh(ids.get(0), ids.get(1), ids.get(2), gone), List.of(new StaffingIn(TECH, fx.id("A"), 3))),
                fx.facts());
        Map<String, RosterContract.Issue> byKey = new HashMap<>();
        for (List<RosterContract.Issue> list : List.of(out.checks().errors(), out.checks().warnings(), out.checks().infos())) {
            for (RosterContract.Issue i : list) assertNull(byKey.put(i.key(), i), "keys are unique: " + i.key());
        }
        int referenced = 0;
        for (PlanRow r : out.rows()) {
            for (PlanCell c : r.cells()) {
                for (String k : c.issueIds()) {
                    assertTrue(byKey.containsKey(k), k);
                    RosterContract.Issue issue = byKey.get(k);
                    assertTrue(issue.employeeId() == null || issue.employeeId().equals(r.employeeId()), k);
                    referenced++;
                }
            }
        }
        assertTrue(referenced > 0);
    }
}
