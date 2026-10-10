package com.hrms.api.roster.plan;

import com.hrms.api.roster.Actor;
import com.hrms.api.roster.RosterContract.CheckSummary;
import com.hrms.api.roster.RosterContract.Issue;
import com.hrms.api.roster.RosterContract.IssueId;
import com.hrms.api.roster.RosterContract.Level;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static com.hrms.api.roster.plan.PlanFixture.*;
import static org.junit.jupiter.api.Assertions.*;

/** The schedule checks E1–E5, W1–W7, I1 and the "Schedule check" lines (design §1.4). */
class RosterChecksTest {

    private static final LocalDate OCT1 = LocalDate.of(2026, 10, 1);

    private final PlanFixture fx = new PlanFixture();

    private PlanResponse plan(List<RowIn> rows, int days) {
        return plan(rows, days, null, null, fx.facts());
    }

    private PlanResponse plan(List<RowIn> rows, int days, UUID department, UUID branch, PlanFacts facts) {
        List<MemberIn> members = new ArrayList<>();
        for (RowIn r : rows) members.add(new MemberIn(r.employeeId(), 0));
        return RosterPlanner.plan(new PlanRequest(OCT1, OCT1.plusDays(days - 1), department, branch, null,
                config(List.of(), true, WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD, null, List.of()),
                members, List.of(), rows, false, false), facts);
    }

    private static List<Issue> all(PlanResponse out, IssueId id) {
        List<Issue> list = new ArrayList<>();
        out.checks().errors().stream().filter(i -> i.id() == id).forEach(list::add);
        out.checks().warnings().stream().filter(i -> i.id() == id).forEach(list::add);
        out.checks().infos().stream().filter(i -> i.id() == id).forEach(list::add);
        return list;
    }

    private static Issue one(PlanResponse out, IssueId id) {
        List<Issue> list = all(out, id);
        assertEquals(1, list.size(), id + ": " + list);
        return list.get(0);
    }

    private static CheckSummary line(PlanResponse out, IssueId id) {
        return out.checks().summary().stream().filter(s -> s.id() == id).findFirst().orElse(null);
    }

