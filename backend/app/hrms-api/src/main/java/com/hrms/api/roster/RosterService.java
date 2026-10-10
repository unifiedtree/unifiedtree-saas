package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeSource;
import com.hrms.api.roster.RosterContract.Checks;
import com.hrms.api.roster.RosterContract.DraftBody;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterDetail;
import com.hrms.api.roster.RosterContract.RosterHeader;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.RosterSummary;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.ScheduleChange;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterStore.Cell;
import com.hrms.api.roster.RosterStore.Header;
import com.hrms.api.roster.plan.RosterPlanner;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.RecordOwner;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Shift rosters: list, read, save a draft, delete a draft, the full check and the history (design
 * §1.5, endpoints 7 and 10–14, 17). Publishing and "Discard changes" are {@link RosterPublisher}.
 *
 * <p><b>Save</b> replaces the members, staffing, wizard choices and cells in one transaction and moves
 * the optimistic lock on ({@code lock_version}; a stale one is 409 {@code ROSTER_CHANGED}). It checks
 * the shape only: a period of at most 62 days, members once each, staffing lines once each, every day
 * inside the period and either {@code WO} or an active shift of the company. Planning rules are the
 * planner's ({@link RosterPlanning}); their result comes back as {@code plan}. On a PUBLISHED roster
 * the dates, department and building can't change ({@code ROSTER_PERIOD_LOCKED}), no day before today
 * (India time) can change ({@code ROSTER_PAST_DAYS}), and {@code has_unpublished_changes} says whether
 * the working copy now differs from what is published from today on.
 *
 * <p>Nothing here touches attendance, overtime, payroll or leave: a save writes only the roster's own
 * working copy, which attendance never reads.
 */
@Service
public class RosterService implements RosterDrafts {

    static final int MAX_DAYS = 62;
    static final int MAX_MEMBERS = 2000;
    static final int NAME_MAX = 120;
    /** The roster list's default window: today −90 … +120 days. */
    static final int LIST_DAYS_BACK = 90, LIST_DAYS_AHEAD = 120;

    private final RosterStore store;
    private final RosterTables tables;
    private final PlannerScope scope;
    private final ShiftCatalog shifts;
    private final RosterPlanning planning;
    private Clock clock = Clock.system(RosterAuth.IST);

    @Autowired(required = false)
    private CompanyAccessService companyAccess;

    public RosterService(RosterStore store, RosterTables tables, PlannerScope scope, ShiftCatalog shifts, RosterPlanning planning) {
        this.store = store;
        this.tables = tables;
        this.scope = scope;
        this.shifts = shifts;
        this.planning = planning;
    }

    /** Tests: a fixed "today". */
    void setClock(Clock clock) {
        this.clock = clock;
    }

    public LocalDate today() {
        return RosterAuth.today(clock);
    }

