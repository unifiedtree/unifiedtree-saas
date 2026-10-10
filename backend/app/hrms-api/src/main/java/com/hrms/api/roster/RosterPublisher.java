package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterContract.CheckSummary;
import com.hrms.api.roster.RosterContract.Checks;
import com.hrms.api.roster.RosterContract.Issue;
import com.hrms.api.roster.RosterContract.IssueId;
import com.hrms.api.roster.RosterContract.Level;
import com.hrms.api.roster.RosterContract.LockVersionBody;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PublishBody;
import com.hrms.api.roster.RosterContract.PublishResult;
import com.hrms.api.roster.RosterContract.RosterDetail;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterStore.Cell;
import com.hrms.api.roster.RosterStore.Day;
import com.hrms.api.roster.RosterStore.DayChange;
import com.hrms.api.roster.RosterStore.Header;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Publishing a roster, and "Discard changes" (design §1.5 "Publish", endpoints 15–16).
 *
 * <p><b>Publish</b>, in one transaction: lock the roster; the lock version must match and the caller
 * must hold {@code attendance.roster.publish} for the roster's scope; the planner's full check (an
 * error refuses with 409 {@code ROSTER_HAS_ERRORS}, warnings need {@code acknowledgeWarnings}); then
 * the working copy's days <b>from today (India time) to the end</b> are written to the published
 * schedule: added, changed or removed against the roster's own days from today on, each with a history
 * row. Days before today are never written (nothing is ever re-judged afterwards). A person's day
 * planned by another published roster refuses the publish (check E3; the table's primary key makes a
 * race impossible). People are told after the commit ({@link RosterNotifier}).
 *
 * <p><b>Writes only the roster tables</b> ({@code schedule_days}, {@code schedule_day_history},
 * {@code rosters}, and the working copy for a discard). Attendance, late marks, overtime, payroll and
 * leave read none of them in Phase 1, so every number stays as it is: the company's "rosters drive
 * attendance" switch (Phase 3) is never read here.
 */
@Service
public class RosterPublisher {

    private static final Logger log = LoggerFactory.getLogger(RosterPublisher.class);
    static final int NOTE_MAX = 500;

    private static final DateTimeFormatter MONTH_YEAR = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_MONTH_YEAR = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final RosterService rosters;
    private final RosterStore store;
    private final RosterTables tables;
    private final PlannerScope scope;
    private final ShiftCatalog shifts;
    private final RosterPlanning planning;

    @Autowired(required = false)
    private ApplicationEventPublisher events;

    public RosterPublisher(RosterService rosters, RosterStore store, RosterTables tables, PlannerScope scope,
                           ShiftCatalog shifts, RosterPlanning planning) {
        this.rosters = rosters;
        this.store = store;
        this.tables = tables;
        this.scope = scope;
        this.shifts = shifts;
        this.planning = planning;
    }

    void setEvents(ApplicationEventPublisher events) {
        this.events = events;
    }

    @Transactional
    public PublishResult publish(Jwt jwt, UUID id, PublishBody body) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        if (body == null) throw RosterErrors.invalid("Send the roster's lockVersion with the publish.");
        String note = body.note() == null || body.note().isBlank() ? null : body.note().trim();
        if (note != null && note.length() > NOTE_MAX) throw RosterErrors.invalid("A publish note has at most " + NOTE_MAX + " characters.");

        // 1. the roster, locked; the caller publishes this roster's scope; nobody saved in between
        Header h = rosters.load(tenant, id, true);
        Actor a = rosters.reader(jwt, h);
        if (!a.canPublish()) throw RosterErrors.scope("Only HR publishes rosters. Save it, and HR can publish it when it's ready.");
        List<MemberIn> members = store.members(tenant, id);
        List<UUID> memberIds = RosterService.memberIds(members);
        scope.check(a, h.departmentId(), memberIds);
        if (body.lockVersion() != h.lockVersion()) throw RosterErrors.changed();

        // 2. the planner's full check
        List<StaffingIn> staffing = store.staffing(tenant, id);
        List<Cell> cells = store.cells(tenant, id);
        Optional<PlanResponse> plan = planning.plan(tenant, h.companyId(),
                RosterService.planRequest(h, members, staffing, RosterService.rows(h, members, cells)), a);
        if (plan.isPresent() && plan.get().checks() != null) {
            Checks checks = plan.get().checks();
            if (checks.errors() != null && !checks.errors().isEmpty()) throw RosterChecksException.errors(checks);
            if (checks.warnings() != null && !checks.warnings().isEmpty() && !body.acknowledgeWarnings()) {
                throw RosterChecksException.warnings(checks);
            }
        } else {
            log.warn("Roster {} published without the planner's checks (package B not in this build)", id);
        }

        // 3. what should be published: the working copy from today on
        LocalDate from = rosters.publishFrom(h);
        List<Cell> desired = RosterService.desiredFrom(cells, members, from, h.endDate());

