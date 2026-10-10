package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.ImportProblem;
import com.hrms.api.roster.RosterContract.ImportRow;
import com.hrms.api.roster.RosterContract.ImportSummary;
import com.hrms.api.roster.RosterContract.Level;
import com.hrms.api.roster.RosterContract.MatchedBy;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.plan.PlanFacts;
import com.hrms.app.roster.RosterSheetLayout.Column;
import com.hrms.app.roster.RosterSheetLayout.Reserved;
import com.hrms.app.roster.RosterSheetLayout.Total;
import com.hrms.app.roster.RosterSheetParser.DayColumn;
import com.hrms.app.roster.RosterSheetParser.Note;
import com.hrms.app.roster.RosterSheetParser.OutsideCell;
import com.hrms.app.roster.RosterSheetParser.ParsedSheet;
import com.hrms.app.roster.RosterSheetParser.SheetRow;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * The import's own rules (design §1.7 "People" and "Per-cell results"), pure: a parsed sheet, the company's people
 * and the plan facts in; the rows, the problems with row and column, and the members and cells of the draft out.
 * The schedule checks themselves (coverage, rest, weekly offs …) are the planner's ({@code RosterPlanner}); this
 * class only turns the sheet into a working copy and says what in the file is wrong.
 *
 * <p>Errors (they stop Apply): a person not found, two people with that name, someone outside the roster's
 * department or building (E2) or outside the departments a department head heads (E5), the same person twice, an
 * unknown code, a shift or WO before joining or after the last working day (E4), a code in a day column that is
 * not a date of the period, two columns for one date, a row with codes and no employee. Warnings: PH with no
 * holiday that day, L / COFF with no approved leave, a shift whose code is a reserved word. Infos: a shift on a day
 * of approved leave, a department, designation, building or name that differs from the employee record (the record
 * is used; the import never changes employee records), totals that differ from the codes.
 */
final class RosterImportCheck {

    private RosterImportCheck() {}

    /** The roster a file is imported into, and who imports it. */
    record Target(UUID companyId, LocalDate start, LocalDate end, UUID departmentId, String departmentName,
                  UUID branchId, String branchName, boolean companyWide, Set<UUID> headedDepartmentIds) {}

    /** A person row and the employee it matched; {@code person} null = not imported (a problem says why). */
    record Match(SheetRow row, PlannerPerson person, MatchedBy by) {}

    record Matching(List<Match> matches, List<ImportProblem> problems) {
        /** The matched people, in sheet order. */
        List<UUID> employeeIds() {
            List<UUID> ids = new ArrayList<>();
            for (Match m : matches) if (m.person() != null) ids.add(m.person().employeeId());
            return ids;
        }
    }

    /**
     * Everything validate and apply need. {@code problems} is the full list (all counted in {@code summary});
     * {@link #listed} is what the answer shows.
     */
    record Outcome(List<ImportRow> rows, List<ImportProblem> problems, ImportSummary summary, List<MemberIn> members,
                   List<RowIn> cells, List<UUID> shiftIds, List<String> designationIds) {

        /** At most {@link RosterSheetLayout#MAX_PROBLEMS_LISTED}, errors first, then in row order. */
        List<ImportProblem> listed() {
            int max = RosterSheetLayout.MAX_PROBLEMS_LISTED;
            if (problems.size() <= max) return problems;
            List<ImportProblem> keep = new ArrayList<>(problems);
            keep.sort(Comparator.comparingInt(p -> p.severity().ordinal()));
            keep = new ArrayList<>(keep.subList(0, max - 1));
            keep.sort(ROW_ORDER);
            keep.add(new ImportProblem(null, null, null, "MORE_PROBLEMS", Level.info, "Showing " + (max - 1) + " of "
                    + problems.size() + " problems. Fix these and upload the file again to see the rest."));
            return keep;
        }
    }

