package com.hrms.api.roster.plan;

import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.CheckSummary;
import com.hrms.api.roster.RosterContract.Checks;
import com.hrms.api.roster.RosterContract.Issue;
import com.hrms.api.roster.RosterContract.IssueId;
import com.hrms.api.roster.RosterContract.Level;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The schedule checks of design §1.4, worked out from the grid and the facts only (no database). Errors block
 * publishing, warnings need "Publish with N warnings" ticked, infos never block.
 *
 * <p>A day the person does not work although a cell may say so (a holiday, or approved full-day leave) is not a
 * working day for the rest (W4), overlap (W6) and night (W5) checks, the same way coverage leaves it out. Days of
 * another published roster count for the rest check and are not "nothing planned".
 */
final class RosterChecks {

    private RosterChecks() {}

    /** W2: this many days in a row with no weekly off, holiday or leave (fixed at 7 in v1). */
    static final int MAX_DAYS_WITHOUT_OFF = 7;

    /** W7's level: people with no designation are a warning (pending-owner default 8; one constant to flip). */
    static final Level W7_LEVEL = Level.warning;

    /** The "Schedule check" lines shown even when nothing is wrong (the owner's list). */
    static final Set<IssueId> ALWAYS_LISTED = EnumSet.of(IssueId.E3, IssueId.W1, IssueId.W2, IssueId.W3,
            IssueId.W4, IssueId.W5, IssueId.W6);

    record Result(Checks checks, List<List<String>> cellIssues) {
        /** The issue keys of one cell. */
        List<String> of(int m, int i, int days) {
            List<String> keys = cellIssues.get(m * days + i);
            return keys == null ? List.of() : keys;
        }
    }

    static Result run(Grid g, Coverage.Result cov) {
        Builder b = new Builder(g);
        unusableShifts(g, b);          // E1
        outOfScope(g, b);              // E2
        otherRosters(g, b);            // E3
        outsideEmployment(g, b);       // E4
        outsideHeadedDepartments(g, b); // E5
        nothingPlanned(g, b);          // W1
        noWeeklyOff(g, b);             // W2
        for (Coverage.Gap gap : cov.shorts()) b.add(IssueId.W3, Level.warning, null, gap.dates(), gap.shiftPolicyId(),
                gap.designationId(), coverageMessage(g, gap, gap.minScheduled(), gap.maxScheduled()), List.of());
        restAndOverlap(g, b);          // W4, W6
        if (!cov.nightUncovered().isEmpty()) {
            int n = cov.nightUncovered().size();
            b.add(IssueId.W5, Level.warning, null, cov.nightUncovered(), null, null,
                    "No one on a night shift on " + n + (n == 1 ? " date: " : " dates: ") + ranges(cov.nightUncovered()) + ".",
                    List.of());
        }
        noDesignation(g, b);           // W7
        onHolidayOrLeave(g, b);        // I1
        for (Coverage.Gap gap : cov.overs()) b.add(IssueId.I2, Level.info, null, gap.dates(), gap.shiftPolicyId(),
                gap.designationId(), coverageMessage(g, gap, gap.minScheduled(), gap.maxScheduled()), List.of());
        return b.build(cov);
    }

    // ── E1: a shift that is deleted, inactive, of another company or unknown ──────────────────────────────
    private static void unusableShifts(Grid g, Builder b) {
        Map<String, List<int[]>> byToken = new LinkedHashMap<>();
        for (int m = 0; m < g.members.size(); m++) {
            for (int i = 0; i < g.days(); i++) {
                String t = g.tokens[m][i];
                if (t == null || Grid.isWo(t)) continue;
                PlanFacts.Shift s = g.shift(t);
                boolean usable = s != null && s.active() && g.facts.companyId() != null && g.facts.companyId().equals(s.companyId());
                if (!usable) byToken.computeIfAbsent(t, k -> new ArrayList<>()).add(new int[]{m, i});
            }
        }
        for (Map.Entry<String, List<int[]>> e : byToken.entrySet()) {
            List<int[]> cells = e.getValue();
            PlanFacts.Shift s = g.shift(e.getKey());
            int n = cells.size();
            String days = n + (n == 1 ? " day" : " days");
            String message;
            if (s == null) message = "A shift that doesn't exist any more is planned on " + days + ". Choose another shift.";
            else if (!s.active()) message = "Shift " + codeAndName(s) + " was deleted. Choose another shift for " + days + ".";
            else message = "Shift " + codeAndName(s) + " belongs to another company. Choose another shift for " + days + ".";
            b.add(IssueId.E1, Level.error, null, datesOf(g, cells), Grid.shiftId(e.getKey()), null, message, cells);
        }
    }