        // 4. lock this roster's days and the members' days on other rosters
        List<Day> existing = from.isAfter(h.endDate()) ? List.of() : store.rosterDays(tenant, id, from, true);
        List<Day> others = store.otherRosterDays(tenant, memberIds, from, h.endDate(), id, true);
        Map<ScheduleDiff.Key, Day> taken = new HashMap<>();
        for (Day d : others) taken.put(new ScheduleDiff.Key(d.employeeId(), d.date()), d);
        List<Day> clashes = new ArrayList<>();
        for (Cell c : desired) {
            Day d = taken.get(new ScheduleDiff.Key(c.employeeId(), c.date()));
            if (d != null) clashes.add(d);
        }
        if (!clashes.isEmpty()) throw RosterChecksException.errors(otherRosterChecks(tenant, clashes));
        refuseOtherCompanies(tenant, h, desired);

        // 5. the changes, written with their history
        List<DayChange> changes = ScheduleDiff.between(desired, existing);
        int version = h.version() + 1;
        String source = h.source() == RosterSource.IMPORT ? "IMPORT" : "ROSTER";
        List<DayChange> refused = store.applyChanges(tenant, h.companyId(), id, version, source, changes, a, note);
        if (!refused.isEmpty()) {
            // Another roster was published for these people a moment ago: say whose, and roll back.
            List<Day> now = store.otherRosterDays(tenant, RosterService.distinctPeople(desired), from, h.endDate(), id, false);
            Set<ScheduleDiff.Key> refusedKeys = new HashSet<>();
            for (DayChange c : refused) refusedKeys.add(new ScheduleDiff.Key(c.employeeId(), c.date()));
            List<Day> lost = now.stream().filter(d -> refusedKeys.contains(new ScheduleDiff.Key(d.employeeId(), d.date()))).toList();
            throw RosterChecksException.errors(otherRosterChecks(tenant, lost));
        }

        // 6. the roster is published
        store.markPublished(tenant, id, version, a);

