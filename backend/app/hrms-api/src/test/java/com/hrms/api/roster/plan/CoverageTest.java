package com.hrms.api.roster.plan;

import com.hrms.api.roster.RosterContract.CoverageDay;
import com.hrms.api.roster.RosterContract.CoverageRow;
import com.hrms.api.roster.RosterContract.CoverageStatus;
import com.hrms.api.roster.RosterContract.Issue;
import com.hrms.api.roster.RosterContract.IssueId;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static com.hrms.api.roster.plan.PlanFixture.*;
import static org.junit.jupiter.api.Assertions.*;

/** Coverage per date × shift × designation, and the coverage checks W3, W5 and I2 (design §1.3, §1.4). */
class CoverageTest {

    private static final LocalDate OCT1 = LocalDate.of(2026, 10, 1);

    private final PlanFixture fx = new PlanFixture();

    private PlanResponse plan(List<UUID> people, List<RowIn> rows, List<StaffingIn> staffing, List<UUID> ticked, int days) {
        List<MemberIn> members = new ArrayList<>();
        for (UUID p : people) members.add(new MemberIn(p, 0));
        return RosterPlanner.plan(request(OCT1, OCT1.plusDays(days - 1),
                config(List.of(), true, WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD, null, ticked),
                members, staffing, rows, false, false), fx.facts());
    }

    private static CoverageRow row(PlanResponse out, UUID shift, UUID designation) {
        return out.coverage().stream()
                .filter(r -> r.shiftPolicyId().equals(shift) && java.util.Objects.equals(r.designationId(), designation))
                .findFirst().orElseThrow(() -> new AssertionError("no coverage row " + shift + " / " + designation));
    }

    @Test
    void sevenPeopleOnAABBCCWOMeetARequirementOfTwoNightsUntilItBecomesThree() {
        List<MemberIn> fresh = new ArrayList<>();
        for (int i = 0; i < 7; i++) fresh.add(new MemberIn(fx.person("T" + i, TECH), -1));
        UUID night = fx.id("C");
        PlanResponse two = RosterPlanner.plan(generate(OCT1, OCT1.plusDays(30),
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD), fresh,
                List.of(new StaffingIn(TECH, night, 2))), fx.facts());
        assertTrue(row(two, night, TECH).perDay().stream().allMatch(d -> d.status() == CoverageStatus.OK && d.scheduled() == 2));
        assertTrue(two.checks().warnings().stream().noneMatch(i -> i.id() == IssueId.W3));