    /** Problems without a row first, then by row; the order they were found otherwise. */
    static final Comparator<ImportProblem> ROW_ORDER = Comparator.comparing(ImportProblem::rowNo, Comparator.nullsFirst(Comparator.naturalOrder()));

    // ── people ───────────────────────────────────────────────────────────────

    /**
     * Matches each person row: by employee code (exact, any case, within the company), else by full name within
     * the roster's scope. {@code candidates} are the company's working people in the period (all departments).
     */
    static Matching match(ParsedSheet sheet, List<PlannerPerson> candidates, Target t) {
        Map<String, List<PlannerPerson>> byCode = new HashMap<>(), byName = new HashMap<>();
        for (PlannerPerson p : candidates) {
            if (p.code() != null && !p.code().isBlank()) byCode.computeIfAbsent(RosterSheetLayout.key(p.code()), k -> new ArrayList<>()).add(p);
            if (p.name() != null && !p.name().isBlank()) byName.computeIfAbsent(RosterSheetLayout.key(p.name()), k -> new ArrayList<>()).add(p);
        }
        String nameCol = sheet.letter(Column.EMPLOYEE), codeCol = sheet.letter(Column.CODE);
        List<Match> matches = new ArrayList<>();
        List<ImportProblem> problems = new ArrayList<>();
        Map<UUID, Integer> seen = new HashMap<>();
        for (SheetRow r : sheet.rows()) {
            PlannerPerson p = null;
            MatchedBy by = null;
            if (!r.code().isBlank()) {
                List<PlannerPerson> found = byCode.getOrDefault(RosterSheetLayout.key(r.code()), List.of());
                if (found.isEmpty()) {
                    problems.add(problem(r.rowNo(), codeCol, null, "NOT_FOUND", Level.error, "No one with the employee code '" + r.code()
                            + "' works in this company in " + period(t.start(), t.end()) + "."));
                } else if (found.size() > 1) {
                    problems.add(problem(r.rowNo(), codeCol, null, "AMBIGUOUS_CODE", Level.error, found.size()
                            + " people have the employee code '" + r.code() + "'. Correct the code in their employee records."));
                } else {
                    p = found.get(0);
                    by = MatchedBy.CODE;
                }
            } else {
                List<PlannerPerson> named = byName.getOrDefault(RosterSheetLayout.key(r.employee()), List.of());
                List<PlannerPerson> inScope = named.stream().filter(c -> inScope(c, t)).toList();
                List<PlannerPerson> pick = inScope.isEmpty() ? named : inScope;
                if (pick.isEmpty()) {
                    problems.add(problem(r.rowNo(), nameCol, null, "NOT_FOUND", Level.error, "No one called '" + r.employee()
                            + "' works in this company in " + period(t.start(), t.end()) + ". Check the name, or add the employee code."));
                } else if (pick.size() > 1) {
                    problems.add(problem(r.rowNo(), nameCol, null, "AMBIGUOUS_NAME", Level.error, pick.size() + " people are called "
                            + r.employee() + "; add the employee code."));
                } else {
                    p = pick.get(0);
                    by = MatchedBy.NAME;
                }
            }
            if (p != null) {
                String col = by == MatchedBy.CODE ? codeCol : nameCol;
                String outside = outsideScope(p, t);
                if (outside != null) {
                    problems.add(problem(r.rowNo(), col, null, t.companyWide() || headed(p, t) ? "E2" : "E5", Level.error, outside));
                    p = null;
                } else if (seen.containsKey(p.employeeId())) {
                    problems.add(problem(r.rowNo(), col, null, "DUPLICATE_ROW", Level.error, p.name() + " is also on row "
                            + seen.get(p.employeeId()) + ". Keep one row per person."));
                    p = null;
                } else {
                    seen.put(p.employeeId(), r.rowNo());
                }
            }
            matches.add(new Match(r, p, p == null ? null : by));
        }
        return new Matching(matches, problems);
    }

