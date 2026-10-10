package com.hrms.api.roster.plan;

import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.PlanCell;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PlanRow;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Test data for the planner: a company with four shifts (A 06–14, B 14–22, C 22–06 night, G 09–18), people,
 * and a mutable facts builder. Codes in patterns and expectations are the shift codes ("A A B B C C WO").
 */
final class PlanFixture {

    static final UUID COMPANY = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    static final UUID OTHER_COMPANY = UUID.fromString("cccccccc-0000-0000-0000-000000000002");
    static final UUID TECH = UUID.fromString("dddddddd-0000-0000-0000-000000000001");     // designation
    static final UUID HELPER = UUID.fromString("dddddddd-0000-0000-0000-000000000002");   // designation
    static final UUID DEPT = UUID.fromString("eeeeeeee-0000-0000-0000-000000000001");
    static final UUID DEPT_2 = UUID.fromString("eeeeeeee-0000-0000-0000-000000000002");
    static final UUID BRANCH = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");

    final Map<String, PlanFacts.Shift> shiftsByCode = new LinkedHashMap<>();
    final Map<UUID, PlanFacts.Shift> shifts = new LinkedHashMap<>();
    final Map<UUID, PlanFacts.Person> people = new LinkedHashMap<>();
    final Map<UUID, Map<LocalDate, BaselineDay>> baseline = new HashMap<>();
    final Map<LocalDate, String> holidays = new HashMap<>();
    final Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave = new HashMap<>();
    final Map<UUID, Map<LocalDate, PlanFacts.OtherDay>> other = new HashMap<>();
    final List<PlanFacts.PreviousRoster> previous = new ArrayList<>();
    final Map<UUID, String> designationNames = new HashMap<>(Map.of(TECH, "Technician", HELPER, "Helper"));
    final Map<UUID, String> departmentNames = new HashMap<>(Map.of(DEPT, "Technical", DEPT_2, "Stores"));
    final Map<UUID, String> branchNames = new HashMap<>(Map.of(BRANCH, "Building 1"));
    int minRest = PlanFacts.DEFAULT_MIN_REST_MINUTES;
    private int seq;

    PlanFixture() {
        shift("A", "Morning", "06:00", "14:00", "FIXED");
        shift("B", "Evening", "14:00", "22:00", "FIXED");
        shift("C", "Night", "22:00", "06:00", "NIGHT");
        shift("G", "General", "09:00", "18:00", "FIXED");
    }

    PlanFacts.Shift shift(String code, String name, String start, String end, String type) {
        UUID id = UUID.nameUUIDFromBytes(("shift-" + code + "-" + name).getBytes());
        PlanFacts.Shift s = new PlanFacts.Shift(id, COMPANY, code, name, LocalTime.parse(start), LocalTime.parse(end), type, true);
        shiftsByCode.put(code, s);
        shifts.put(id, s);
        return s;
    }

    void put(PlanFacts.Shift s) {
        shifts.put(s.id(), s);
        if (s.code() != null) shiftsByCode.put(s.code(), s);
    }

    UUID id(String code) {
        PlanFacts.Shift s = shiftsByCode.get(code);
        if (s == null) throw new IllegalArgumentException("no shift " + code);
        return s.id();
    }

    /** A token for a code: the shift id, "WO", or null for "-". */
    String token(String code) {
        if (code == null || code.equals("-")) return null;
        if (code.equals("WO")) return RosterContract.WO;
        return id(code).toString();
    }

    /** "A A B B C C WO" → pattern days. */
    List<PatternDay> pattern(String codes) {
        List<PatternDay> out = new ArrayList<>();
        for (String c : codes.trim().split("\\s+")) {
            out.add(c.equals("WO") ? new PatternDay(null, true) : new PatternDay(id(c), false));
        }
        return out;
    }

    UUID person(String name, UUID designation) {
        return person(name, designation, DEPT, null, null, null);
    }

    UUID person(String name, UUID designation, UUID department, UUID branch, LocalDate joined, LocalDate left) {
        UUID id = UUID.nameUUIDFromBytes(("person-" + name + "-" + (seq++)).getBytes());
        people.put(id, new PlanFacts.Person(id, COMPANY, name, "E" + seq, designation,
                designation == null ? null : designationNames.get(designation), department,
                department == null ? null : departmentNames.get(department), branch,
                branch == null ? null : branchNames.get(branch), joined, left));
        return id;
    }

    void replacePerson(PlanFacts.Person p) {
        people.put(p.id(), p);
    }