    // ── errors ───────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void e1ADeletedShiftOrOneOfAnotherCompanyBlocksPublishing() {
        PlanFacts.Shift c = fx.shiftsByCode.get("C");
        fx.put(new PlanFacts.Shift(c.id(), COMPANY, "C", "Night", c.start(), c.end(), "NIGHT", false));
        PlanFacts.Shift foreign = new PlanFacts.Shift(UUID.randomUUID(), OTHER_COMPANY, "X", "Their shift",
                c.start(), c.end(), "FIXED", true);
        fx.put(foreign);
        UUID ravi = fx.person("Ravi", TECH), sita = fx.person("Sita", TECH);
        String unknown = UUID.randomUUID().toString();
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "C C A"), new RowIn(sita,
                List.of(fx.token("C"), foreign.id().toString(), unknown), List.of())), 3);
        List<Issue> e1 = all(out, IssueId.E1);
        assertEquals(3, e1.size());
        assertEquals("Shift C (Night) was deleted. Choose another shift for 3 days.", e1.get(0).message());
        assertEquals(c.id(), e1.get(0).shiftPolicyId());
        assertEquals(List.of(OCT1, OCT1.plusDays(1)), e1.get(0).dates());
        assertEquals("Shift X (Their shift) belongs to another company. Choose another shift for 1 day.", e1.get(1).message());
        assertEquals("A shift that doesn't exist any more is planned on 1 day. Choose another shift.", e1.get(2).message());
        assertTrue(e1.stream().allMatch(i -> i.level() == Level.error));
        assertTrue(out.rows().get(1).cells().get(0).issueIds().contains(e1.get(0).key()), "Sita's C is marked too");
        assertEquals("3 shifts on this roster can't be used", line(out, IssueId.E1).label());
    }

    @Test
    void e2SomeoneNotFoundOrMovedOutOfTheScope() {
        UUID gone = UUID.randomUUID();
        UUID moved = fx.person("Moved", TECH, DEPT_2, BRANCH, null, null);
        UUID otherBranch = fx.person("Elsewhere", TECH, DEPT, null, null, null);
        UUID left = fx.person("Other company", TECH);
        PlanFacts.Person p = fx.people.get(left);
        fx.replacePerson(new PlanFacts.Person(left, OTHER_COMPANY, p.name(), p.code(), p.designationId(), p.designationName(),
                DEPT, "Technical", BRANCH, "Building 1", null, null));
        UUID fine = fx.person("Fine", TECH, DEPT, BRANCH, null, null);
        PlanResponse out = plan(List.of(fx.rowOf(gone, "A"), fx.rowOf(moved, "A"), fx.rowOf(otherBranch, "A"),
                fx.rowOf(left, "A"), fx.rowOf(fine, "A")), 1, DEPT, BRANCH, fx.facts());
        List<Issue> e2 = all(out, IssueId.E2);
        assertEquals(List.of("A person on this roster was not found. Remove them from the roster.",
                "Moved is no longer in Technical.", "Elsewhere is no longer at Building 1.",
                "Other company is no longer in this company."), e2.stream().map(Issue::message).toList());
        assertEquals(List.of(gone, moved, otherBranch, left), e2.stream().map(Issue::employeeId).toList());
        assertEquals("Unknown employee", out.rows().get(0).employeeName());
    }

    @Test
    void e3ADayAnotherPublishedRosterAlreadyPlans() {
        UUID ravi = fx.person("Ravi Kumar", TECH);
        UUID hvac = UUID.randomUUID();
        for (int i = 2; i <= 4; i++) fx.otherDay(ravi, OCT1.plusDays(i), hvac, "October – HVAC", "B");
        fx.otherDay(ravi, OCT1.plusDays(6), hvac, "October – HVAC", "WO");
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "A A A A - - - A")), 8);
        Issue e3 = one(out, IssueId.E3);
        assertEquals("Ravi Kumar is already on 'October – HVAC' on 3–4 Oct.", e3.message());
        assertEquals(List.of(OCT1.plusDays(2), OCT1.plusDays(3)), e3.dates());
        // Empty days the other roster plans are not "nothing planned"; day 6 (index 5) is.
        Issue w1 = one(out, IssueId.W1);
        assertEquals(List.of(OCT1.plusDays(5)), w1.dates());
        assertEquals(1, out.rows().get(0).totals().unplanned());
        assertEquals("1 duplicate assignment with another roster", line(out, IssueId.E3).label());
    }

    @Test
    void e4DaysPlannedBeforeJoiningOrAfterLeaving() {
        UUID joiner = fx.person("Joiner", TECH, DEPT, null, LocalDate.of(2026, 10, 3), null);
        UUID leaver = fx.person("Ravi Kumar", TECH, DEPT, null, null, LocalDate.of(2026, 10, 2));
        PlanResponse out = plan(List.of(fx.rowOf(joiner, "A A A A"), fx.rowOf(leaver, "A A A WO")), 4);
        List<Issue> e4 = all(out, IssueId.E4);
        assertEquals(List.of("Joiner joins on 3 Oct; clear 1–2 Oct.", "Ravi Kumar leaves on 2 Oct; clear 3–4 Oct."),
                e4.stream().map(Issue::message).toList());
        assertTrue(out.rows().get(1).cells().get(3).outside());
        assertEquals(List.of(e4.get(1).key()), out.rows().get(1).cells().get(3).issueIds());
    }

    @Test
    void e5ADepartmentPlannerOnlyPlansTheDepartmentsTheyHead() {
        UUID mine = fx.person("Mine", TECH, DEPT, null, null, null);
        UUID theirs = fx.person("Theirs", TECH, DEPT_2, null, null, null);
        UUID nowhere = fx.person("Nowhere", TECH, null, null, null, null);
        Actor head = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(DEPT), false);
        PlanResponse out = plan(List.of(fx.rowOf(mine, "A"), fx.rowOf(theirs, "A"), fx.rowOf(nowhere, "A")), 1, null, null,
                fx.facts().withPlanner(head));
        assertEquals(List.of("Theirs: only HR can plan people outside Technical.",
                "Nowhere: only HR can plan people outside Technical."), all(out, IssueId.E5).stream().map(Issue::message).toList());
        Actor hr = new Actor(UUID.randomUUID(), UUID.randomUUID(), "HR", COMPANY, true, Set.of(), true);
        assertTrue(all(plan(List.of(fx.rowOf(theirs, "A")), 1, null, null, fx.facts().withPlanner(hr)), IssueId.E5).isEmpty());
        assertTrue(all(plan(List.of(fx.rowOf(theirs, "A")), 1), IssueId.E5).isEmpty(), "no planner set = company-wide");
    }

    // ── warnings ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void w1EmptyDaysExceptHolidaysLeaveAndDaysOutsideEmployment() {
        UUID ravi = fx.person("Ravi", TECH, DEPT, null, null, LocalDate.of(2026, 10, 6));
        fx.holiday(OCT1, "Founders day");
        fx.leave(ravi, OCT1.plusDays(1), OverlayType.L, "Casual leave", false);
        fx.leave(ravi, OCT1.plusDays(2), OverlayType.L, "Casual leave", true);
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "- - - - A - -")), 7);
        Issue w1 = one(out, IssueId.W1);
        assertEquals(List.of(OCT1.plusDays(2), OCT1.plusDays(3), OCT1.plusDays(5)), w1.dates(),
                "a half day of leave is still a day to plan; 7 Oct is after the last working day");
        assertEquals("Ravi has nothing planned on 3–4 Oct, 6 Oct.", w1.message());
        assertEquals("1 employee has days with nothing planned", line(out, IssueId.W1).label());
        assertEquals(Level.warning, w1.level());
    }

    @Test
    void w2SevenOrMoreDaysInARowWithNoWeeklyOffHolidayOrLeave() {
        UUID shiva = fx.person("Shiva", TECH), ok = fx.person("Rested", TECH), leave = fx.person("On leave", TECH);
        fx.leave(leave, OCT1.plusDays(5), OverlayType.L, "Casual leave", false);
        PlanResponse out = plan(List.of(
                fx.rowOf(shiva, "WO WO WO A A A A A A A A A WO A A A A A A A"),
                fx.rowOf(ok, "A A A A A A WO A A A A A A WO A A A A A A"),
                fx.rowOf(leave, "A A A A A A A A A A A A WO A A A A A A WO")), 20);
        List<Issue> w2 = all(out, IssueId.W2);
        assertEquals(1, w2.size(), w2.toString());
        assertEquals(shiva, w2.get(0).employeeId());
        assertEquals("Shiva has no weekly off from 4 to 12 Oct and from 14 to 20 Oct.", w2.get(0).message());
        assertEquals(16, w2.get(0).dates().size());
        assertEquals("1 employee has 7 or more days in a row without a weekly off", line(out, IssueId.W2).label());
    }

    @Test
    void w4InsufficientRestAfterANightShiftAndW6WhenTheyOverlap() {
        PlanFacts.Shift early = fx.shift("E", "Early", "05:00", "13:00", "FIXED");
        UUID praveen = fx.person("Praveen", TECH), ravi = fx.person("Ravi", TECH), fine = fx.person("Fine", TECH);
        // C 22:00–06:00 then A at 06:00 → 0 h rest; then C then E at 05:00 → overlap.
        PlanResponse out = plan(List.of(fx.rowOf(praveen, "C A WO C E"), fx.rowOf(ravi, "B A"), fx.rowOf(fine, "A B C WO")), 5);
        Issue w4 = one(out, IssueId.W4);   // Ravi's B (ends 22:00) then A (06:00) is exactly 8 h: enough
        assertEquals(praveen, w4.employeeId());
        assertEquals("Praveen: 0 h rest between C on 1 Oct and A on 2 Oct.", w4.message());
        assertEquals(List.of(OCT1, OCT1.plusDays(1)), w4.dates());
        assertTrue(out.rows().get(0).cells().get(1).issueIds().contains(w4.key()));
        Issue w6 = one(out, IssueId.W6);
        assertEquals("Praveen: E on 5 Oct starts before C of 4 Oct ends.", w6.message());
        assertEquals(List.of(OCT1.plusDays(3), OCT1.plusDays(4)), w6.dates());
        assertEquals(early.id(), fx.id("E"));
    }

    @Test
    void exactlyTheMinimumRestIsEnough() {
        UUID ravi = fx.person("Ravi", TECH);
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "B A")), 2);   // 22:00 → 06:00 = 8 h
        assertTrue(all(out, IssueId.W4).isEmpty());
        fx.minRest = 481;
        PlanResponse stricter = plan(List.of(fx.rowOf(ravi, "B A")), 2);
        assertEquals("Ravi: 8 h rest between B on 1 Oct and A on 2 Oct.", one(stricter, IssueId.W4).message());
        fx.minRest = 0;
        assertTrue(all(plan(List.of(fx.rowOf(ravi, "C A")), 2), IssueId.W4).isEmpty(), "0 = no rest check, overlaps still");
    }

    @Test
    void theDayBeforeThePeriodComesFromTheBaselineOrAnotherRoster() {
        UUID fromBaseline = fx.person("Baseline", TECH), fromRoster = fx.person("Roster", TECH),
                offBefore = fx.person("Off", TECH), leaveBefore = fx.person("Leave", TECH);
        LocalDate sep30 = OCT1.minusDays(1);
        fx.baselineShift(fromBaseline, sep30, "C", false);
        fx.baselineShift(fromRoster, sep30, "G", false);
        fx.otherDay(fromRoster, sep30, UUID.randomUUID(), "September", "C");   // the published day wins
        fx.baselineShift(offBefore, sep30, "C", true);                          // usual weekly off
        fx.baselineShift(leaveBefore, sep30, "C", false);
        fx.leave(leaveBefore, sep30, OverlayType.L, "Casual leave", false);
        PlanResponse out = plan(List.of(fx.rowOf(fromBaseline, "A"), fx.rowOf(fromRoster, "A"), fx.rowOf(offBefore, "A"),
                fx.rowOf(leaveBefore, "A")), 1);
        List<Issue> w4 = all(out, IssueId.W4);
        assertEquals(List.of(fromBaseline, fromRoster), w4.stream().map(Issue::employeeId).toList());
        assertEquals("Baseline: 0 h rest between C on 30 Sep and A on 1 Oct.", w4.get(0).message());
        assertEquals(List.of(OCT1), w4.get(0).dates(), "only the period's date is marked");
    }

    @Test
    void restIsNotCheckedAcrossADayOff() {
        UUID ravi = fx.person("Ravi", TECH), sita = fx.person("Sita", TECH);
        fx.leave(ravi, OCT1.plusDays(1), OverlayType.L, "Casual leave", false);
        fx.holiday(OCT1.plusDays(3), "Diwali");
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "C A - -"), fx.rowOf(sita, "- - C A")), 4);
        assertTrue(all(out, IssueId.W4).isEmpty(), "Ravi is on leave on 2 Oct; 4 Oct is a holiday");
    }

    @Test
    void severalShortRestsForOnePersonAreOneWarning() {
        UUID ravi = fx.person("Ravi", TECH);
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "C A C A C A")), 6);
        Issue w4 = one(out, IssueId.W4);
        assertEquals("Ravi: 0 h rest between C on 1 Oct and A on 2 Oct, and 2 more times.", w4.message());
        assertEquals(6, w4.dates().size());
        assertEquals("1 employee has insufficient rest", line(out, IssueId.W4).label());
    }

    @Test
    void w7NoDesignation() {
        UUID none = fx.person("Nobody", null), two = fx.person("Also nobody", null);
        PlanResponse out = plan(List.of(fx.rowOf(none, "A"), fx.rowOf(two, "A")), 1);
        List<Issue> w7 = all(out, IssueId.W7);
        assertEquals(2, w7.size());
        assertEquals("Nobody has no designation and counts toward no requirement.", w7.get(0).message());
        assertEquals(RosterChecks.W7_LEVEL, w7.get(0).level());
        assertEquals("2 employees have no designation; they count toward no requirement", line(out, IssueId.W7).label());
    }

    // ── infos ────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    void i1AShiftOnAHolidayOrApprovedLeave() {
        UUID ravi = fx.person("Ravi", TECH);
        fx.holiday(OCT1, "Founders day");
        fx.leave(ravi, OCT1.plusDays(1), OverlayType.L, "Casual leave", false);
        fx.leave(ravi, OCT1.plusDays(2), OverlayType.L, "Casual leave", true);
        fx.leave(ravi, OCT1.plusDays(3), OverlayType.COFF, "Comp off", false);
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "A A A WO")), 4);
        Issue i1 = one(out, IssueId.I1);
        assertEquals(Level.info, i1.level());
        assertEquals("Ravi has a shift planned on a holiday (1 Oct), approved leave (2 Oct), half-day leave (3 Oct), "
                + "still counted as working. The holiday or leave shows on top.", i1.message());
        assertEquals(3, i1.dates().size(), "the WO on comp off is not a shift");
        assertTrue(out.checks().errors().isEmpty());
    }

    // ── the check lines ──────────────────────────────────────────────────────────────────────────────────

    @Test
    void theOwnersCheckLinesAreAlwaysThereAndOthersOnlyWhenSomethingIsWrong() {
        UUID ravi = fx.person("Ravi", TECH);
        PlanResponse out = plan(List.of(fx.rowOf(ravi, "A A A A A A WO")), 7);
        assertTrue(out.checks().errors().isEmpty() && out.checks().warnings().isEmpty() && out.checks().infos().isEmpty());
        assertEquals(List.of(IssueId.E3, IssueId.W1, IssueId.W2, IssueId.W3, IssueId.W4, IssueId.W5, IssueId.W6),
                out.checks().summary().stream().map(CheckSummary::id).toList());
        assertEquals(List.of("No duplicate assignments", "All employees assigned", "Weekly offs available",
                "Required coverage met", "Enough rest between shifts", "Night shifts covered", "No overlapping shifts"),
                out.checks().summary().stream().map(CheckSummary::label).toList());
        assertTrue(out.checks().summary().stream().allMatch(s -> s.count() == 0));
        assertEquals(Level.error, line(out, IssueId.E3).level());
    }

    @Test
    void messagesFormatDatesAndHoursPlainly() {
        assertEquals("5 Oct", RosterChecks.day(LocalDate.of(2026, 10, 5)));
        assertEquals("4 to 12 Oct", RosterChecks.fromTo(LocalDate.of(2026, 10, 4), LocalDate.of(2026, 10, 12)));
        assertEquals("28 Sep to 5 Oct", RosterChecks.fromTo(LocalDate.of(2026, 9, 28), LocalDate.of(2026, 10, 5)));
        assertEquals("30 Sep – 2 Oct, 5 Oct, 7–8 Oct", RosterChecks.ranges(List.of(LocalDate.of(2026, 10, 8),
                LocalDate.of(2026, 9, 30), LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2), LocalDate.of(2026, 10, 5),
                LocalDate.of(2026, 10, 7))));
        List<LocalDate> scattered = new ArrayList<>();
        for (int i = 0; i < 20; i += 2) scattered.add(LocalDate.of(2026, 10, 1).plusDays(i));
        assertEquals("1 Oct, 3 Oct, 5 Oct, 7 Oct, 9 Oct, 11 Oct and 4 more days", RosterChecks.ranges(scattered));
        assertEquals("6 h", RosterChecks.hours(360));
        assertEquals("6 h 30 m", RosterChecks.hours(390));
        assertEquals("45 m", RosterChecks.hours(45));
        assertEquals("0 h", RosterChecks.hours(0));
    }

    @Test
    void restMinutesRollANightEndToTheNextDay() {
        PlanFacts.Shift c = fx.shiftsByCode.get("C"), a = fx.shiftsByCode.get("A"), g = fx.shiftsByCode.get("G");
        assertEquals(0, RosterChecks.restMinutes(c, OCT1, a, OCT1.plusDays(1)));
        assertEquals(16 * 60, RosterChecks.restMinutes(c, OCT1, c, OCT1.plusDays(1)));
        assertEquals(15 * 60, RosterChecks.restMinutes(g, OCT1, g, OCT1.plusDays(1)));
        PlanFacts.Shift full = fx.shift("D", "Day and night", "08:00", "08:00", "FIXED");
        assertEquals(0, RosterChecks.restMinutes(full, OCT1, full, OCT1.plusDays(1)), "a 24 h shift ends the next morning");
    }
}
