package com.hrms.api.roster.plan;

import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.Overlay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.PlanCell;
import com.hrms.api.roster.RosterContract.PlanDay;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PlanRow;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RowIn;
import com.hrms.api.roster.RosterContract.RowTotals;
import com.hrms.api.roster.RosterContract.StaffingIn;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Generate, coverage and checks in one pure function: no Spring, no database (design §1.3, §1.4).
 * The live preview, save, check, publish and the import all call it, so the web never
 * re-implements a planning rule. The same request and facts always give the same answer.
 *
 * <p><b>Generate</b> ({@code regenerate = true}): each member gets the pattern from their start day
 * ({@link Rotation}); before joining and after the last working day stay empty; with {@code keepEdits} the
 * cells listed in {@code RowIn.edited} keep their value. Holidays and leave never change a cell (they show on
 * top, so a cancelled leave or a removed holiday leaves the planned shift standing).
 *
 * <p><b>Start days.</b> A member keeps the {@code rotationOffset} it is sent with. A member has none, and gets
 * one by the stagger mode ({@link Rotation#offsets}), when its offset is negative, or, with
 * {@code regenerate = true}, when the request has no row for it yet (a person just added; the first Generate).
 * The offsets as used come back in {@code PlanResponse.members}.
 *
 * <p><b>Without regenerate</b> the cells are the request's rows as sent (a member with no row has an empty
 * row); only the overlays, coverage, totals and checks are worked out.
 */
public final class RosterPlanner {

    private RosterPlanner() {}

    /** The longest roster: 62 days ({@code rosters.end_date − start_date ≤ 61}). */
    public static final int MAX_DAYS = 62;

    public static PlanResponse plan(PlanRequest in, PlanFacts facts) {
        if (in == null) throw new IllegalArgumentException("A plan needs a request");
        requireValidRange(in.startDate(), in.endDate());
        PlanFacts f = facts == null ? PlanFacts.empty(null) : facts;
        RosterConfig config = in.config();
        List<PatternDay> pattern = config == null || config.pattern() == null ? List.of()
                : config.pattern().stream().filter(Objects::nonNull).toList();
        boolean repeats = config == null || config.repeats();
        WeeklyOffMode mode = config == null || config.weeklyOffMode() == null ? WeeklyOffMode.ROTATIONAL : config.weeklyOffMode();
        StaggerMode stagger = config == null || config.staggerMode() == null ? StaggerMode.SPREAD : config.staggerMode();

        LocalDate start = in.startDate();
        int days = (int) ChronoUnit.DAYS.between(start, in.endDate()) + 1;
        List<LocalDate> dates = new ArrayList<>(days);
        for (int i = 0; i < days; i++) dates.add(start.plusDays(i));

        // Members in order, each once; rows by person (the first row for a person wins).
        List<MemberIn> memberList = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        for (MemberIn m : nonNull(in.members())) {
            if (m.employeeId() != null && seen.add(m.employeeId())) memberList.add(m);
        }
        Map<UUID, RowIn> rows = new HashMap<>();
        for (RowIn r : nonNull(in.rows())) {
            if (r.employeeId() != null) rows.putIfAbsent(r.employeeId(), r);
        }
        int count = memberList.size();
        List<UUID> members = new ArrayList<>(count);
        List<PlanFacts.Person> persons = new ArrayList<>(count);
        List<UUID> designations = new ArrayList<>(count);
        int[] given = new int[count];
        for (int m = 0; m < count; m++) {
            MemberIn mi = memberList.get(m);
            PlanFacts.Person p = f.people().get(mi.employeeId());
            members.add(mi.employeeId());
            persons.add(p);
            designations.add(p == null ? Coverage.NO_DESIGNATION : p.designationId());
            boolean none = mi.rotationOffset() < 0 || (in.regenerate() && !rows.containsKey(mi.employeeId()));
            given[m] = none ? -1 : mi.rotationOffset();
        }

        PlanFacts.PreviousRoster previous = null;
        if (config != null && config.continueFromRosterId() != null) {
            for (PlanFacts.PreviousRoster p : f.previousRosters()) {
                if (config.continueFromRosterId().equals(p.id())) previous = p;
            }
        }
        int[] offsets = Rotation.offsets(members, designations, given, stagger, pattern, start, previous, f.baseline());

        // Cells.
        String[][] tokens = new String[count][days];
        boolean[][] edited = new boolean[count][days];
        boolean[][] outside = new boolean[count][days];
        for (int m = 0; m < count; m++) {
            PlanFacts.Person p = persons.get(m);
            for (int i = 0; i < days; i++) outside[m][i] = p != null && !p.employedOn(dates.get(i));
            RowIn row = rows.get(members.get(m));
            if (in.regenerate()) {
                boolean[] personalOff = new boolean[days];
                if (mode == WeeklyOffMode.FIXED) {
                    Map<LocalDate, BaselineDay> base = f.baseline().getOrDefault(members.get(m), Map.of());
                    for (int i = 0; i < days; i++) {
                        BaselineDay b = base.get(dates.get(i));
                        personalOff[i] = b != null && b.weeklyOff();
                    }
                }
                String[] laid = Rotation.row(mode, pattern, repeats, offsets[m], personalOff);
                for (int i = 0; i < days; i++) tokens[m][i] = outside[m][i] ? null : laid[i];
                if (in.keepEdits() && row != null) applyEdits(row, tokens[m], edited[m]);
            } else if (row != null) {
                List<String> cells = row.cells() == null ? List.of() : row.cells();
                for (int i = 0; i < days && i < cells.size(); i++) tokens[m][i] = token(cells.get(i));
                for (Integer e : nonNull(row.edited())) {
                    if (e >= 0 && e < days) edited[m][e] = true;
                }
            }
        }

        // Overlays (PH > L / COFF), other rosters' days, holidays.
        boolean[] holiday = new boolean[days];
        List<PlanDay> planDays = new ArrayList<>(days);
        for (int i = 0; i < days; i++) {
            String name = f.holidays().get(dates.get(i));
            holiday[i] = name != null;
            planDays.add(new PlanDay(dates.get(i), dates.get(i).getDayOfWeek().getValue(), name));
        }
        Overlay[][] overlays = new Overlay[count][days];
        boolean[][] fullLeave = new boolean[count][days];
        PlanFacts.OtherDay[][] other = new PlanFacts.OtherDay[count][days];
        for (int m = 0; m < count; m++) {
            Map<LocalDate, PlanFacts.Leave> leave = f.leave().getOrDefault(members.get(m), Map.of());
            Map<LocalDate, PlanFacts.OtherDay> others = f.otherRosterDays().getOrDefault(members.get(m), Map.of());
            for (int i = 0; i < days; i++) {
                LocalDate d = dates.get(i);
                PlanFacts.Leave l = leave.get(d);
                fullLeave[m][i] = l != null && !l.halfDay();
                if (holiday[i]) overlays[m][i] = new Overlay(OverlayType.PH, f.holidays().get(d), false);
                else if (l != null) overlays[m][i] = new Overlay(l.type(), l.label(), l.halfDay());
                other[m][i] = others.get(d);
            }
        }

        Grid grid = new Grid(dates, members, persons, designations, tokens, edited, outside, overlays, fullLeave,
                other, holiday, f, in.departmentId(), in.branchId());
        List<StaffingIn> staffing = nonNull(in.staffing());
        List<UUID> ticked = config == null || config.shiftIds() == null ? List.of() : config.shiftIds();
        Coverage.Result coverage = Coverage.compute(grid, Coverage.columns(ticked, staffing, grid), staffing);
        RosterChecks.Result checks = RosterChecks.run(grid, coverage);

        List<PlanRow> planRows = new ArrayList<>(count);
        List<MemberIn> used = new ArrayList<>(count);
        for (int m = 0; m < count; m++) {
            PlanFacts.Person p = persons.get(m);
            List<PlanCell> cells = new ArrayList<>(days);
            int working = 0, weeklyOff = 0, hol = 0, leave = 0, unplanned = 0;
            for (int i = 0; i < days; i++) {
                String t = tokens[m][i];
                cells.add(new PlanCell(t, code(grid, t), edited[m][i], overlays[m][i], outside[m][i],
                        List.copyOf(checks.of(m, i, days))));
                if (outside[m][i]) continue;
                if (holiday[i]) hol++;
                else if (fullLeave[m][i]) leave++;
                else if (Grid.isWo(t)) weeklyOff++;
                else if (t != null) working++;
                else if (other[m][i] == null) unplanned++;
            }
            planRows.add(new PlanRow(members.get(m), p == null ? "Unknown employee" : p.name(), p == null ? null : p.code(),
                    p == null ? null : p.designationId(), p == null ? null : p.designationName(),
                    p == null ? null : p.departmentName(), p == null ? null : p.branchName(), offsets[m], cells,
                    new RowTotals(working, weeklyOff, hol, leave, unplanned)));
            used.add(new MemberIn(members.get(m), offsets[m]));
        }
        return new PlanResponse(planDays, planRows, coverage.rows(), checks.checks(), used);
    }

    /**
     * Refuses a period without both dates, ending before it starts, or longer than {@value #MAX_DAYS} days
     * (400 {@code ROSTER_RANGE_INVALID}). The store, the import and the preview all use this one rule.
     */
    public static void requireValidRange(LocalDate start, LocalDate end) {
        if (start == null || end == null) throw rangeInvalid("Choose a start date and an end date.");
        if (end.isBefore(start)) throw rangeInvalid("The end date is before the start date.");
        if (ChronoUnit.DAYS.between(start, end) >= MAX_DAYS) {
            throw rangeInvalid("A roster covers at most " + MAX_DAYS + " days.");
        }
    }

    private static HrmsException rangeInvalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "ROSTER_RANGE_INVALID");
    }

    /** Keeps the edited cells of {@code row} over the newly laid ones. */
    private static void applyEdits(RowIn row, String[] tokens, boolean[] edited) {
        List<String> cells = row.cells() == null ? List.of() : row.cells();
        for (Integer e : nonNull(row.edited())) {
            if (e < 0 || e >= tokens.length) continue;
            tokens[e] = e < cells.size() ? token(cells.get(e)) : null;
            edited[e] = true;
        }
    }

    /** A cell token as sent: blank = empty, any case of "wo" = WO, anything else as it is (an unknown one is E1). */
    private static String token(String t) {
        if (t == null || t.isBlank()) return null;
        String s = t.trim();
        return s.equalsIgnoreCase(RosterContract.WO) ? RosterContract.WO : s;
    }

    /** The code a cell shows: the shift's code (or its initials), WO, "?" for a shift that can't be found, or null. */
    private static String code(Grid g, String token) {
        if (token == null) return null;
        if (Grid.isWo(token)) return RosterContract.WO;
        PlanFacts.Shift s = g.shift(token);
        return s == null ? "?" : s.displayCode();
    }

    private static <T> List<T> nonNull(List<T> list) {
        if (list == null) return List.of();
        List<T> out = new ArrayList<>(list.size());
        for (T t : list) if (t != null) out.add(t);
        return out;
    }
}