    // ── E2: a member who is not in the roster's company or scope any more ────────────────────────────────
    private static void outOfScope(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            PlanFacts.Person p = g.persons.get(m);
            String message = null;
            if (p == null) {
                message = "A person on this roster was not found. Remove them from the roster.";
            } else if (g.facts.companyId() == null || !g.facts.companyId().equals(p.companyId())) {
                message = p.name() + " is no longer in this company.";
            } else if (g.departmentId != null && !g.departmentId.equals(p.departmentId())) {
                message = p.name() + " is no longer in " + nameOr(g.facts.departmentNames().get(g.departmentId), "this department") + ".";
            } else if (g.branchId != null && !g.branchId.equals(p.branchId())) {
                message = p.name() + " is no longer at " + nameOr(g.facts.branchNames().get(g.branchId), "this building") + ".";
            }
            if (message != null) b.add(IssueId.E2, Level.error, g.members.get(m), List.of(), null, null, message, List.of());
        }
    }

    // ── E3: a day another published roster already plans for the person ──────────────────────────────────
    private static void otherRosters(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            Map<UUID, List<int[]>> byRoster = new LinkedHashMap<>();
            Map<UUID, String> names = new LinkedHashMap<>();
            for (int i = 0; i < g.days(); i++) {
                PlanFacts.OtherDay o = g.other[m][i];
                if (o == null || g.tokens[m][i] == null) continue;
                byRoster.computeIfAbsent(o.rosterId(), k -> new ArrayList<>()).add(new int[]{m, i});
                names.putIfAbsent(o.rosterId(), o.rosterName());
            }
            for (Map.Entry<UUID, List<int[]>> e : byRoster.entrySet()) {
                List<LocalDate> dates = datesOf(g, e.getValue());
                b.add(IssueId.E3, Level.error, g.members.get(m), dates, null, null,
                        g.name(m) + " is already on '" + nameOr(names.get(e.getKey()), "another roster") + "' on " + ranges(dates) + ".",
                        e.getValue());
            }
        }
    }

    // ── E4: a day planned before joining or after the last working day ────────────────────────────────────
    private static void outsideEmployment(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            PlanFacts.Person p = g.persons.get(m);
            if (p == null) continue;
            List<int[]> before = new ArrayList<>(), after = new ArrayList<>();
            for (int i = 0; i < g.days(); i++) {
                if (g.tokens[m][i] == null || !g.outside[m][i]) continue;
                LocalDate d = g.dates.get(i);
                if (p.joinedOn() != null && d.isBefore(p.joinedOn())) before.add(new int[]{m, i});
                else after.add(new int[]{m, i});
            }
            if (!before.isEmpty()) {
                List<LocalDate> dates = datesOf(g, before);
                b.add(IssueId.E4, Level.error, g.members.get(m), dates, null, null,
                        p.name() + " joins on " + day(p.joinedOn()) + "; clear " + ranges(dates) + ".", before);
            }
            if (!after.isEmpty()) {
                List<LocalDate> dates = datesOf(g, after);
                b.add(IssueId.E4, Level.error, g.members.get(m), dates, null, null,
                        p.name() + " leaves on " + day(p.lastWorkingDay()) + "; clear " + ranges(dates) + ".", after);
            }
        }
    }

    // ── E5: (department planners) a member outside the departments they head ──────────────────────────────
    private static void outsideHeadedDepartments(Grid g, Builder b) {
        PlanFacts.Planner planner = g.facts.planner();
        if (planner.companyWide()) return;
        String headed = planner.departmentIds().size() == 1
                ? nameOr(g.facts.departmentNames().get(planner.departmentIds().iterator().next()), "your department")
                : "the departments you head";
        for (int m = 0; m < g.members.size(); m++) {
            PlanFacts.Person p = g.persons.get(m);
            if (p == null) continue;
            if (p.departmentId() == null || !planner.departmentIds().contains(p.departmentId())) {
                b.add(IssueId.E5, Level.error, g.members.get(m), List.of(), null, null,
                        p.name() + ": only HR can plan people outside " + headed + ".", List.of());
            }
        }
    }

    // ── W1: a day with nothing planned (no holiday, no full-day leave, no other roster) ────────────────────
    private static void nothingPlanned(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            if (g.persons.get(m) == null) continue;
            List<int[]> cells = new ArrayList<>();
            for (int i = 0; i < g.days(); i++) {
                if (g.tokens[m][i] == null && !g.outside[m][i] && !g.dayOff(m, i) && g.other[m][i] == null) {
                    cells.add(new int[]{m, i});
                }
            }
            if (cells.isEmpty()) continue;
            List<LocalDate> dates = datesOf(g, cells);
            b.add(IssueId.W1, Level.warning, g.members.get(m), dates, null, null,
                    g.name(m) + " has nothing planned on " + ranges(dates) + ".", cells);
        }
    }

    // ── W2: 7 or more days in a row with no weekly off, holiday or leave ──────────────────────────────────
    private static void noWeeklyOff(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            if (g.persons.get(m) == null) continue;
            List<int[]> runs = new ArrayList<>();   // {from, to} day indexes
            int runStart = -1;
            for (int i = 0; i <= g.days(); i++) {
                boolean counts = i < g.days() && !g.outside[m][i] && !restDay(g, m, i);
                if (counts) {
                    if (runStart < 0) runStart = i;
                } else if (runStart >= 0) {
                    if (i - runStart >= MAX_DAYS_WITHOUT_OFF) runs.add(new int[]{runStart, i - 1});
                    runStart = -1;
                }
            }
            if (runs.isEmpty()) continue;
            List<int[]> cells = new ArrayList<>();
            List<String> spans = new ArrayList<>();
            for (int[] r : runs) {
                for (int i = r[0]; i <= r[1]; i++) cells.add(new int[]{m, i});
                spans.add("from " + fromTo(g.dates.get(r[0]), g.dates.get(r[1])));
            }
            b.add(IssueId.W2, Level.warning, g.members.get(m), datesOf(g, cells), null, null,
                    g.name(m) + " has no weekly off " + String.join(" and ", spans) + ".", cells);
        }
    }

    private static boolean restDay(Grid g, int m, int i) {
        if (g.dayOff(m, i) || Grid.isWo(g.tokens[m][i])) return true;
        PlanFacts.OtherDay o = g.other[m][i];
        return g.tokens[m][i] == null && o != null && RosterContract.WO.equals(o.kind());
    }

    // ── W4 / W6: rest between two shifts, and shifts that overlap ─────────────────────────────────────────
    private static void restAndOverlap(Grid g, Builder b) {
        int minRest = Math.max(0, g.facts.minRestMinutes());
        LocalDate before = g.dates.get(0).minusDays(1);
        for (int m = 0; m < g.members.size(); m++) {
            if (g.persons.get(m) == null) continue;
            UUID emp = g.members.get(m);
            // Index 0 = the day before the period (the effective schedule); index k = day k − 1 of the period.
            PlanFacts.Shift[] worked = new PlanFacts.Shift[g.days() + 1];
            boolean[] ours = new boolean[g.days() + 1];
            worked[0] = dayBefore(g, emp, before);
            for (int i = 0; i < g.days(); i++) {
                if (g.outside[m][i] || g.dayOff(m, i)) continue;
                String t = g.tokens[m][i];
                if (t != null) {
                    worked[i + 1] = g.shift(t);
                    ours[i + 1] = true;
                } else if (g.other[m][i] != null && "SHIFT".equals(g.other[m][i].kind())) {
                    worked[i + 1] = g.facts.shifts().get(g.other[m][i].shiftPolicyId());
                }
            }
            List<String> rests = new ArrayList<>(), overlaps = new ArrayList<>();
            TreeSet<LocalDate> restDates = new TreeSet<>(), overlapDates = new TreeSet<>();
            List<int[]> restCells = new ArrayList<>(), overlapCells = new ArrayList<>();
            for (int k = 1; k <= g.days(); k++) {
                PlanFacts.Shift prev = worked[k - 1], next = worked[k];
                if (prev == null || next == null || !(ours[k - 1] || ours[k])) continue;
                if (prev.start() == null || prev.end() == null || next.start() == null) continue;
                LocalDate prevDate = k == 1 ? before : g.dates.get(k - 2), nextDate = g.dates.get(k - 1);
                long gap = restMinutes(prev, prevDate, next, nextDate);
                if (gap >= minRest && gap >= 0) continue;
                boolean overlap = gap < 0;
                List<int[]> cells = overlap ? overlapCells : restCells;
                TreeSet<LocalDate> dates = overlap ? overlapDates : restDates;
                if (k >= 2 && ours[k - 1]) { cells.add(new int[]{m, k - 2}); dates.add(prevDate); }
                if (ours[k]) { cells.add(new int[]{m, k - 1}); dates.add(nextDate); }
                if (overlap) {
                    overlaps.add(next.displayCode() + " on " + day(nextDate) + " starts before " + prev.displayCode()
                            + " of " + day(prevDate) + " ends");
                } else {
                    rests.add(hours(gap) + " rest between " + prev.displayCode() + " on " + day(prevDate) + " and "
                            + next.displayCode() + " on " + day(nextDate));
                }
            }
            if (!rests.isEmpty()) b.add(IssueId.W4, Level.warning, emp, new ArrayList<>(restDates), null, null,
                    g.name(m) + ": " + rests.get(0) + more(rests.size() - 1) + ".", restCells);
            if (!overlaps.isEmpty()) b.add(IssueId.W6, Level.warning, emp, new ArrayList<>(overlapDates), null, null,
                    g.name(m) + ": " + overlaps.get(0) + more(overlaps.size() - 1) + ".", overlapCells);
        }
    }

    /**
     * The shift worked the day before the period, from the effective schedule: another roster's published day,
     * else the baseline; nothing on a holiday, full-day leave or a weekly off.
     */
    private static PlanFacts.Shift dayBefore(Grid g, UUID emp, LocalDate d) {
        if (g.facts.holidays().containsKey(d)) return null;
        PlanFacts.Leave leave = g.facts.leave().getOrDefault(emp, Map.of()).get(d);
        if (leave != null && !leave.halfDay()) return null;
        PlanFacts.OtherDay o = g.facts.otherRosterDays().getOrDefault(emp, Map.of()).get(d);
        if (o != null) return "SHIFT".equals(o.kind()) ? g.facts.shifts().get(o.shiftPolicyId()) : null;
        BaselineDay base = g.facts.baseline().getOrDefault(emp, Map.of()).get(d);
        if (base == null || base.weeklyOff() || base.shiftPolicyId() == null) return null;
        return g.facts.shifts().get(base.shiftPolicyId());
    }

    /**
     * Minutes from the end of {@code prev} (worked on {@code prevDate}; a night end, at or before its start, is the
     * next day) to the start of {@code next} on {@code nextDate}. Negative = they overlap.
     */
    static long restMinutes(PlanFacts.Shift prev, LocalDate prevDate, PlanFacts.Shift next, LocalDate nextDate) {
        LocalDateTime end = (prev.end().isAfter(prev.start()) ? prevDate : prevDate.plusDays(1)).atTime(prev.end());
        LocalDateTime start = nextDate.atTime(next.start());
        return ChronoUnit.MINUTES.between(end, start);
    }

    // ── W7: no designation ─────────────────────────────────────────────────────────────────────────────────
    private static void noDesignation(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            PlanFacts.Person p = g.persons.get(m);
            if (p == null || p.designationId() != null) continue;
            b.add(IssueId.W7, W7_LEVEL, g.members.get(m), List.of(), null, null,
                    p.name() + " has no designation and counts toward no requirement.", List.of());
        }
    }

    // ── I1: a shift planned on a holiday or on approved leave (the overlay shows on top) ──────────────────
    private static void onHolidayOrLeave(Grid g, Builder b) {
        for (int m = 0; m < g.members.size(); m++) {
            if (g.persons.get(m) == null) continue;
            List<int[]> cells = new ArrayList<>();
            List<LocalDate> holidays = new ArrayList<>(), full = new ArrayList<>(), half = new ArrayList<>();
            for (int i = 0; i < g.days(); i++) {
                String t = g.tokens[m][i];
                if (t == null || Grid.isWo(t) || g.overlays[m][i] == null) continue;
                cells.add(new int[]{m, i});
                LocalDate d = g.dates.get(i);
                if (g.holiday[i]) holidays.add(d);
                else if (g.fullLeave[m][i]) full.add(d);
                else half.add(d);
            }
            if (cells.isEmpty()) continue;
            List<String> parts = new ArrayList<>();
            if (!holidays.isEmpty()) parts.add("a holiday (" + ranges(holidays) + ")");
            if (!full.isEmpty()) parts.add("approved leave (" + ranges(full) + ")");
            if (!half.isEmpty()) parts.add("half-day leave (" + ranges(half) + "), still counted as working");
            b.add(IssueId.I1, Level.info, g.members.get(m), datesOf(g, cells), null, null,
                    g.name(m) + " has a shift planned on " + String.join(", ", parts) + ". The holiday or leave shows on top.",
                    cells);
        }
    }

    private static String coverageMessage(Grid g, Coverage.Gap gap, int min, int max) {
        PlanFacts.Shift s = g.facts.shifts().get(gap.shiftPolicyId());
        String shift = s == null ? "Unknown shift" : s.label();
        String people = min == max ? String.valueOf(min) : min + "–" + max;
        int n = gap.dates().size();
        return shift + ": " + Coverage.designationName(g, gap.designationId()) + " " + people + " of " + gap.required()
                + " on " + n + (n == 1 ? " date (" : " dates (") + ranges(gap.dates()) + ").";
    }

    // ── the "Schedule check" lines ─────────────────────────────────────────────────────────────────────────
    static String label(IssueId id, int n, Coverage.Result cov) {
        return switch (id) {
            case E1 -> n == 1 ? "1 shift on this roster can't be used" : n + " shifts on this roster can't be used";
            case E2 -> employees(n, "is", "are") + " no longer in this roster's company or scope";
            case E3 -> n == 0 ? "No duplicate assignments" : n == 1 ? "1 duplicate assignment with another roster"
                    : n + " duplicate assignments with another roster";
            case E4 -> employees(n, "has", "have") + " days planned outside their employment";
            case E5 -> employees(n, "is", "are") + " outside the departments you head";
            case W1 -> n == 0 ? "All employees assigned" : employees(n, "has", "have") + " days with nothing planned";
            case W2 -> n == 0 ? "Weekly offs available"
                    : employees(n, "has", "have") + " " + MAX_DAYS_WITHOUT_OFF + " or more days in a row without a weekly off";
            case W3 -> n == 0 ? "Required coverage met" : n == 1 ? "1 staffing requirement not met"
                    : n + " staffing requirements not met";
            case W4 -> n == 0 ? "Enough rest between shifts" : employees(n, "has", "have") + " insufficient rest";
            case W5 -> {
                int d = cov.nightUncovered().size();
                yield d == 0 ? "Night shifts covered" : "No one on a night shift on " + d + (d == 1 ? " date" : " dates");
            }
            case W6 -> n == 0 ? "No overlapping shifts" : employees(n, "has", "have") + " overlapping shifts";
            case W7 -> employees(n, "has", "have") + " no designation; they count toward no requirement";
            case I1 -> employees(n, "has", "have") + " shifts on a holiday or approved leave";
            case I2 -> n == 1 ? "1 staffing requirement has more people than needed"
                    : n + " staffing requirements have more people than needed";
        };
    }

    private static String employees(int n, String one, String many) {
        return n == 1 ? "1 employee " + one : n + " employees " + many;
    }

    // ── dates and times in messages ────────────────────────────────────────────────────────────────────────
    /** "5 Oct". */
    static String day(LocalDate d) {
        return d == null ? "an unknown date" : d.getDayOfMonth() + " " + month(d);
    }

    private static String month(LocalDate d) {
        return d.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    }

    /** "4 to 12 Oct", "28 Sep to 5 Oct". */
    static String fromTo(LocalDate a, LocalDate b) {
        if (a.equals(b)) return day(a);
        return (a.getMonth() == b.getMonth() && a.getYear() == b.getYear() ? String.valueOf(a.getDayOfMonth()) : day(a))
                + " to " + day(b);
    }

    /** Dates as ranges: "3–5 Oct, 8 Oct, 30 Sep – 2 Oct"; after six ranges "and N more days". */
    static String ranges(List<LocalDate> dates) {
        List<LocalDate> sorted = new ArrayList<>(new TreeSet<>(dates));
        List<String> parts = new ArrayList<>();
        int shownDays = 0, i = 0;
        while (i < sorted.size() && parts.size() < 6) {
            int j = i;
            while (j + 1 < sorted.size() && sorted.get(j + 1).equals(sorted.get(j).plusDays(1))) j++;
            LocalDate a = sorted.get(i), b = sorted.get(j);
            if (a.equals(b)) parts.add(day(a));
            else if (a.getMonth() == b.getMonth() && a.getYear() == b.getYear()) parts.add(a.getDayOfMonth() + "–" + day(b));
            else parts.add(day(a) + " – " + day(b));
            shownDays += j - i + 1;
            i = j + 1;
        }
        String out = String.join(", ", parts);
        int rest = sorted.size() - shownDays;
        if (rest > 0) out += " and " + rest + (rest == 1 ? " more day" : " more days");
        return out;
    }

    /** "6 h", "6 h 30 m", "45 m". */
    static String hours(long minutes) {
        long h = minutes / 60, m = minutes % 60;
        if (h == 0 && m > 0) return m + " m";
        return m == 0 ? h + " h" : h + " h " + m + " m";
    }

    private static String more(int n) {
        return n <= 0 ? "" : n == 1 ? ", and 1 more time" : ", and " + n + " more times";
    }

    private static String codeAndName(PlanFacts.Shift s) {
        String c = s.displayCode();
        return s.name() == null || s.name().isBlank() ? c : c + " (" + s.name().trim() + ")";
    }

    private static String nameOr(String name, String fallback) {
        return name == null || name.isBlank() ? fallback : name;
    }

    private static List<LocalDate> datesOf(Grid g, List<int[]> cells) {
        TreeSet<LocalDate> out = new TreeSet<>();
        for (int[] c : cells) out.add(g.dates.get(c[1]));
        return new ArrayList<>(out);
    }

    /** Collects issues per check id, gives each a key unique in the response, and marks the cells it is about. */
    private static final class Builder {
        private final Grid g;
        private final Map<IssueId, List<Issue>> byId = new EnumMap<>(IssueId.class);
        private final List<List<String>> cells;

        Builder(Grid g) {
            this.g = g;
            int size = g.members.size() * g.days();
            this.cells = new ArrayList<>(size);
            for (int i = 0; i < size; i++) cells.add(null);
        }

        void add(IssueId id, Level level, UUID employeeId, List<LocalDate> dates, UUID shiftPolicyId,
                 UUID designationId, String message, List<int[]> at) {
            List<Issue> list = byId.computeIfAbsent(id, k -> new ArrayList<>());
            String key = id.name() + "-" + (list.size() + 1);
            list.add(new Issue(key, id, level, employeeId, List.copyOf(dates), shiftPolicyId, designationId, message));
            for (int[] c : at) {
                int index = c[0] * g.days() + c[1];
                List<String> keys = cells.get(index);
                if (keys == null) cells.set(index, keys = new ArrayList<>(2));
                if (!keys.contains(key)) keys.add(key);
            }
        }

        Result build(Coverage.Result cov) {
            List<Issue> errors = new ArrayList<>(), warnings = new ArrayList<>(), infos = new ArrayList<>();
            List<CheckSummary> summary = new ArrayList<>();
            for (IssueId id : IssueId.values()) {
                List<Issue> list = byId.getOrDefault(id, List.of());
                for (Issue issue : list) {
                    switch (issue.level()) {
                        case error -> errors.add(issue);
                        case warning -> warnings.add(issue);
                        case info -> infos.add(issue);
                    }
                }
                if (!list.isEmpty() || ALWAYS_LISTED.contains(id)) {
                    summary.add(new CheckSummary(id, levelOf(id), list.size(), label(id, list.size(), cov)));
                }
            }
            return new Result(new Checks(errors, warnings, infos, summary), cells);
        }
    }

    /** The level each check has (W7's is {@link #W7_LEVEL}). */
    static Level levelOf(IssueId id) {
        if (id == IssueId.W7) return W7_LEVEL;
        return switch (id.name().charAt(0)) {
            case 'E' -> Level.error;
            case 'W' -> Level.warning;
            default -> Level.info;
        };
    }
}
