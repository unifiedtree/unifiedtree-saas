package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterContract.CheckSummary;
import com.hrms.api.roster.RosterContract.Checks;
import com.hrms.api.roster.RosterContract.DraftBody;
import com.hrms.api.roster.RosterContract.Issue;
import com.hrms.api.roster.RosterContract.IssueId;
import com.hrms.api.roster.RosterContract.Level;
import com.hrms.api.roster.RosterContract.LockVersionBody;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PublishBody;
import com.hrms.api.roster.RosterContract.PublishResult;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterDetail;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.api.roster.RosterStore.Day;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Save, publish and "Discard changes" on an in-memory store (design §1.5 "Rules behind the write
 * endpoints"): the first publish writes only today onward; a republish adds, changes and removes days
 * with one history row each; another roster's day refuses the publish (E3); a stale lock is 409
 * ROSTER_CHANGED; a published roster's past days, dates and scope can't change; warnings need the
 * tick; who is told what.
 */
class RosterPublisherTest {

    static final UUID TENANT = UUID.randomUUID();
    static final UUID COMPANY = UUID.randomUUID();
    static final UUID OTHER_COMPANY = UUID.randomUUID();
    static final UUID DEPT = UUID.randomUUID(), OTHER_DEPT = UUID.randomUUID();
    static final UUID HR_USER = UUID.randomUUID(), HR = UUID.randomUUID(), HEAD_USER = UUID.randomUUID(), HEAD = UUID.randomUUID();
    static final UUID RAVI = UUID.randomUUID(), SITA = UUID.randomUUID(), ARUN = UUID.randomUUID();
    /** Monday 12 October 2026, noon in India. */
    static final Clock NOON_12_OCT = Clock.fixed(Instant.parse("2026-10-12T06:30:00Z"), RosterAuth.IST);
    static final LocalDate OCT_1 = LocalDate.of(2026, 10, 1), OCT_31 = LocalDate.of(2026, 10, 31), TODAY = LocalDate.of(2026, 10, 12);

    final RosterFakes.Store store = new RosterFakes.Store();
    final RosterFakes.Shifts shifts = new RosterFakes.Shifts();
    final RosterFakes.Planning planning = new RosterFakes.Planning();
    final FakeScope scope = new FakeScope();
    final List<Object> events = new ArrayList<>();
    RosterService rosters;
    RosterPublisher publisher;
    ShiftCatalog.Shift a, b, night, archived;

    final Jwt hr = RosterFakes.jwt(HR_USER, HR, RosterAuth.PLAN, RosterAuth.PUBLISH, RosterAuth.WORKFORCE_ADMIN);
    final Jwt head = RosterFakes.jwt(HEAD_USER, HEAD, RosterAuth.PLAN);

    /** HR/Admin company-wide, or a department head of DEPT (plan only). */
    static final class FakeScope implements PlannerScope {
        @Override public Actor actor(Jwt jwt, UUID companyId) {
            boolean wide = RosterAuth.has(jwt, RosterAuth.WORKFORCE_ADMIN);
            return new Actor(RosterAuth.userId(jwt), RosterAuth.employeeId(jwt), wide ? "HR Admin" : "Dept Head",
                    companyId, wide, wide ? Set.of() : Set.of(DEPT), RosterAuth.has(jwt, RosterAuth.PUBLISH));
        }

        @Override public void check(Actor a, UUID departmentId, Collection<UUID> employeeIds) {
            if (!PlannerScopeService.covers(a, departmentId)) throw RosterErrors.scope("outside");
        }
    }

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        a = shifts.add(COMPANY, "A", "Morning", "06:00", "14:00", "FIXED", true);
        b = shifts.add(COMPANY, "B", "Evening", "14:00", "22:00", "FIXED", true);
        night = shifts.add(COMPANY, "C", "Night", "22:00", "06:00", "NIGHT", true);
        archived = shifts.add(COMPANY, "X", "Old", "09:00", "17:00", "FIXED", false);
        for (UUID e : List.of(RAVI, SITA, ARUN)) store.companyOf.put(e, COMPANY);
        store.nameOf.put(RAVI, "Ravi Kumar");
        store.nameOf.put(SITA, "Sita Rao");
        store.nameOf.put(ARUN, "Arun Das");
        store.departments.addAll(List.of(DEPT, OTHER_DEPT));
        rosters = new RosterService(store, new RosterFakes.Tables(), scope, shifts, planning);
        rosters.setClock(NOON_12_OCT);
        publisher = new RosterPublisher(rosters, store, new RosterFakes.Tables(), scope, shifts, planning);
        publisher.setEvents(events::add);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    static RosterConfig config() {
        return new RosterConfig(null, List.of(), true, WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD, null, List.of(), List.of(""));
    }

    static RowIn row(UUID emp, Function<LocalDate, String> token) {
        List<String> cells = new ArrayList<>();
        for (LocalDate d = OCT_1; !d.isAfter(OCT_31); d = d.plusDays(1)) cells.add(token.apply(d));
        return new RowIn(emp, cells, List.of());
    }

    DraftBody body(UUID dept, Integer lockVersion, List<UUID> people, List<RowIn> rows) {
        return new DraftBody("October 2026", PeriodType.MONTH, OCT_1, OCT_31, dept, null, config(),
                people.stream().map(p -> new MemberIn(p, 0)).toList(), List.of(), rows, lockVersion);
    }

    /** Ravi on A every day except Sundays (WO); Sita on B on weekdays, nothing at weekends. */
    RosterDetail draft() {
        return rosters.create(hr, COMPANY, body(null, null, List.of(RAVI, SITA), List.of(
                row(RAVI, d -> d.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString()),
                row(SITA, d -> d.getDayOfWeek().getValue() >= 6 ? null : b.id().toString()))));
    }

    PublishResult publish(RosterDetail d, boolean ack, String note) {
        return publisher.publish(hr, d.roster().id(), new PublishBody(d.roster().lockVersion(), ack, note));
    }

    static long daysOf(RosterFakes.Store s, UUID emp) {
        return s.days.values().stream().filter(d -> d.employeeId().equals(emp)).count();
    }

    static int weekdaysFromToday(boolean weekendsToo, boolean sundays) {
        int n = 0;
        for (LocalDate d = TODAY; !d.isAfter(OCT_31); d = d.plusDays(1)) {
            int dow = d.getDayOfWeek().getValue();
            if (dow <= 5 || weekendsToo || (sundays && dow == 7)) n++;
        }
        return n;
    }

    static Checks checks(List<Issue> errors, List<Issue> warnings) {
        return new Checks(errors, warnings, List.of(), List.of());
    }

    static PlanResponse planWith(Checks c) {
        return new PlanResponse(List.of(), List.of(), List.of(), c, List.of());
    }

    static Issue warning(String id) {
        return new Issue(id, IssueId.W4, Level.warning, RAVI, List.of(TODAY), null, null, "Ravi Kumar: 6 h rest");
    }

    // ── first publish ─────────────────────────────────────────────────────────

    @Test
    void theFirstPublishWritesOnlyTodayOnwardAndTellsEveryoneWithADay() {
        RosterDetail d = draft();
        assertEquals(RosterStatus.DRAFT, d.roster().status());
        assertEquals(0, d.roster().version());

        PublishResult r = publish(d, false, "October plan");

        assertEquals(1, r.version());
        assertEquals(RosterStatus.PUBLISHED, r.roster().status());
        assertFalse(r.roster().hasUnpublishedChanges());
        // 12..31 Oct: Ravi every day (A, or WO on Sundays), Sita on weekdays only. Nothing before today.
        assertEquals(20, daysOf(store, RAVI));
        assertEquals(weekdaysFromToday(false, false), daysOf(store, SITA));
        assertTrue(store.days.values().stream().noneMatch(x -> x.date().isBefore(TODAY)), "no day before today is written");
        assertEquals(r.daysAdded(), store.days.size());
        assertEquals(0, r.daysChanged());
        assertEquals(0, r.daysRemoved());
        Day sunday = store.days.get(RAVI + "|2026-10-18");
        assertEquals("WO", sunday.kind());
        assertNull(sunday.shiftPolicyId());
        assertEquals(a.id(), store.days.get(RAVI + "|2026-10-19").shiftPolicyId());
        // one history row per day, with the publish's version and note
        assertEquals(store.days.size(), store.history.size());
        assertTrue(store.historyVersions.stream().allMatch(v -> v == 1));
        assertTrue(store.historyNotes.stream().allMatch("October plan"::equals));
        assertTrue(store.history.stream().allMatch(c -> c.change() == ChangeKind.ADDED));
        // both are told the schedule is ready; nobody gets "your day changed"
        assertEquals(2, r.peopleToNotify());
        RosterPublishedEvent e = (RosterPublishedEvent) events.get(0);
        RosterNotifier.Recipients who = RosterNotifier.recipients(e.hadDaysBefore(), e.haveDaysNow(), e.changes());
        assertEquals(Set.of(RAVI, SITA), who.published());
        assertTrue(who.changed().isEmpty());
        assertEquals("October 2026", e.periodText());
        assertEquals(TODAY, e.from());
        assertEquals(OCT_31, e.to());
    }

    @Test
    void aRosterThatStartsLaterIsPublishedFromItsStart() {
        LocalDate nov1 = LocalDate.of(2026, 11, 1), nov30 = LocalDate.of(2026, 11, 30);
        List<String> cells = new ArrayList<>();
        for (LocalDate d = nov1; !d.isAfter(nov30); d = d.plusDays(1)) cells.add(a.id().toString());
        RosterDetail d = rosters.create(hr, COMPANY, new DraftBody("", PeriodType.MONTH, nov1, nov30, null, null, config(),
                List.of(new MemberIn(RAVI, 0)), List.of(), List.of(new RowIn(RAVI, cells, List.of())), null));
        assertEquals("November 2026", d.roster().name(), "a blank name gets the period's");
        PublishResult r = publish(d, false, null);
        assertEquals(30, r.daysAdded());
        assertEquals(nov1, ((RosterPublishedEvent) events.get(0)).from());
    }

    // ── republish ─────────────────────────────────────────────────────────────

    @Test
    void aRepublishAddsChangesAndRemovesDaysAndTellsWhoseDayChanged() {
        RosterDetail d = publishFirst();
        int sitaBefore = (int) daysOf(store, SITA);
        // Ravi: 15 Oct becomes B, 20 Oct is cleared. Sita: gets 17 Oct (a Saturday). Arun joins with A on 14–16 Oct.
        RosterDetail saved = rosters.replace(hr, d.roster().id(), body(null, d.roster().lockVersion(), List.of(RAVI, SITA, ARUN), List.of(
                row(RAVI, x -> x.equals(LocalDate.of(2026, 10, 15)) ? b.id().toString() : x.equals(LocalDate.of(2026, 10, 20)) ? null
                        : x.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString()),
                row(SITA, x -> x.equals(LocalDate.of(2026, 10, 17)) ? night.id().toString()
                        : x.getDayOfWeek().getValue() >= 6 ? null : b.id().toString()),
                row(ARUN, x -> !x.isBefore(LocalDate.of(2026, 10, 14)) && !x.isAfter(LocalDate.of(2026, 10, 16)) ? a.id().toString() : null))));
        assertTrue(saved.roster().hasUnpublishedChanges(), "the working copy now differs from what is published");
        assertEquals(d.roster().lockVersion() + 1, saved.roster().lockVersion());
        events.clear();

        PublishResult r = publisher.publish(hr, d.roster().id(), new PublishBody(saved.roster().lockVersion(), false, "Swap week"));

        assertEquals(2, r.version());
        assertEquals(4, r.daysAdded(), "Sita's Saturday and Arun's three days");
        assertEquals(1, r.daysChanged(), "Ravi's 15 Oct");
        assertEquals(1, r.daysRemoved(), "Ravi's 20 Oct");
        assertEquals(b.id(), store.days.get(RAVI + "|2026-10-15").shiftPolicyId());
        assertEquals(2, store.days.get(RAVI + "|2026-10-15").rosterVersion());
        assertNull(store.days.get(RAVI + "|2026-10-20"));
        assertEquals(1, store.days.get(RAVI + "|2026-10-19").rosterVersion(), "an unchanged day keeps the publish that wrote it");
        assertEquals(sitaBefore + 1, daysOf(store, SITA));
        int v2 = (int) store.historyVersions.stream().filter(v -> v == 2).count();
        assertEquals(6, v2, "one history row per change");
        assertFalse(store.headers.get(d.roster().id()).hasUnpublishedChanges());

        RosterPublishedEvent e = (RosterPublishedEvent) events.get(0);
        RosterNotifier.Recipients who = RosterNotifier.recipients(e.hadDaysBefore(), e.haveDaysNow(), e.changes());
        assertEquals(Set.of(ARUN), who.published(), "a person added later is told the schedule is ready");
        assertEquals(Set.of(RAVI, SITA), who.changed().keySet(), "the others are told which day changed");
        assertEquals(2, who.changed().get(RAVI).size());
        assertEquals(3, r.peopleToNotify());
        assertEquals("15 Oct is now B (Evening, 14:00–22:00), and 1 more day.", RosterNotifier.changeText(who.changed().get(RAVI)));
        assertEquals("17 Oct is now C (Night, 22:00–06:00).", RosterNotifier.changeText(who.changed().get(SITA)));
    }

    @Test
    void someoneTakenOffThePublishedRosterLosesTheirDaysFromTodayAndIsTold() {
        RosterDetail d = publishFirst();
        // Sita can't be taken off: her past weekdays would vanish. Clear her days from today on instead.
        HrmsException past = assertThrows(HrmsException.class, () -> rosters.replace(hr, d.roster().id(),
                body(null, d.roster().lockVersion(), List.of(RAVI), List.of(row(RAVI, x -> x.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString())))));
        assertEquals("ROSTER_PAST_DAYS", past.getErrorCode());
        RosterDetail saved = rosters.replace(hr, d.roster().id(), body(null, d.roster().lockVersion(), List.of(RAVI, SITA), List.of(
                row(RAVI, x -> x.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString()),
                row(SITA, x -> x.isBefore(TODAY) && x.getDayOfWeek().getValue() < 6 ? b.id().toString() : null))));
        events.clear();
        PublishResult r = publisher.publish(hr, d.roster().id(), new PublishBody(saved.roster().lockVersion(), false, null));
        assertEquals(weekdaysFromToday(false, false), r.daysRemoved());
        assertEquals(0, daysOf(store, SITA));
        RosterPublishedEvent e = (RosterPublishedEvent) events.get(0);
        RosterNotifier.Recipients who = RosterNotifier.recipients(e.hadDaysBefore(), e.haveDaysNow(), e.changes());
        assertEquals(Set.of(SITA), who.changed().keySet());
        assertTrue(RosterNotifier.changeText(who.changed().get(SITA)).startsWith("12 Oct is no longer planned, and "));
    }

    @Test
    void savingThePublishedDaysUnchangedLeavesNothingUnpublished() {
        RosterDetail d = publishFirst();
        RosterDetail again = rosters.replace(hr, d.roster().id(), new DraftBody(d.roster().name(), PeriodType.MONTH, OCT_1, OCT_31,
                null, null, config(), d.members(), d.staffing(), d.rows(), d.roster().lockVersion()));
        assertFalse(again.roster().hasUnpublishedChanges());
        PublishResult r = publisher.publish(hr, d.roster().id(), new PublishBody(again.roster().lockVersion(), false, null));
        assertEquals(0, r.daysAdded() + r.daysChanged() + r.daysRemoved());
        assertEquals(0, r.peopleToNotify());
    }

    // ── refusals ──────────────────────────────────────────────────────────────

    @Test
    void aDayAnotherPublishedRosterPlansRefusesThePublishWithE3() {
        RosterDetail d = draft();
        UUID hvac = UUID.randomUUID();
        store.otherRosterDay(RAVI, LocalDate.of(2026, 10, 13), hvac, "October – HVAC");
        store.otherRosterDay(RAVI, LocalDate.of(2026, 10, 14), hvac, "October – HVAC");
        store.otherRosterDay(RAVI, LocalDate.of(2026, 10, 15), hvac, "October – HVAC");
        int before = store.days.size();

        RosterChecksException ex = assertThrows(RosterChecksException.class, () -> publish(d, true, null));

        assertEquals("ROSTER_HAS_ERRORS", ex.getErrorCode());
        assertEquals(409, ex.getStatus().value());
        Issue e3 = ex.checks().errors().get(0);
        assertEquals(IssueId.E3, e3.id());
        assertEquals(RAVI, e3.employeeId());
        assertEquals(List.of(LocalDate.of(2026, 10, 13), LocalDate.of(2026, 10, 14), LocalDate.of(2026, 10, 15)), e3.dates());
        assertEquals("Ravi Kumar is already on 'October – HVAC' on 13–15 Oct.", e3.message());
        assertEquals(new CheckSummary(IssueId.E3, Level.error, 1, "1 person is already on another roster"), ex.checks().summary().get(0));
        assertEquals(before, store.days.size(), "nothing written");
        assertEquals(RosterStatus.DRAFT, store.headers.get(d.roster().id()).status());
        assertTrue(events.isEmpty(), "nobody is told");
    }

    @Test
    void anotherRosterTakingTheSameDayAtTheSameMomentAlsoRefusesIt() {
        RosterDetail d = draft();
        UUID other = UUID.randomUUID();
        store.raceDays.add(new Day(SITA, LocalDate.of(2026, 10, 13), "SHIFT", a.id(), other, "Night team", 1));
        RosterChecksException ex = assertThrows(RosterChecksException.class, () -> publish(d, false, null));
        assertEquals("ROSTER_HAS_ERRORS", ex.getErrorCode());
        assertEquals(IssueId.E3, ex.checks().errors().get(0).id());
        assertEquals("Sita Rao is already on 'Night team' on 13 Oct.", ex.checks().errors().get(0).message());
    }

    @Test
    void aStaleLockVersionIs409RosterChanged() {
        RosterDetail d = draft();
        HrmsException publishStale = assertThrows(HrmsException.class,
                () -> publisher.publish(hr, d.roster().id(), new PublishBody(d.roster().lockVersion() + 1, false, null)));
        assertEquals("ROSTER_CHANGED", publishStale.getErrorCode());
        assertEquals(409, publishStale.getStatus().value());
        HrmsException saveStale = assertThrows(HrmsException.class,
                () -> rosters.replace(hr, d.roster().id(), body(null, d.roster().lockVersion() + 5, List.of(RAVI), List.of())));
        assertEquals("ROSTER_CHANGED", saveStale.getErrorCode());
        HrmsException noLock = assertThrows(HrmsException.class,
                () -> rosters.replace(hr, d.roster().id(), body(null, null, List.of(RAVI), List.of())));
        assertEquals("ROSTER_INVALID", noLock.getErrorCode());
    }

    @Test
    void aPublishedRostersPastDaysDatesAndScopeCantChange() {
        RosterDetail d = publishFirst();
        int lock = d.roster().lockVersion();
        // 5 Oct (before today) from A to B
        HrmsException past = assertThrows(HrmsException.class, () -> rosters.replace(hr, d.roster().id(), body(null, lock, List.of(RAVI, SITA), List.of(
                row(RAVI, x -> x.equals(LocalDate.of(2026, 10, 5)) ? b.id().toString() : x.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString()),
                row(SITA, x -> x.getDayOfWeek().getValue() >= 6 ? null : b.id().toString())))));
        assertEquals("ROSTER_PAST_DAYS", past.getErrorCode());
        assertEquals(409, past.getStatus().value());
        assertEquals("Days before today can't change once a roster is published: Ravi Kumar on 5 Oct.", past.getMessage());
        // the department
        HrmsException scopeChange = assertThrows(HrmsException.class, () -> rosters.replace(hr, d.roster().id(),
                new DraftBody("x", PeriodType.MONTH, OCT_1, OCT_31, DEPT, null, config(), d.members(), d.staffing(), d.rows(), lock)));
        assertEquals("ROSTER_PERIOD_LOCKED", scopeChange.getErrorCode());
        // the dates
        HrmsException dates = assertThrows(HrmsException.class, () -> rosters.replace(hr, d.roster().id(),
                new DraftBody("x", PeriodType.RANGE, OCT_1, LocalDate.of(2026, 10, 30), null, null, config(), d.members(), d.staffing(),
                        List.of(), lock)));
        assertEquals("ROSTER_PERIOD_LOCKED", dates.getErrorCode());
        // a day from today on can change
        RosterDetail ok = rosters.replace(hr, d.roster().id(), body(null, lock, List.of(RAVI, SITA), List.of(
                row(RAVI, x -> x.equals(TODAY) ? b.id().toString() : x.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString()),
                row(SITA, x -> x.getDayOfWeek().getValue() >= 6 ? null : b.id().toString()))));
        assertTrue(ok.roster().hasUnpublishedChanges());
    }

    @Test
    void warningsNeedTheTickAndErrorsAlwaysBlock() {
        RosterDetail d = draft();
        planning.answer = in -> Optional.of(planWith(checks(List.of(), List.of(warning("W4:1"), warning("W4:2")))));
        RosterChecksException w = assertThrows(RosterChecksException.class, () -> publish(d, false, null));
        assertEquals("ROSTER_HAS_WARNINGS", w.getErrorCode());
        assertEquals(2, w.checks().warnings().size());
        assertEquals("2 warnings to look at. Tick \"Publish with warnings\" to publish anyway.", w.getMessage());
        assertTrue(store.days.isEmpty());

        PublishResult ok = publish(d, true, null);
        assertEquals(1, ok.version());
        assertFalse(store.days.isEmpty());
        // the planner was asked about the saved roster, not to regenerate it
        assertFalse(planning.asked.get(planning.asked.size() - 1).regenerate());
        assertEquals(d.roster().id(), planning.asked.get(planning.asked.size() - 1).rosterId());

        RosterDetail d2 = rosters.create(hr, COMPANY, body(null, null, List.of(ARUN), List.of(row(ARUN, x -> a.id().toString()))));
        planning.answer = in -> Optional.of(planWith(checks(List.of(new Issue("E1:x", IssueId.E1, Level.error, ARUN, List.of(TODAY),
                a.id(), null, "Shift A was deleted.")), List.of())));
        RosterChecksException e = assertThrows(RosterChecksException.class, () -> publish(d2, true, null));
        assertEquals("ROSTER_HAS_ERRORS", e.getErrorCode());
        assertEquals(0, daysOf(store, ARUN));
    }

    @Test
    void someoneNoLongerInTheCompanyCantGetADay() {
        RosterDetail d = draft();
        store.companyOf.put(SITA, OTHER_COMPANY);
        RosterChecksException ex = assertThrows(RosterChecksException.class, () -> publish(d, false, null));
        assertEquals(IssueId.E2, ex.checks().errors().get(0).id());
        assertEquals(SITA, ex.checks().errors().get(0).employeeId());
        assertTrue(store.days.isEmpty());
    }

    @Test
    void aDepartmentHeadPlansTheirDepartmentButCantPublish() {
        RosterDetail d = rosters.create(head, COMPANY, body(DEPT, null, List.of(RAVI), List.of(row(RAVI, x -> a.id().toString()))));
        assertTrue(d.roster().canEdit());
        assertFalse(d.roster().canPublish());
        Actor asked = planning.askedAs.get(planning.askedAs.size() - 1);
        assertFalse(asked.companyWide(), "the planner is told who plans, so E5 shows people outside their departments");
        assertEquals(Set.of(DEPT), asked.headedDepartmentIds());
        HrmsException ex = assertThrows(HrmsException.class,
                () -> publisher.publish(head, d.roster().id(), new PublishBody(d.roster().lockVersion(), true, null)));
        assertEquals("ROSTER_SCOPE", ex.getErrorCode());
        assertEquals(403, ex.getStatus().value());
        HrmsException outside = assertThrows(HrmsException.class,
                () -> rosters.create(head, COMPANY, body(OTHER_DEPT, null, List.of(RAVI), List.of())));
        assertEquals("ROSTER_SCOPE", outside.getErrorCode());
        // HR publishes the head's roster
        PublishResult r = publisher.publish(hr, d.roster().id(), new PublishBody(d.roster().lockVersion(), false, null));
        assertEquals(20, r.daysAdded());
    }

    @Test
    void onlyANeverPublishedDraftCanBeDeleted() {
        RosterDetail d = draft();
        RosterDetail p = publishFirst();
        HrmsException ex = assertThrows(HrmsException.class, () -> rosters.delete(hr, p.roster().id()));
        assertEquals("ROSTER_PUBLISHED", ex.getErrorCode());
        rosters.delete(hr, d.roster().id());
        assertFalse(store.headers.containsKey(d.roster().id()));
    }

    // ── discard changes ───────────────────────────────────────────────────────

    @Test
    void discardChangesRestoresPublishedDays() {
        RosterDetail d = publishFirst();
        RosterDetail edited = rosters.replace(hr, d.roster().id(), body(null, d.roster().lockVersion(), List.of(RAVI, SITA, ARUN), List.of(
                row(RAVI, x -> x.isBefore(TODAY) ? (x.getDayOfWeek().getValue() == 7 ? "WO" : a.id().toString()) : b.id().toString()),
                row(SITA, x -> x.getDayOfWeek().getValue() >= 6 ? null : b.id().toString()),
                row(ARUN, x -> x.isBefore(TODAY) ? null : a.id().toString()))));
        assertTrue(edited.roster().hasUnpublishedChanges());
        int publishedDays = store.days.size();

        RosterDetail back = publisher.discard(hr, d.roster().id(), new LockVersionBody(edited.roster().lockVersion()));

        assertFalse(back.roster().hasUnpublishedChanges());
        assertEquals(publishedDays, store.days.size(), "the published schedule is untouched");
        RowIn ravi = back.rows().stream().filter(r -> r.employeeId().equals(RAVI)).findFirst().orElseThrow();
        assertEquals(a.id().toString(), ravi.cells().get(TODAY.getDayOfMonth() - 1), "Ravi's today is A again");
        assertEquals("WO", ravi.cells().get(17), "18 Oct (a Sunday) is WO again");
        assertEquals(a.id().toString(), ravi.cells().get(4), "a past day is left as it was");
        RowIn arun = back.rows().stream().filter(r -> r.employeeId().equals(ARUN)).findFirst().orElseThrow();
        assertTrue(arun.cells().stream().allMatch(java.util.Objects::isNull), "Arun has nothing published, so nothing planned");
        HrmsException stale = assertThrows(HrmsException.class,
                () -> publisher.discard(hr, d.roster().id(), new LockVersionBody(edited.roster().lockVersion())));
        assertEquals("ROSTER_CHANGED", stale.getErrorCode());
        RosterDetail draft = draft();
        HrmsException notPublished = assertThrows(HrmsException.class,
                () -> publisher.discard(hr, draft.roster().id(), new LockVersionBody(draft.roster().lockVersion())));
        assertEquals("ROSTER_NOT_PUBLISHED", notPublished.getErrorCode());
    }

    private RosterDetail publishFirst() {
        RosterDetail d = draft();
        publish(d, false, null);
        events.clear();
        return rosters.get(hr, d.roster().id());
    }
}