        // 7. people are told after the commit
        Set<UUID> before = new LinkedHashSet<>(), now = new LinkedHashSet<>();
        for (Day d : existing) before.add(d.employeeId());
        for (Cell c : desired) now.add(c.employeeId());
        List<RosterPublishedEvent.Change> told = changesForPeople(tenant, h.companyId(), changes);
        RosterNotifier.Recipients recipients = RosterNotifier.recipients(before, now, told);
        if (events != null) {
            events.publishEvent(new RosterPublishedEvent(tenant, id, h.name(), periodText(h), from, h.endDate(), before, now, told));
        }
        int added = 0, changed = 0, removed = 0;
        for (DayChange c : changes) {
            switch (c.change()) {
                case ADDED -> added++;
                case CHANGED -> changed++;
                case REMOVED -> removed++;
            }
        }
        log.info("Roster {} published as version {} by {}: {} added, {} changed, {} removed, {} people to tell",
                id, version, a.userId(), added, changed, removed, recipients.count());
        Header after = rosters.load(tenant, id, false);
        return new PublishResult(RosterService.summary(after, a, RosterAuth.has(jwt, RosterAuth.PLAN)), version,
                added, changed, removed, recipients.count());
    }

    /**
     * "Discard changes": the working copy's days from today on go back to this roster's published days
     * (anyone with a published day who was taken off the roster is put back on it, at the end). Days
     * before today, the staffing and the wizard's choices stay as they are.
     */
    @Transactional
    public RosterDetail discard(Jwt jwt, UUID id, LockVersionBody body) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        if (body == null) throw RosterErrors.invalid("Send the roster's lockVersion.");
        Header h = rosters.load(tenant, id, true);
        Actor a = rosters.editor(jwt, h);
        if (body.lockVersion() != h.lockVersion()) throw RosterErrors.changed();
        if (h.status() != RosterStatus.PUBLISHED) throw RosterErrors.notPublished();
        LocalDate from = rosters.publishFrom(h);
        List<Day> published = from.isAfter(h.endDate()) ? List.of() : store.rosterDays(tenant, id, from, false);
        List<Cell> cells = store.cells(tenant, id);
        List<MemberIn> members = new ArrayList<>(store.members(tenant, id));

        Map<ScheduleDiff.Key, Cell> current = new HashMap<>();
        List<Cell> kept = new ArrayList<>();
        for (Cell c : cells) {
            if (c.date().isBefore(from)) kept.add(c);
            else current.put(new ScheduleDiff.Key(c.employeeId(), c.date()), c);
        }
        Set<UUID> onRoster = new HashSet<>(RosterService.memberIds(members));
        for (Day d : published) {
            Cell was = current.get(new ScheduleDiff.Key(d.employeeId(), d.date()));
            boolean same = was != null && java.util.Objects.equals(was.kind(), d.kind())
                    && java.util.Objects.equals(was.shiftPolicyId(), d.shiftPolicyId());
            // A published day keeps its "set by hand" mark when it is unchanged; one put back is marked,
            // so regenerating the pattern later doesn't silently overwrite a published day.
            kept.add(new Cell(d.employeeId(), d.date(), d.kind(), d.shiftPolicyId(), same ? was.edited() : true));
            if (onRoster.add(d.employeeId())) members.add(new MemberIn(d.employeeId(), 0));
        }
        store.replaceMembersAndCells(tenant, id, members, kept);
        store.markDiscarded(tenant, id, a);
        return rosters.detail(tenant, rosters.load(tenant, id, false), a, true);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** E3: these people's days already belong to other published rosters. One issue per person and roster. */
    Checks otherRosterChecks(UUID tenant, List<Day> clashes) {
        Map<String, List<Day>> byPersonAndRoster = new LinkedHashMap<>();
        for (Day d : clashes) byPersonAndRoster.computeIfAbsent(d.employeeId() + "|" + d.rosterId(), k -> new ArrayList<>()).add(d);
        Map<UUID, String> names = store.names(tenant, clashes.stream().map(Day::employeeId).distinct().toList());
        List<Issue> issues = new ArrayList<>();
        Set<UUID> people = new LinkedHashSet<>();
        for (List<Day> group : byPersonAndRoster.values()) {
            Day first = group.get(0);
            people.add(first.employeeId());
            List<LocalDate> dates = group.stream().map(Day::date).distinct().sorted().toList();
            String who = names.getOrDefault(first.employeeId(), "Someone");
            String roster = first.rosterName() == null ? "another roster" : "'" + first.rosterName() + "'";
            issues.add(new Issue("E3:" + first.employeeId() + ":" + first.rosterId(), IssueId.E3, Level.error, first.employeeId(),
                    dates, null, null, who + " is already on " + roster + " on " + ScheduleDiff.dates(dates) + "."));
        }
        String label = people.size() == 1 ? "1 person is already on another roster" : people.size() + " people are already on another roster";
        return new Checks(issues, List.of(), List.of(), List.of(new CheckSummary(IssueId.E3, Level.error, people.size(), label)));
    }

    /**
     * A schedule day belongs to the person's company ({@code schedule_days.company_id}): refuse (E2) a
     * publish that would give a day to someone who is no longer in the roster's company.
     */
    private void refuseOtherCompanies(UUID tenant, Header h, List<Cell> desired) {
        Map<UUID, List<LocalDate>> datesOf = new LinkedHashMap<>();
        for (Cell c : desired) datesOf.computeIfAbsent(c.employeeId(), k -> new ArrayList<>()).add(c.date());
        if (datesOf.isEmpty()) return;
        Map<UUID, UUID> companies = store.companies(tenant, datesOf.keySet());
        List<UUID> outside = datesOf.keySet().stream().filter(e -> !h.companyId().equals(companies.get(e))).toList();
        if (outside.isEmpty()) return;
        Map<UUID, String> names = store.names(tenant, outside);
        List<Issue> issues = new ArrayList<>();
        for (UUID e : outside) {
            issues.add(new Issue("E2:" + e, IssueId.E2, Level.error, e, datesOf.get(e), null, null,
                    names.getOrDefault(e, "Someone") + " is no longer in this company. Take them off the roster."));
        }
        String label = outside.size() == 1 ? "1 person is no longer in the company" : outside.size() + " people are no longer in the company";
        throw RosterChecksException.errors(new Checks(issues, List.of(), List.of(),
                List.of(new CheckSummary(IssueId.E2, Level.error, outside.size(), label))));
    }

    /** The changes as people are told them: the new shift spelled out ("B (Evening, 14:00–22:00)"). */
    private List<RosterPublishedEvent.Change> changesForPeople(UUID tenant, UUID companyId, List<DayChange> changes) {
        Map<UUID, ShiftCatalog.Shift> catalog = changes.isEmpty() ? Map.of() : shifts.ofCompany(tenant, companyId);
        List<RosterPublishedEvent.Change> out = new ArrayList<>(changes.size());
        for (DayChange c : changes) {
            ShiftCatalog.Shift s = c.newShiftPolicyId() == null ? null : catalog.get(c.newShiftPolicyId());
            out.add(new RosterPublishedEvent.Change(c.employeeId(), c.date(), c.change(),
                    c.change() == ChangeKind.REMOVED ? null : c.newKind(), s == null ? null : s.describe()));
        }
        return out;
    }

    /** "October 2026" for a monthly roster, else "1 Oct – 15 Oct 2026". */
    static String periodText(Header h) {
        if (h.periodType() == PeriodType.MONTH) return h.startDate().format(MONTH_YEAR);
        return h.startDate().getYear() == h.endDate().getYear()
                ? h.startDate().format(DAY_MONTH) + " – " + h.endDate().format(DAY_MONTH_YEAR)
                : h.startDate().format(DAY_MONTH_YEAR) + " – " + h.endDate().format(DAY_MONTH_YEAR);
    }
}