    // ── list and read ─────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<RosterSummary> list(Jwt jwt, UUID companyId, LocalDate from, LocalDate to) {
        tables.require();
        Actor a = scope.actor(jwt, companyId);
        LocalDate today = today();
        LocalDate f = from != null ? from : today.minusDays(LIST_DAYS_BACK);
        LocalDate t = to != null ? to : today.plusDays(LIST_DAYS_AHEAD);
        if (t.isBefore(f) || ChronoUnit.DAYS.between(f, t) > 731) {
            throw RosterErrors.rangeInvalid("Choose a period of up to two years, with the end after the start.");
        }
        boolean plan = RosterAuth.has(jwt, RosterAuth.PLAN);
        return store.list(TenantContext.requireTenantId(), a.companyId(), f, t, a.companyWide() ? null : a.headedDepartmentIds())
                .stream().map(h -> summary(h, a, plan)).toList();
    }

    @Transactional(readOnly = true)
    public RosterDetail get(Jwt jwt, UUID id) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Header h = load(tenant, id, false);
        Actor a = reader(jwt, h);
        return detail(tenant, h, a, RosterAuth.has(jwt, RosterAuth.PLAN));
    }

    /** The full check of the saved roster (the planner's checks, data checks included). */
    @Transactional(readOnly = true)
    public Checks check(Jwt jwt, UUID id) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Header h = load(tenant, id, false);
        Actor a = reader(jwt, h);
        List<MemberIn> members = store.members(tenant, id);
        PlanRequest in = planRequest(h, members, store.staffing(tenant, id), rows(h, members, store.cells(tenant, id)));
        return planning.plan(tenant, h.companyId(), in, a).map(PlanResponse::checks).orElseThrow(FeatureNotReady::new);
    }

    @Transactional(readOnly = true)
    public List<ScheduleChange> history(Jwt jwt, UUID id, UUID employeeId) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Header h = load(tenant, id, false);
        reader(jwt, h);
        List<RosterStore.HistoryRow> rows = store.history(tenant, id, employeeId);
        Set<UUID> ids = new HashSet<>();
        for (RosterStore.HistoryRow r : rows) {
            if (r.oldShiftPolicyId() != null) ids.add(r.oldShiftPolicyId());
            if (r.newShiftPolicyId() != null) ids.add(r.newShiftPolicyId());
        }
        Map<UUID, ShiftCatalog.Shift> catalog = shifts.byIds(tenant, ids);
        return rows.stream().map(r -> new ScheduleChange(r.id(), r.employeeId(), r.employeeName(), r.date(), r.change(),
                code(r.oldKind(), r.oldShiftPolicyId(), catalog), code(r.newKind(), r.newShiftPolicyId(), catalog),
                ChangeSource.valueOf(r.source()), r.rosterVersion(), r.changedByName(), r.changedAt(), r.note())).toList();
    }

    // ── save ──────────────────────────────────────────────────────────────────

    @Transactional
    public RosterDetail create(Jwt jwt, UUID companyId, DraftBody body) {
        tables.require();
        Actor a = scope.actor(jwt, companyId);
        return create(a.companyId(), body, a, SOURCE_PLANNER);
    }

    @Transactional
    public RosterDetail replace(Jwt jwt, UUID id, DraftBody body) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Header h = load(tenant, id, false);
        Actor a = editor(jwt, h);
        return replace(id, body, a);
    }

    @Override
    @Transactional
    public RosterDetail create(UUID companyId, DraftBody body, Actor a, String source) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        if (a == null || companyId == null || !companyId.equals(a.companyId())) {
            throw RosterErrors.scope("You can only plan rosters for the company you are working in.");
        }
        RosterSource src = SOURCE_IMPORT.equals(source) ? RosterSource.IMPORT : RosterSource.PLANNER;
        Valid v = validate(tenant, companyId, body, null, List.of());
        scope.check(a, v.draft().departmentId(), memberIds(v.members()));
        UUID id = store.insert(tenant, companyId, v.draft(), src, a);
        store.replaceWorkingCopy(tenant, id, v.members(), v.staffing(), v.cells());
        return detail(tenant, store.header(tenant, id, false), a, true);
    }

    @Override
    @Transactional
    public RosterDetail replace(UUID rosterId, DraftBody body, Actor a) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Header h = load(tenant, rosterId, true);
        if (a == null || !h.companyId().equals(a.companyId())) {
            throw RosterErrors.scope("This roster belongs to another company.");
        }
        if (!PlannerScopeService.covers(a, h.departmentId())) throw outsideScope();
        if (body == null || body.lockVersion() == null) throw RosterErrors.invalid("Send the roster's lockVersion with the change.");
        if (body.lockVersion() != h.lockVersion()) throw RosterErrors.changed();
        List<Cell> before = store.cells(tenant, rosterId);
        Valid v = validate(tenant, h.companyId(), body, h, before);
        scope.check(a, v.draft().departmentId(), memberIds(v.members()));
        boolean unpublished = false;
        if (h.status() == RosterStatus.PUBLISHED) {
            RosterStore.Draft d = v.draft();
            if (d.periodType() != h.periodType() || !d.startDate().equals(h.startDate()) || !d.endDate().equals(h.endDate())
                    || !Objects.equals(d.departmentId(), h.departmentId()) || !Objects.equals(d.branchId(), h.branchId())) {
                throw RosterErrors.periodLocked();
            }
            LocalDate from = publishFrom(h);
            refusePastChanges(tenant, before, v.cells(), from);
            unpublished = !ScheduleDiff.between(desiredFrom(v.cells(), v.members(), from, h.endDate()),
                    store.rosterDays(tenant, rosterId, from, false)).isEmpty();
        }
        if (store.update(tenant, rosterId, h.lockVersion(), v.draft(), unpublished, a) == 0) throw RosterErrors.changed();
        store.replaceWorkingCopy(tenant, rosterId, v.members(), v.staffing(), v.cells());
        return detail(tenant, store.header(tenant, rosterId, false), a, true);
    }

    @Transactional
    public void delete(Jwt jwt, UUID id) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        Header h = load(tenant, id, true);
        editor(jwt, h);
        if (h.version() > 0 || !store.deleteDraft(tenant, id)) throw RosterErrors.published();
    }

    // ── shared with the publisher ─────────────────────────────────────────────

    public Header load(UUID tenant, UUID id, boolean forUpdate) {
        Header h = store.header(tenant, id, forUpdate);
        if (h == null) throw new ResourceNotFoundException("That roster wasn't found.");
        return h;
    }

    /** A planner of the roster's company who covers its department (company access first). */
    public Actor reader(Jwt jwt, Header h) {
        if (companyAccess != null) companyAccess.checkRecord("Roster", h.id(), () -> RecordOwner.ofCompany(h.companyId()));
        Actor a = scope.actor(jwt, h.companyId());
        if (!PlannerScopeService.covers(a, h.departmentId())) throw outsideScope();
        return a;
    }

    /** {@link #reader}, holding {@code attendance.roster.plan}. */
    public Actor editor(Jwt jwt, Header h) {
        Actor a = reader(jwt, h);
        if (!RosterAuth.has(jwt, RosterAuth.PLAN)) throw RosterErrors.scope("Changing a roster needs Plan shift rosters.");
        return a;
    }

    private static com.hrms.core.exception.HrmsException outsideScope() {
        return RosterErrors.scope("This roster is outside the departments you head. HR plans it.");
    }

    public RosterDetail detail(UUID tenant, Header h, Actor a, boolean plan) {
        List<MemberIn> members = store.members(tenant, h.id());
        List<StaffingIn> staffing = store.staffing(tenant, h.id());
        List<RowIn> rows = rows(h, members, store.cells(tenant, h.id()));
        PlanResponse planned = planning.plan(tenant, h.companyId(), planRequest(h, members, staffing, rows), a).orElse(null);
        RosterSummary s = summary(h, a, plan);
        RosterHeader header = new RosterHeader(s.id(), s.companyId(), s.name(), s.periodType(), s.startDate(), s.endDate(),
                s.departmentId(), s.departmentName(), s.branchId(), s.branchName(), s.status(), s.source(),
                s.hasUnpublishedChanges(), s.version(), s.memberCount(), s.publishedByName(), s.publishedAt(),
                s.updatedByName(), s.updatedAt(), s.canEdit(), s.canPublish(), h.lockVersion(), h.config());
        return new RosterDetail(header, members, staffing, rows, planned);
    }

    static RosterSummary summary(Header h, Actor a, boolean plan) {
        boolean covers = PlannerScopeService.covers(a, h.departmentId());
        return new RosterSummary(h.id(), h.companyId(), h.name(), h.periodType(), h.startDate(), h.endDate(),
                h.departmentId(), h.departmentName(), h.branchId(), h.branchName(), h.status(), h.source(),
                h.hasUnpublishedChanges(), h.version(), h.memberCount(), h.publishedByName(), h.publishedAt(),
                h.updatedByName(), h.updatedAt(), plan && covers, a.canPublish() && covers);
    }

    /** The saved state as the planner's input: no regeneration, edits kept. */
    static PlanRequest planRequest(Header h, List<MemberIn> members, List<StaffingIn> staffing, List<RowIn> rows) {
        return new PlanRequest(h.startDate(), h.endDate(), h.departmentId(), h.branchId(), h.id(), h.config(),
                members, staffing, rows, false, true);
    }

    /** One row per member, in member order: {@code cells[i]} = the token of {@code startDate + i}. */
    static List<RowIn> rows(Header h, List<MemberIn> members, List<Cell> cells) {
        int days = (int) ChronoUnit.DAYS.between(h.startDate(), h.endDate()) + 1;
        Map<UUID, String[]> tokens = new LinkedHashMap<>();
        Map<UUID, List<Integer>> edited = new HashMap<>();
        for (MemberIn m : members) {
            tokens.put(m.employeeId(), new String[days]);
            edited.put(m.employeeId(), new ArrayList<>());
        }
        for (Cell c : cells) {
            String[] row = tokens.get(c.employeeId());
            int i = (int) ChronoUnit.DAYS.between(h.startDate(), c.date());
            if (row == null || i < 0 || i >= days) continue;
            row[i] = c.token();
            if (c.edited()) edited.get(c.employeeId()).add(i);
        }
        List<RowIn> out = new ArrayList<>(members.size());
        for (MemberIn m : members) {
            out.add(new RowIn(m.employeeId(), java.util.Arrays.asList(tokens.get(m.employeeId())), edited.get(m.employeeId())));
        }
        return out;
    }

    /** The first day a publish writes: today (India time), or the roster's start when that is later. */
    public LocalDate publishFrom(Header h) {
        LocalDate today = today();
        return h.startDate().isAfter(today) ? h.startDate() : today;
    }

    /** The members' cells in {@code from..to}: what a publish wants the published schedule to be. */
    static List<Cell> desiredFrom(List<Cell> cells, List<MemberIn> members, LocalDate from, LocalDate to) {
        Set<UUID> in = new HashSet<>(memberIds(members));
        return cells.stream().filter(c -> in.contains(c.employeeId()) && !c.date().isBefore(from) && !c.date().isAfter(to)).toList();
    }

    static List<UUID> memberIds(List<MemberIn> members) {
        return members.stream().map(MemberIn::employeeId).toList();
    }

    /** A cell's code for people: {@code WO}, the shift's code (or its name's first letters), or null. */
    static String code(String kind, UUID shiftPolicyId, Map<UUID, ShiftCatalog.Shift> catalog) {
        if (kind == null) return null;
        if (RosterStore.WO.equals(kind)) return RosterStore.WO;
        ShiftCatalog.Shift s = shiftPolicyId == null ? null : catalog.get(shiftPolicyId);
        return s == null ? null : s.label();
    }

    // ── the shape of a save ───────────────────────────────────────────────────

    record Valid(RosterStore.Draft draft, List<MemberIn> members, List<StaffingIn> staffing, List<Cell> cells) {}

    private static final DateTimeFormatter MONTH_YEAR = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_MONTH_YEAR = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    /**
     * Checks the body's shape and returns what to write. {@code existing}/{@code before}: the roster and
     * its current cells when replacing (a day left as it was is accepted even if its shift has since
     * been switched off, so an older draft stays saveable; the planner's check E1 still blocks its
     * publish).
     */
    Valid validate(UUID tenant, UUID companyId, DraftBody body, Header existing, List<Cell> before) {
        if (body == null) throw RosterErrors.invalid("Send the roster.");
        if (body.periodType() == null) throw RosterErrors.rangeInvalid("Choose a month or a date range.");
        LocalDate start = body.startDate(), end = body.endDate();
        RosterPlanner.requireValidRange(start, end);   // the one range rule (store, import, preview)
        int days = (int) ChronoUnit.DAYS.between(start, end) + 1;
        if (body.periodType() == PeriodType.MONTH
                && (start.getDayOfMonth() != 1 || !end.equals(start.withDayOfMonth(start.lengthOfMonth())))) {
            throw RosterErrors.rangeInvalid("A monthly roster runs from the first to the last day of one month.");
        }
        UUID dept = body.departmentId(), branch = body.branchId();
        if (dept != null && !store.departmentOf(tenant, companyId, dept)) throw RosterErrors.invalid("That department isn't in this company.");
        if (branch != null && !store.branchOf(tenant, companyId, branch)) throw RosterErrors.invalid("That building isn't in this company.");

        String name = body.name() == null ? "" : body.name().replaceAll("\\s+", " ").trim();
        if (name.isEmpty()) name = defaultName(tenant, body.periodType(), start, end, dept, branch);
        if (name.length() > NAME_MAX) throw RosterErrors.invalid("Give the roster a name of at most " + NAME_MAX + " characters.");

        RosterConfig config = RosterStore.normalize(body.config());
        if (config.pattern().size() > MAX_DAYS) throw RosterErrors.invalid("A pattern has at most " + MAX_DAYS + " days.");
        for (PatternDay p : config.pattern()) {
            if ((p.shiftPolicyId() == null) != p.weeklyOff()) throw RosterErrors.invalid("Each pattern day is exactly one shift or WO.");
        }

        List<MemberIn> members = body.members() == null ? List.of() : body.members();
        if (members.size() > MAX_MEMBERS) throw RosterErrors.invalid("A roster has at most " + MAX_MEMBERS + " people.");
        Set<UUID> seen = new LinkedHashSet<>();
        List<MemberIn> cleanMembers = new ArrayList<>(members.size());
        for (MemberIn m : members) {
            if (m == null || m.employeeId() == null) throw RosterErrors.invalid("Each person on the roster needs an employee id.");
            if (!seen.add(m.employeeId())) throw RosterErrors.invalid("Someone is on the roster twice. Each person appears once.");
            if (m.rotationOffset() < 0 || m.rotationOffset() > 61) throw RosterErrors.invalid("A start day in the pattern is from 0 to 61.");
            cleanMembers.add(new MemberIn(m.employeeId(), m.rotationOffset()));
        }

        Map<UUID, ShiftCatalog.Shift> companyShifts = shifts.ofCompany(tenant, companyId);
        List<StaffingIn> staffing = body.staffing() == null ? List.of() : body.staffing();
        Set<String> pairs = new HashSet<>();
        List<StaffingIn> cleanStaffing = new ArrayList<>(staffing.size());
        for (StaffingIn s : staffing) {
            if (s == null || s.designationId() == null || s.shiftPolicyId() == null) {
                throw RosterErrors.invalid("Each staffing line needs a designation and a shift.");
            }
            if (s.required() < 0 || s.required() > 999) throw RosterErrors.invalid("People needed is from 0 to 999.");
            if (!companyShifts.containsKey(s.shiftPolicyId())) throw RosterErrors.invalid("A staffing line uses a shift of another company.");
            if (!pairs.add(s.designationId() + "|" + s.shiftPolicyId())) {
                throw RosterErrors.invalid("Each designation and shift has one staffing line.");
            }
            cleanStaffing.add(new StaffingIn(s.designationId(), s.shiftPolicyId(), s.required()));
        }

        Map<String, Cell> previous = new HashMap<>();
        for (Cell c : before) previous.put(c.employeeId() + "|" + c.date(), c);
        List<RowIn> rows = body.rows() == null ? List.of() : body.rows();
        Set<UUID> withRow = new HashSet<>();
        List<Cell> cells = new ArrayList<>();
        Map<UUID, Integer> inactive = new LinkedHashMap<>();
        for (RowIn r : rows) {
            if (r == null || r.employeeId() == null || !seen.contains(r.employeeId())) {
                throw RosterErrors.invalid("Every row of days belongs to someone on the roster.");
            }
            if (!withRow.add(r.employeeId())) throw RosterErrors.invalid("Each person has one row of days.");
            List<String> tokens = r.cells() == null ? List.of() : r.cells();
            if (tokens.size() > days) throw RosterErrors.invalid("A row has more days than the roster's period.");
            Set<Integer> edited = new HashSet<>();
            if (r.edited() != null) {
                for (Integer i : r.edited()) {
                    if (i == null || i < 0 || i >= days) throw RosterErrors.invalid("An edited day is outside the roster's period.");
                    edited.add(i);
                }
            }
            for (int i = 0; i < tokens.size(); i++) {
                String t = tokens.get(i);
                if (t == null || t.isBlank()) continue;
                LocalDate date = start.plusDays(i);
                if (RosterStore.WO.equalsIgnoreCase(t.trim())) {
                    cells.add(new Cell(r.employeeId(), date, RosterStore.WO, null, edited.contains(i)));
                    continue;
                }
                UUID shiftId;
                try {
                    shiftId = UUID.fromString(t.trim());
                } catch (IllegalArgumentException e) {
                    throw RosterErrors.invalid("A day holds \"" + t + "\": use WO or a shift of this company.");
                }
                ShiftCatalog.Shift s = companyShifts.get(shiftId);
                if (s == null) throw RosterErrors.invalid("A day uses a shift that isn't one of this company's.");
                if (!s.active()) {
                    Cell was = previous.get(r.employeeId() + "|" + date);
                    boolean unchanged = was != null && RosterStore.SHIFT.equals(was.kind()) && shiftId.equals(was.shiftPolicyId());
                    if (!unchanged) inactive.merge(shiftId, 1, Integer::sum);
                }
                cells.add(new Cell(r.employeeId(), date, RosterStore.SHIFT, shiftId, edited.contains(i)));
            }
        }
        if (!inactive.isEmpty()) {
            Map.Entry<UUID, Integer> first = inactive.entrySet().iterator().next();
            ShiftCatalog.Shift s = companyShifts.get(first.getKey());
            throw RosterErrors.invalid("Shift " + s.label() + " (" + s.name() + ") is no longer in use. Choose another shift for "
                    + first.getValue() + (first.getValue() == 1 ? " day." : " days."));
        }
        RosterStore.Draft draft = new RosterStore.Draft(name, body.periodType(), start, end, dept, branch, config);
        return new Valid(draft, cleanMembers, cleanStaffing, cells);
    }

    /** On a published roster, no day before {@code from} (today) may change: same value, or refused. */
    private void refusePastChanges(UUID tenant, List<Cell> before, List<Cell> after, LocalDate from) {
        Map<String, String> was = new HashMap<>(), now = new HashMap<>();
        Map<String, Cell> any = new HashMap<>();
        for (Cell c : before) if (c.date().isBefore(from)) { was.put(key(c), c.token()); any.put(key(c), c); }
        for (Cell c : after) if (c.date().isBefore(from)) { now.put(key(c), c.token()); any.putIfAbsent(key(c), c); }
        Set<String> keys = new HashSet<>(was.keySet());
        keys.addAll(now.keySet());
        List<Cell> changed = new ArrayList<>();
        for (String k : keys) if (!Objects.equals(was.get(k), now.get(k))) changed.add(any.get(k));
        if (changed.isEmpty()) return;
        changed.sort(java.util.Comparator.comparing(Cell::date));
        Cell first = changed.get(0);
        String who = store.names(tenant, List.of(first.employeeId())).getOrDefault(first.employeeId(), "Someone");
        throw RosterErrors.pastDays("Days before today can't change once a roster is published: " + who + " on "
                + first.date().format(DAY_MONTH) + (changed.size() > 1 ? " and " + (changed.size() - 1) + " more." : "."));
    }

    private static String key(Cell c) {
        return c.employeeId() + "|" + c.date();
    }

    /** "October 2026", or "1 Oct – 15 Oct 2026", then " · Technical" for the department or building. */
    private String defaultName(UUID tenant, PeriodType type, LocalDate start, LocalDate end, UUID dept, UUID branch) {
        String period = type == PeriodType.MONTH ? start.format(MONTH_YEAR)
                : start.getYear() == end.getYear() ? start.format(DAY_MONTH) + " – " + end.format(DAY_MONTH_YEAR)
                : start.format(DAY_MONTH_YEAR) + " – " + end.format(DAY_MONTH_YEAR);
        String scopeName = store.scopeName(tenant, dept, branch);
        String name = scopeName == null ? period : period + " · " + scopeName;
        return name.length() > NAME_MAX ? name.substring(0, NAME_MAX).trim() : name;
    }

    /** The people of {@code cells}, in first-seen order. */
    static Collection<UUID> distinctPeople(Collection<Cell> cells) {
        Set<UUID> out = new LinkedHashSet<>();
        for (Cell c : cells) out.add(c.employeeId());
        return out;
    }
}