    private static boolean headed(PlannerPerson p, Target t) {
        return p.departmentId() != null && t.headedDepartmentIds() != null && t.headedDepartmentIds().contains(p.departmentId());
    }

    private static boolean inScope(PlannerPerson p, Target t) {
        return outsideScope(p, t) == null;
    }

    /** Why a person can't be on this roster (E5, then E2), or null. */
    private static String outsideScope(PlannerPerson p, Target t) {
        if (!t.companyWide() && !headed(p, t)) {
            return "Only HR can plan " + p.name() + ": they're outside the departments you head.";
        }
        if (t.departmentId() != null && !t.departmentId().equals(p.departmentId())) {
            return p.name() + " is not in " + or(t.departmentName(), "this roster's department")
                    + (p.departmentName() == null ? "." : " (they're in " + p.departmentName() + ").");
        }
        if (t.branchId() != null && !t.branchId().equals(p.branchId())) {
            return p.name() + " is not at " + or(t.branchName(), "this roster's building")
                    + (p.branchName() == null ? "." : " (they're at " + p.branchName() + ").");
        }
        return null;
    }

    // ── cells ────────────────────────────────────────────────────────────────

    /** The per-cell results of design §1.7, for every person row; the draft's members and cells for matched ones. */
    static Outcome cells(ParsedSheet sheet, Matching matching, PlanFacts facts, Target t) {
        List<LocalDate> dates = new ArrayList<>();
        for (LocalDate d = t.start(); !d.isAfter(t.end()); d = d.plusDays(1)) dates.add(d);

        // The company's usable shift codes, and the ones that can't be used.
        Map<String, List<PlanFacts.Shift>> active = new HashMap<>();
        Map<String, PlanFacts.Shift> inactive = new HashMap<>();
        for (PlanFacts.Shift s : facts.shifts().values()) {
            if (s.code() == null || s.code().isBlank() || !Objects.equals(t.companyId(), s.companyId())) continue;
            String k = RosterSheetLayout.key(s.code());
            if (s.active()) active.computeIfAbsent(k, x -> new ArrayList<>()).add(s);
            else inactive.putIfAbsent(k, s);
        }

        List<ImportProblem> problems = new ArrayList<>();
        for (Note n : sheet.notes()) problems.add(problem(n.rowNo(), n.column(), n.date(), n.code(), n.severity(), n.message()));
        problems.addAll(matching.problems());
        if (sheet.rows().isEmpty()) {
            problems.add(problem(null, null, null, "NO_ROWS", Level.error, "The file has no rows of people under the header."));
        }

        Map<LocalDate, List<Integer>> noHoliday = new TreeMap<>();
        Set<UUID> collisionWarned = new LinkedHashSet<>();
        Set<String> ambiguousWarned = new HashSet<>();
        List<ImportProblem> sheetWide = new ArrayList<>();
        List<ImportRow> rows = new ArrayList<>();
        List<MemberIn> members = new ArrayList<>();
        List<RowIn> cells = new ArrayList<>();
        Set<UUID> usedShifts = new LinkedHashSet<>();
        Set<String> designations = new LinkedHashSet<>();

        for (Match m : matching.matches()) {
            SheetRow r = m.row();
            PlannerPerson p = m.person();
            Map<LocalDate, PlanFacts.Leave> leave = p == null ? Map.of() : facts.leave().getOrDefault(p.employeeId(), Map.of());
            List<String> codes = new ArrayList<>(dates.size());
            List<String> tokens = new ArrayList<>(dates.size());
            List<LocalDate> beforeJoining = new ArrayList<>(), afterLeaving = new ArrayList<>();
            List<LocalDate> noLeave = new ArrayList<>(), onLeave = new ArrayList<>();
            for (LocalDate d : dates) {
                String raw = r.cells().get(d);
                codes.add(raw);
                tokens.add(null);
                if (raw == null) continue;
                int i = tokens.size() - 1;
                Reserved res = RosterSheetLayout.reserved(raw);
                if (res != null) {
                    for (PlanFacts.Shift s : active.getOrDefault(RosterSheetLayout.key(raw), List.of())) {
                        if (collisionWarned.add(s.id())) {
                            sheetWide.add(problem(null, null, null, "RESERVED_SHIFT_CODE", Level.warning, "Shift " + s.label()
                                    + " has the code " + s.code().trim() + ", which the import reads as " + meaning(res)
                                    + ". Give the shift another code in Shift Schedules to import it."));
                        }
                    }
                    switch (res) {
                        case WO -> {
                            if (p != null && !outsideEmployment(p, d, beforeJoining, afterLeaving)) tokens.set(i, RosterContract.WO);
                        }
                        case PH -> {
                            if (!facts.holidays().containsKey(d)) noHoliday.computeIfAbsent(d, k -> new ArrayList<>()).add(r.rowNo());
                        }
                        case L, COFF -> {
                            if (p != null && leave.get(d) == null) noLeave.add(d);
                        }
                    }
                    continue;
                }
                String k = RosterSheetLayout.key(raw);
                List<PlanFacts.Shift> shifts = active.getOrDefault(k, List.of());
                if (shifts.isEmpty()) {
                    PlanFacts.Shift gone = inactive.get(k);
                    problems.add(problem(r.rowNo(), column(sheet, d), d, "UNKNOWN_CODE", Level.error, gone != null
                            ? "Shift " + gone.label() + " is no longer active, so '" + raw + "' on " + day(d) + " can't be used. Use another code."
                            : "Unknown code '" + raw + "' on " + day(d) + ". Use a shift code from the Codes sheet, or WO, PH, L or COFF."));
                } else if (shifts.size() > 1) {
                    if (ambiguousWarned.add(k)) {
                        sheetWide.add(problem(null, null, null, "AMBIGUOUS_SHIFT_CODE", Level.error, shifts.size() + " shifts use the code "
                                + raw.trim().toUpperCase(Locale.ROOT) + " (" + String.join(", ", shifts.stream().map(PlanFacts.Shift::name).toList())
                                + "). Give each its own code in Shift Schedules."));
                    }
                } else if (p != null && !outsideEmployment(p, d, beforeJoining, afterLeaving)) {
                    PlanFacts.Shift s = shifts.get(0);
                    tokens.set(i, s.id().toString());
                    usedShifts.add(s.id());
                    if (leave.get(d) != null) onLeave.add(d);
                }
            }
            for (OutsideCell oc : r.outside()) {
                problems.add(problem(r.rowNo(), oc.column().letter(), null, "DAY_OUTSIDE_PERIOD", Level.error,
                        oc.column().outside() + "; leave column " + oc.column().letter() + " empty."));
            }
            if (p == null) {
                rows.add(new ImportRow(r.rowNo(), r.employee(), blankToNull(r.code()), null, null, codes));
                continue;
            }
            String col = sheet.letter(m.by() == MatchedBy.CODE ? Column.CODE : Column.EMPLOYEE);
            if (!beforeJoining.isEmpty()) {
                problems.add(problem(r.rowNo(), column(sheet, beforeJoining.get(0)), beforeJoining.get(0), "E4", Level.error, p.name()
                        + " joins on " + day(p.joinedOn()) + "; clear " + ranges(beforeJoining) + "."));
            }
            if (!afterLeaving.isEmpty()) {
                problems.add(problem(r.rowNo(), column(sheet, afterLeaving.get(0)), afterLeaving.get(0), "E4", Level.error, p.name()
                        + "'s last working day is " + day(p.lastWorkingDay()) + "; clear " + ranges(afterLeaving) + "."));
            }
            if (!noLeave.isEmpty()) {
                problems.add(problem(r.rowNo(), column(sheet, noLeave.get(0)), noLeave.get(0), "NO_LEAVE", Level.warning,
                        "No approved leave for " + p.name() + " on " + ranges(noLeave) + ". "
                                + (noLeave.size() == 1 ? "The day stays" : "Those days stay") + " unplanned."));
            }
            if (!onLeave.isEmpty()) {
                problems.add(problem(r.rowNo(), column(sheet, onLeave.get(0)), onLeave.get(0), "SHIFT_ON_LEAVE", Level.info,
                        p.name() + " has approved leave on " + ranges(onLeave) + "; the shift is kept and the leave shows on top."));
            }
            String differs = differences(r, p, m.by());
            if (differs != null) problems.add(problem(r.rowNo(), col, null, "RECORD_DIFFERS", Level.info, differs));
            String totals = totals(r, dates);
            if (totals != null) {
                Integer first = sheet.totalColumns().values().stream().min(Integer::compare).orElse(null);
                problems.add(problem(r.rowNo(), first == null ? null : RosterSheetParser.letter(first), null, "TOTALS_DIFFER", Level.info, totals));
            }
            rows.add(new ImportRow(r.rowNo(), r.employee(), blankToNull(r.code()), p.employeeId(), m.by(), codes));
            members.add(new MemberIn(p.employeeId(), 0));
            cells.add(new RowIn(p.employeeId(), tokens, List.of()));
            designations.add(p.designationId() == null ? "" : p.designationId().toString());
        }
        noHoliday.forEach((d, rowNos) -> sheetWide.add(problem(rowNos.size() == 1 ? rowNos.get(0) : null, column(sheet, d), d,
                "NO_HOLIDAY", Level.warning, "No holiday on " + day(d) + " in Settings › Holidays"
                        + (rowNos.size() == 1 ? "" : " (" + rowNos.size() + " rows say PH)")
                        + ". The day stays unplanned unless you add it.")));
        problems.addAll(sheetWide);
        problems.sort(ROW_ORDER);

        int errors = 0, warnings = 0;
        for (ImportProblem pr : problems) {
            if (pr.severity() == Level.error) errors++;
            else if (pr.severity() == Level.warning) warnings++;
        }
        List<UUID> shiftIds = new ArrayList<>(usedShifts);
        shiftIds.sort(Comparator.comparing((UUID id) -> facts.shifts().get(id).displayCode(), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(UUID::toString));
        return new Outcome(rows, problems, new ImportSummary(sheet.rows().size(), members.size(), errors, warnings),
                members, cells, shiftIds, new ArrayList<>(designations));
    }

    /** True (and the date noted) when the person isn't employed on {@code d}: before joining or after leaving. */
    private static boolean outsideEmployment(PlannerPerson p, LocalDate d, List<LocalDate> before, List<LocalDate> after) {
        if (p.joinedOn() != null && d.isBefore(p.joinedOn())) {
            before.add(d);
            return true;
        }
        if (p.lastWorkingDay() != null && d.isAfter(p.lastWorkingDay())) {
            after.add(d);
            return true;
        }
        return false;
    }

    /** The sheet's department, designation, building or name where it differs from the employee record. */
    private static String differences(SheetRow r, PlannerPerson p, MatchedBy by) {
        List<String> diffs = new ArrayList<>();
        if (by == MatchedBy.CODE && !r.employee().isBlank() && !RosterSheetLayout.key(r.employee()).equals(RosterSheetLayout.key(p.name()))) {
            diffs.add("name '" + r.employee() + "' (the record says '" + p.name() + "')");
        }
        differ(diffs, "department", r.department(), p.departmentName());
        differ(diffs, "designation", r.designation(), p.designationName());
        differ(diffs, "building", r.building(), p.branchName());
        if (diffs.isEmpty()) return null;
        return "For " + p.name() + " the sheet has a different " + join(diffs)
                + ". The employee record is used; the import never changes employee records.";
    }

    private static void differ(List<String> diffs, String what, String sheet, String record) {
        if (sheet == null || sheet.isBlank()) return;
        if (record != null && RosterSheetLayout.key(sheet).equals(RosterSheetLayout.key(record))) return;
        diffs.add(what + " '" + sheet + "' (" + (record == null ? "the record has none" : "the record says '" + record + "'") + ")");
    }

    /** The sheet's totals that differ from what its codes give, or null. */
    private static String totals(SheetRow r, List<LocalDate> dates) {
        if (r.totals().isEmpty()) return null;
        Map<Total, Integer> counted = new EnumMap<>(Total.class);
        for (Total t : Total.values()) counted.put(t, 0);
        for (LocalDate d : dates) {
            String raw = r.cells().get(d);
            if (raw == null) continue;
            Reserved res = RosterSheetLayout.reserved(raw);
            Total t = res == null ? Total.WORKING : Total.valueOf(res.name());
            counted.merge(t, 1, Integer::sum);
            counted.merge(Total.ALL, 1, Integer::sum);
        }
        List<String> diffs = new ArrayList<>();
        r.totals().forEach((t, n) -> {
            long sheet = Math.round(n);
            if (sheet != counted.get(t)) {
                diffs.add(RosterSheetLayout.header(t) + ": the sheet says " + sheet + ", the codes give " + counted.get(t));
            }
        });
        if (diffs.isEmpty()) return null;
        return "This row's totals differ from its codes (" + String.join("; ", diffs) + "). Totals are worked out from the codes.";
    }

    private static String meaning(Reserved r) {
        return switch (r) {
            case WO -> "a weekly off";
            case PH -> "a holiday";
            case L -> "leave";
            case COFF -> "comp off";
        };
    }

    // ── messages ─────────────────────────────────────────────────────────────

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter DAY_YEAR = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter MONTH_YEAR = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH);