    /** The person's usual weekly offs are these weekdays on every date of {@code from..to}; no baseline shift. */
    void weeklyOffs(UUID person, LocalDate from, LocalDate to, DayOfWeek... offs) {
        List<DayOfWeek> list = Arrays.asList(offs);
        Map<LocalDate, BaselineDay> days = baseline.computeIfAbsent(person, k -> new HashMap<>());
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            BaselineDay prev = days.get(d);
            days.put(d, new BaselineDay(d, prev == null ? null : prev.shiftPolicyId(), list.contains(d.getDayOfWeek())));
        }
    }

    void baselineShift(UUID person, LocalDate d, String code, boolean weeklyOff) {
        baseline.computeIfAbsent(person, k -> new HashMap<>()).put(d, new BaselineDay(d, code == null ? null : id(code), weeklyOff));
    }

    void holiday(LocalDate d, String name) {
        holidays.put(d, name);
    }

    void leave(UUID person, LocalDate d, OverlayType type, String label, boolean halfDay) {
        leave.computeIfAbsent(person, k -> new HashMap<>()).put(d, new PlanFacts.Leave(type, label, halfDay));
    }

    void otherDay(UUID person, LocalDate d, UUID rosterId, String rosterName, String code) {
        other.computeIfAbsent(person, k -> new HashMap<>()).put(d, new PlanFacts.OtherDay(rosterId, rosterName,
                "WO".equals(code) ? "WO" : "SHIFT", "WO".equals(code) ? null : id(code)));
    }

    PlanFacts facts() {
        return new PlanFacts(COMPANY, shifts, people, baseline, holidays, leave, other, previous, designationNames,
                departmentNames, branchNames, minRest, null);
    }

    static RosterConfig config(List<PatternDay> pattern, WeeklyOffMode mode, StaggerMode stagger) {
        return new RosterConfig(null, pattern, true, mode, stagger, null, List.of(), List.of());
    }

    static RosterConfig config(List<PatternDay> pattern, boolean repeats, WeeklyOffMode mode, StaggerMode stagger,
                               UUID continueFrom, List<UUID> shiftIds) {
        return new RosterConfig(null, pattern, repeats, mode, stagger, continueFrom, shiftIds, List.of());
    }

    /** New members (offset −1 = "choose for me"). */
    static List<MemberIn> fresh(UUID... ids) {
        List<MemberIn> out = new ArrayList<>();
        for (UUID id : ids) out.add(new MemberIn(id, -1));
        return out;
    }

    static List<MemberIn> members(List<UUID> ids, int... offsets) {
        List<MemberIn> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) out.add(new MemberIn(ids.get(i), offsets[i]));
        return out;
    }

    static PlanRequest generate(LocalDate start, LocalDate end, RosterConfig config, List<MemberIn> members,
                                List<StaffingIn> staffing) {
        return new PlanRequest(start, end, null, null, null, config, members, staffing, List.of(), true, true);
    }

    static PlanRequest request(LocalDate start, LocalDate end, RosterConfig config, List<MemberIn> members,
                               List<StaffingIn> staffing, List<RowIn> rows, boolean regenerate, boolean keepEdits) {
        return new PlanRequest(start, end, null, null, null, config, members, staffing, rows, regenerate, keepEdits);
    }

    /** The response's rows as request rows (what the web sends back). */
    static List<RowIn> rowsOf(PlanResponse out) {
        List<RowIn> rows = new ArrayList<>();
        for (PlanRow r : out.rows()) {
            List<String> cells = new ArrayList<>();
            List<Integer> edited = new ArrayList<>();
            for (int i = 0; i < r.cells().size(); i++) {
                cells.add(r.cells().get(i).token());
                if (r.cells().get(i).edited()) edited.add(i);
            }
            rows.add(new RowIn(r.employeeId(), cells, edited));
        }
        return rows;
    }

    /** One row's cell codes joined by spaces, empty cells as "-". */
    static String codes(PlanRow row) {
        List<String> out = new ArrayList<>();
        for (PlanCell c : row.cells()) out.add(c.code() == null ? "-" : c.code());
        return String.join(" ", out);
    }

    /** The codes of every row on day index {@code i}, in row order. */
    static List<String> column(PlanResponse out, int i) {
        List<String> col = new ArrayList<>();
        for (PlanRow r : out.rows()) col.add(r.cells().get(i).code() == null ? "-" : r.cells().get(i).code());
        return col;
    }

    static PlanRow row(PlanResponse out, UUID employee) {
        return out.rows().stream().filter(r -> r.employeeId().equals(employee)).findFirst().orElseThrow();
    }

    /** A row whose cells are these codes ("A A - WO"), with the listed indexes edited. */
    RowIn rowOf(UUID employee, String codes, Integer... edited) {
        List<String> cells = new ArrayList<>();
        for (String c : codes.trim().split("\\s+")) cells.add(token(c));
        return new RowIn(employee, cells, Arrays.asList(edited));
    }
}