        PlanResponse three = RosterPlanner.plan(request(OCT1, OCT1.plusDays(30),
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD), two.members(),
                List.of(new StaffingIn(TECH, night, 3)), rowsOf(two), false, false), fx.facts());
        CoverageRow r = row(three, night, TECH);
        assertTrue(r.perDay().stream().allMatch(d -> d.status() == CoverageStatus.SHORT && d.required() == 3));
        Issue w3 = three.checks().warnings().stream().filter(i -> i.id() == IssueId.W3).findFirst().orElseThrow();
        assertEquals(night, w3.shiftPolicyId());
        assertEquals(TECH, w3.designationId());
        assertEquals(31, w3.dates().size());
        assertTrue(w3.message().startsWith("Night (C): Technician 2 of 3 on 31 dates"), w3.message());
        CoverageRow total = row(three, night, null);
        assertEquals(new CoverageDay(3, 2, CoverageStatus.SHORT), total.perDay().get(0));
    }

    @Test
    void fullDayLeaveIsTakenOffTheCountHalfDayIsNot() {
        UUID a = fx.person("A1", TECH), b = fx.person("A2", TECH), c = fx.person("A3", TECH);
        fx.leave(a, OCT1, OverlayType.L, "Casual leave", false);
        fx.leave(b, OCT1, OverlayType.L, "Casual leave", true);
        fx.leave(c, OCT1.plusDays(1), OverlayType.COFF, "Comp off", false);
        List<RowIn> rows = List.of(fx.rowOf(a, "A A"), fx.rowOf(b, "A A"), fx.rowOf(c, "A A"));
        PlanResponse out = plan(List.of(a, b, c), rows, List.of(new StaffingIn(TECH, fx.id("A"), 3)), List.of(fx.id("A")), 2);
        CoverageRow r = row(out, fx.id("A"), TECH);
        assertEquals(new CoverageDay(3, 2, CoverageStatus.SHORT), r.perDay().get(0), "A1 on full-day leave, A2's half day counts");
        assertEquals(new CoverageDay(3, 2, CoverageStatus.SHORT), r.perDay().get(1), "A3 on comp off");
    }

    @Test
    void holidayColumnsAreNotChecked() {
        UUID a = fx.person("A1", TECH);
        fx.holiday(OCT1, "Gandhi Jayanti");
        PlanResponse out = plan(List.of(a), List.of(fx.rowOf(a, "- A")), List.of(new StaffingIn(TECH, fx.id("A"), 2)),
                List.of(fx.id("A")), 2);
        CoverageRow r = row(out, fx.id("A"), TECH);
        assertEquals(CoverageStatus.HOLIDAY, r.perDay().get(0).status());
        assertEquals(CoverageStatus.SHORT, r.perDay().get(1).status());
        assertEquals(CoverageStatus.HOLIDAY, row(out, fx.id("A"), null).perDay().get(0).status());
        Issue w3 = out.checks().warnings().stream().filter(i -> i.id() == IssueId.W3).findFirst().orElseThrow();
        assertEquals(List.of(OCT1.plusDays(1)), w3.dates());
    }

    @Test
    void aRequirementWithNobodyOfThatDesignationIsAStaffingGap() {
        UUID a = fx.person("A1", TECH);
        PlanResponse out = plan(List.of(a), List.of(fx.rowOf(a, "A A A")),
                List.of(new StaffingIn(HELPER, fx.id("B"), 1)), List.of(fx.id("A"), fx.id("B")), 3);
        CoverageRow helpers = row(out, fx.id("B"), HELPER);
        assertTrue(helpers.perDay().stream().allMatch(d -> d.scheduled() == 0 && d.status() == CoverageStatus.SHORT));
        Issue w3 = out.checks().warnings().stream().filter(i -> i.id() == IssueId.W3).findFirst().orElseThrow();
        assertEquals("Evening (B): Helper 0 of 1 on 3 dates (1–3 Oct).", w3.message());
        // A has no requirement: NONE, and technicians on it still get their own row.
        assertEquals(CoverageStatus.NONE, row(out, fx.id("A"), null).perDay().get(0).status());
        assertEquals(1, row(out, fx.id("A"), TECH).perDay().get(0).scheduled());
    }

    @Test
    void moreThanRequiredIsOverAndAnInfo() {
        UUID a = fx.person("A1", TECH), b = fx.person("A2", TECH);
        PlanResponse out = plan(List.of(a, b), List.of(fx.rowOf(a, "A A"), fx.rowOf(b, "A B")),
                List.of(new StaffingIn(TECH, fx.id("A"), 1)), List.of(fx.id("A")), 2);
        CoverageRow r = row(out, fx.id("A"), TECH);
        assertEquals(CoverageStatus.OVER, r.perDay().get(0).status());
        assertEquals(CoverageStatus.OK, r.perDay().get(1).status());
        Issue i2 = out.checks().infos().stream().filter(i -> i.id() == IssueId.I2).findFirst().orElseThrow();
        assertEquals("Morning (A): Technician 2 of 1 on 1 date (1 Oct).", i2.message());
        assertTrue(out.checks().warnings().stream().noneMatch(i -> i.id() == IssueId.W3));
    }

    @Test
    void theTotalRowIsShortWhenAnyDesignationIsShortEvenIfAnotherIsOver() {
        UUID t1 = fx.person("T1", TECH), h1 = fx.person("H1", HELPER), h2 = fx.person("H2", HELPER);
        PlanResponse out = plan(List.of(t1, h1, h2), List.of(fx.rowOf(t1, "B"), fx.rowOf(h1, "A"), fx.rowOf(h2, "A")),
                List.of(new StaffingIn(TECH, fx.id("A"), 1), new StaffingIn(HELPER, fx.id("A"), 1)), List.of(fx.id("A")), 1);
        assertEquals(new CoverageDay(2, 2, CoverageStatus.SHORT), row(out, fx.id("A"), null).perDay().get(0));
        assertEquals(CoverageStatus.SHORT, row(out, fx.id("A"), TECH).perDay().get(0).status());
        assertEquals(CoverageStatus.OVER, row(out, fx.id("A"), HELPER).perDay().get(0).status());
    }

    @Test
    void peopleWithNoDesignationCountInTheTotalOnly() {
        UUID none = fx.person("Nobody", null), t = fx.person("T1", TECH);
        PlanResponse out = plan(List.of(none, t), List.of(fx.rowOf(none, "A"), fx.rowOf(t, "A")),
                List.of(new StaffingIn(TECH, fx.id("A"), 1)), List.of(fx.id("A")), 1);
        assertEquals(new CoverageDay(1, 2, CoverageStatus.OVER), row(out, fx.id("A"), null).perDay().get(0));
        assertEquals(new CoverageDay(1, 1, CoverageStatus.OK), row(out, fx.id("A"), TECH).perDay().get(0));
        assertEquals(2, out.coverage().size(), "a total and a Technician row; no row for the bucket");
        Issue w7 = out.checks().warnings().stream().filter(i -> i.id() == IssueId.W7).findFirst().orElseThrow();
        assertEquals(none, w7.employeeId());
    }

    @Test
    void columnsAreTheTickedShiftsThenRequiredThenUsedEachOnce() {
        UUID t = fx.person("T1", TECH);
        PlanResponse out = plan(List.of(t), List.of(fx.rowOf(t, "G C")), List.of(new StaffingIn(TECH, fx.id("B"), 0)),
                List.of(fx.id("A"), fx.id("B")), 2);
        List<UUID> order = out.coverage().stream().filter(r -> r.designationId() == null).map(CoverageRow::shiftPolicyId).toList();
        assertEquals(List.of(fx.id("A"), fx.id("B"), fx.id("G"), fx.id("C")), order);
        assertEquals("A", out.coverage().get(0).code());
        // A requirement of 0 is a requirement: nobody on B is OK.
        assertEquals(CoverageStatus.OK, row(out, fx.id("B"), TECH).perDay().get(0).status());
    }

    @Test
    void nightCoverageIsMissingOnADateWithNobodyOnANightShift() {
        UUID a = fx.person("A1", TECH), b = fx.person("A2", TECH);
        fx.holiday(OCT1.plusDays(3), "Diwali");
        fx.leave(b, OCT1.plusDays(1), OverlayType.L, "Casual leave", false);
        PlanResponse out = plan(List.of(a, b), List.of(fx.rowOf(a, "C A A A"), fx.rowOf(b, "A C - -")), List.of(),
                List.of(fx.id("A"), fx.id("C")), 4);
        Issue w5 = out.checks().warnings().stream().filter(i -> i.id() == IssueId.W5).findFirst().orElseThrow();
        assertEquals(List.of(OCT1.plusDays(1), OCT1.plusDays(2)), w5.dates(),
                "2 Oct: the only night worker is on leave; 3 Oct nobody; 4 Oct is a holiday");
        assertEquals("No one on a night shift on 2 dates: 2–3 Oct.", w5.message());
    }

    @Test
    void aRosterWithoutANightShiftHasNoNightCheck() {
        UUID a = fx.person("A1", TECH);
        PlanResponse out = plan(List.of(a), List.of(fx.rowOf(a, "A A")), List.of(), List.of(fx.id("A")), 2);
        assertTrue(out.checks().warnings().stream().noneMatch(i -> i.id() == IssueId.W5));
        assertEquals("Night shifts covered", out.checks().summary().stream().filter(s -> s.id() == IssueId.W5)
                .findFirst().orElseThrow().label());
    }

    @Test
    void anOvernightShiftIsANightShiftWhateverItsType() {
        PlanFacts.Shift late = fx.shift("L", "Late", "20:00", "04:00", "FIXED");
        assertTrue(late.night());
        assertFalse(fx.shiftsByCode.get("B").night());
        assertTrue(fx.shiftsByCode.get("C").night());
    }
}
