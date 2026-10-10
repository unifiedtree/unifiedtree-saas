package com.hrms.api.roster;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.RosterSource;
import com.hrms.api.roster.RosterContract.RosterStatus;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterStore.Cell;
import com.hrms.api.roster.RosterStore.Day;
import com.hrms.api.roster.RosterStore.DayChange;
import com.hrms.api.roster.RosterStore.Header;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * In-memory stand-ins for the database side of shift planning, so the store's rules (save, publish,
 * discard, scope) are tested as plain JUnit: a {@link RosterStore} kept in maps, a shift catalog, a
 * planner that answers what the test says, and tables that are always there.
 */
final class RosterFakes {

    private RosterFakes() {}

    static final ObjectMapper JSON = JsonMapper.builder().findAndAddModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();

    static Jwt jwt(UUID userId, UUID employeeId, String... permissions) {
        Jwt.Builder b = Jwt.withTokenValue("test").header("alg", "none").subject(userId.toString())
                .claim("permissions", List.of(permissions)).claim("email", "planner@example.invalid");
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    /** Tables always there. */
    static final class Tables extends RosterTables {
        Tables() { super(null); }
        @Override public boolean ready() { return true; }
    }

    /** A company's shifts, by id. */
    static final class Shifts extends ShiftCatalog {
        final Map<UUID, Shift> all = new LinkedHashMap<>();
        Shifts() { super(null); }

        Shift add(UUID company, String code, String name, String start, String end, String type, boolean active) {
            Shift s = new Shift(UUID.randomUUID(), company, code, name, LocalTime.parse(start), LocalTime.parse(end), type, active);
            all.put(s.id(), s);
            return s;
        }

        @Override public Map<UUID, Shift> ofCompany(UUID tenantId, UUID companyId) {
            Map<UUID, Shift> out = new LinkedHashMap<>();
            all.values().stream().filter(s -> s.companyId().equals(companyId)).forEach(s -> out.put(s.id(), s));
            return out;
        }

        @Override public Map<UUID, Shift> byIds(UUID tenantId, Collection<UUID> ids) {
            Map<UUID, Shift> out = new LinkedHashMap<>();
            for (UUID id : ids) if (all.containsKey(id)) out.put(id, all.get(id));
            return out;
        }
    }

    /** The planner: answers what {@link #answer} gives (empty = not in the build). */
    static final class Planning extends RosterPlanning {
        Function<PlanRequest, Optional<PlanResponse>> answer = in -> Optional.empty();
        final List<PlanRequest> asked = new ArrayList<>();
        Planning() { super(null); }
        final List<Actor> askedAs = new ArrayList<>();
        @Override public Optional<PlanResponse> plan(UUID tenantId, UUID companyId, PlanRequest in, Actor actor) {
            asked.add(in);
            askedAs.add(actor);
            return answer.apply(in);
        }
    }

    /** Rosters, working copies and the published schedule, in memory, with the same contract as the JDBC store. */
    static final class Store extends RosterStore {
        final Map<UUID, Header> headers = new LinkedHashMap<>();
        final Map<UUID, List<MemberIn>> members = new HashMap<>();
        final Map<UUID, List<StaffingIn>> staffing = new HashMap<>();
        final Map<UUID, List<Cell>> cells = new HashMap<>();
        /** The published schedule: person|date → day (one per person and date, as the primary key). */
        final Map<String, Day> days = new LinkedHashMap<>();
        final List<DayChange> history = new ArrayList<>();
        final List<Integer> historyVersions = new ArrayList<>();
        final List<String> historyNotes = new ArrayList<>();
        final Map<UUID, UUID> companyOf = new HashMap<>();
        final Map<UUID, String> nameOf = new HashMap<>();
        final Set<UUID> departments = new java.util.HashSet<>();
        /** Days another roster takes "at the same moment": put in just before ADDED days are written. */
        final List<Day> raceDays = new ArrayList<>();

        Store() { super(null, JSON); }

        @Override public Header header(UUID tenant, UUID id, boolean forUpdate) {
            Header h = headers.get(id);
            if (h == null) return null;
            return withCount(h);
        }

        private Header withCount(Header h) {
            int n = members.getOrDefault(h.id(), List.of()).size();
            return new Header(h.id(), h.companyId(), h.name(), h.periodType(), h.startDate(), h.endDate(), h.departmentId(),
                    h.departmentName(), h.branchId(), h.branchName(), h.status(), h.source(), h.hasUnpublishedChanges(),
                    h.version(), h.lockVersion(), h.config(), h.publishedByName(), h.publishedAt(), h.updatedByName(),
                    h.updatedAt(), n);
        }

        @Override public List<Header> list(UUID tenant, UUID companyId, LocalDate from, LocalDate to, Set<UUID> depts) {
            return headers.values().stream()
                    .filter(h -> h.companyId().equals(companyId) && !h.startDate().isAfter(to) && !h.endDate().isBefore(from))
                    .filter(h -> depts == null || (h.departmentId() != null && depts.contains(h.departmentId())))
                    .map(this::withCount).toList();
        }

        @Override public UUID insert(UUID tenant, UUID companyId, Draft d, RosterSource source, Actor a) {
            UUID id = UUID.randomUUID();
            headers.put(id, new Header(id, companyId, d.name(), d.periodType(), d.startDate(), d.endDate(), d.departmentId(), null,
                    d.branchId(), null, RosterStatus.DRAFT, source, false, 0, 0, normalize(d.config()), null, null, a.name(),
                    Instant.now(), 0));
            return id;
        }

        @Override public int update(UUID tenant, UUID id, int lockVersion, Draft d, boolean unpublished, Actor a) {
            Header h = headers.get(id);
            if (h == null || h.lockVersion() != lockVersion) return 0;
            headers.put(id, new Header(id, h.companyId(), d.name(), d.periodType(), d.startDate(), d.endDate(), d.departmentId(), null,
                    d.branchId(), null, h.status(), h.source(), unpublished, h.version(), h.lockVersion() + 1, normalize(d.config()),
                    h.publishedByName(), h.publishedAt(), a.name(), Instant.now(), 0));
            return 1;
        }

        @Override public void markPublished(UUID tenant, UUID id, int version, Actor a) {
            Header h = headers.get(id);
            headers.put(id, new Header(id, h.companyId(), h.name(), h.periodType(), h.startDate(), h.endDate(), h.departmentId(), null,
                    h.branchId(), null, RosterStatus.PUBLISHED, h.source(), false, version, h.lockVersion() + 1, h.config(),
                    a.name(), Instant.now(), h.updatedByName(), h.updatedAt(), 0));
        }

        @Override public void markDiscarded(UUID tenant, UUID id, Actor a) {
            Header h = headers.get(id);
            headers.put(id, new Header(id, h.companyId(), h.name(), h.periodType(), h.startDate(), h.endDate(), h.departmentId(), null,
                    h.branchId(), null, h.status(), h.source(), false, h.version(), h.lockVersion() + 1, h.config(),
                    h.publishedByName(), h.publishedAt(), a.name(), Instant.now(), 0));
        }

        @Override public boolean deleteDraft(UUID tenant, UUID id) {
            Header h = headers.get(id);
            if (h == null || h.version() > 0) return false;
            headers.remove(id);
            members.remove(id);
            staffing.remove(id);
            cells.remove(id);
            return true;
        }

        @Override public List<MemberIn> members(UUID tenant, UUID rosterId) {
            return new ArrayList<>(members.getOrDefault(rosterId, List.of()));
        }

        @Override public List<StaffingIn> staffing(UUID tenant, UUID rosterId) {
            return new ArrayList<>(staffing.getOrDefault(rosterId, List.of()));
        }

        @Override public List<Cell> cells(UUID tenant, UUID rosterId) {
            return new ArrayList<>(cells.getOrDefault(rosterId, List.of()));
        }

        @Override public void replaceWorkingCopy(UUID tenant, UUID rosterId, List<MemberIn> m, List<StaffingIn> s, List<Cell> c) {
            members.put(rosterId, new ArrayList<>(m));
            staffing.put(rosterId, new ArrayList<>(s));
            cells.put(rosterId, new ArrayList<>(c));
        }

        @Override public void replaceMembersAndCells(UUID tenant, UUID rosterId, List<MemberIn> m, List<Cell> c) {
            members.put(rosterId, new ArrayList<>(m));
            cells.put(rosterId, new ArrayList<>(c));
        }

        @Override public List<Day> rosterDays(UUID tenant, UUID rosterId, LocalDate from, boolean forUpdate) {
            return days.values().stream().filter(d -> d.rosterId().equals(rosterId) && !d.date().isBefore(from)).toList();
        }

        @Override public List<Day> otherRosterDays(UUID tenant, Collection<UUID> employees, LocalDate from, LocalDate to, UUID rosterId,
                                                   boolean forUpdate) {
            return days.values().stream().filter(d -> employees.contains(d.employeeId()) && !d.rosterId().equals(rosterId)
                    && !d.date().isBefore(from) && !d.date().isAfter(to)).toList();
        }

        @Override public List<Day> days(UUID tenant, Collection<UUID> employees, LocalDate from, LocalDate to) {
            return days.values().stream().filter(d -> employees.contains(d.employeeId()) && !d.date().isBefore(from)
                    && !d.date().isAfter(to)).toList();
        }

        @Override public List<DayChange> applyChanges(UUID tenant, UUID companyId, UUID rosterId, int version, String source,
                                                      List<DayChange> changes, Actor a, String note) {
            for (Day d : raceDays) days.put(d.employeeId() + "|" + d.date(), d);
            raceDays.clear();
            List<DayChange> refused = new ArrayList<>();
            for (DayChange c : changes) {
                String k = c.employeeId() + "|" + c.date();
                if (c.change() == RosterContract.ChangeKind.ADDED && days.containsKey(k)) refused.add(c);
            }
            if (!refused.isEmpty()) return refused;
            String name = headers.get(rosterId).name();
            for (DayChange c : changes) {
                String k = c.employeeId() + "|" + c.date();
                switch (c.change()) {
                    case ADDED, CHANGED -> days.put(k, new Day(c.employeeId(), c.date(), c.newKind(), c.newShiftPolicyId(), rosterId, name, version));
                    case REMOVED -> days.remove(k);
                }
                history.add(c);
                historyVersions.add(version);
                historyNotes.add(note);
            }
            return refused;
        }

        @Override public Map<UUID, UUID> companies(UUID tenant, Collection<UUID> employees) {
            Map<UUID, UUID> out = new HashMap<>();
            for (UUID e : employees) if (companyOf.containsKey(e)) out.put(e, companyOf.get(e));
            return out;
        }

        @Override public Map<UUID, String> names(UUID tenant, Collection<UUID> employees) {
            Map<UUID, String> out = new HashMap<>();
            for (UUID e : employees) if (nameOf.containsKey(e)) out.put(e, nameOf.get(e));
            return out;
        }

        @Override public boolean departmentOf(UUID tenant, UUID companyId, UUID departmentId) {
            return departments.contains(departmentId);
        }

        @Override public boolean branchOf(UUID tenant, UUID companyId, UUID branchId) {
            return true;
        }

        @Override public String scopeName(UUID tenant, UUID departmentId, UUID branchId) {
            return departmentId == null ? null : "Technical";
        }

        /** Another roster's published day, for clash tests. */
        void otherRosterDay(UUID employee, LocalDate date, UUID otherRoster, String otherName) {
            days.put(employee + "|" + date, new Day(employee, date, SHIFT, UUID.randomUUID(), otherRoster, otherName, 1));
        }
    }
}