    /** "12 Jan". */
    static String day(LocalDate d) {
        return d == null ? "" : DAY.format(d);
    }

    /** "January 2027" for a whole month, else "15 Oct – 14 Nov 2026" / "1–10 Jan 2027". */
    static String period(LocalDate start, LocalDate end) {
        if (start.getDayOfMonth() == 1 && end.equals(start.withDayOfMonth(start.lengthOfMonth()))) return MONTH_YEAR.format(start);
        if (start.getYear() != end.getYear()) return DAY_YEAR.format(start) + " – " + DAY_YEAR.format(end);
        if (start.getMonth() == end.getMonth()) return start.getDayOfMonth() + "–" + DAY_YEAR.format(end);
        return DAY.format(start) + " – " + DAY_YEAR.format(end);
    }

    /** "1–4 Jan, 12 Jan and 30 Jan – 2 Feb": dates (sorted) as runs of days. */
    static String ranges(List<LocalDate> dates) {
        List<LocalDate> sorted = new ArrayList<>(new java.util.TreeSet<>(dates));
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < sorted.size(); ) {
            int j = i;
            while (j + 1 < sorted.size() && sorted.get(j + 1).equals(sorted.get(j).plusDays(1))) j++;
            LocalDate a = sorted.get(i), b = sorted.get(j);
            if (a.equals(b)) parts.add(day(a));
            else if (a.getMonth() == b.getMonth()) parts.add(a.getDayOfMonth() + "–" + day(b));
            else parts.add(day(a) + " – " + day(b));
            i = j + 1;
        }
        return join(parts);
    }

    private static String join(List<String> parts) {
        if (parts.isEmpty()) return "";
        if (parts.size() == 1) return parts.get(0);
        return String.join(", ", parts.subList(0, parts.size() - 1)) + " and " + parts.get(parts.size() - 1);
    }

    private static String column(ParsedSheet sheet, LocalDate d) {
        DayColumn c = sheet.dayByDate().get(d);
        return c == null ? null : c.letter();
    }

    private static ImportProblem problem(Integer rowNo, String column, LocalDate date, String code, Level severity, String message) {
        return new ImportProblem(rowNo, column, date, code, severity, message);
    }

    private static String or(String s, String fallback) {
        return s == null || s.isBlank() ? fallback : s;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
