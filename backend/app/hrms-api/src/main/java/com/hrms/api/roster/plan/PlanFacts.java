package com.hrms.api.roster.plan;

import com.hrms.api.roster.Actor;
import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Everything {@link RosterPlanner} needs from the database for one plan: the company's active shifts,
 * the people (designation, department, branch, joining, last working day), their baseline days,
 * holidays, approved leave, other rosters' schedule days and the minimum rest (design §1.3).
 *
 * <p>Package B's internal shape: the store (A) and the import (C) only pass it from
 * {@link PlanFactsLoader#load} to {@link RosterPlanner#plan}, so B adds its fields freely.
 *
 * @param companyId       the roster's company: a shift or a person of another company is an error (E1, E2)
 * @param shifts          the company's shifts, active or not, plus any other shift a fact below refers to
 * @param people          the members found (an active employee record of this tenant); a member missing here is
 *                        "not found" (E2)
 * @param baseline        today's answer with no roster (the resolver, through {@link com.hrms.api.roster.BaselineSchedule})
 *                        per person and date, from the day before the period (or earlier, see {@code previousRosters})
 * @param holidays        the company's active holidays by date, names joined (the PH overlay)
 * @param leave           approved leave per person and date (the L / COFF overlay)
 * @param otherRosterDays published schedule days of OTHER rosters per person and date (E3, the rest check)
 * @param previousRosters published rosters of the company that end the day before the period starts (the
 *                        "Continue from" start days)
 * @param designationNames the company's designation titles (staffing rows with no member yet)
 * @param departmentNames the company's department names (messages)
 * @param branchNames     the company's branch names (messages)
 * @param minRestMinutes  the company's minimum rest between two shifts (W4, default 480)
 * @param planner         who is planning: a department planner gets E5 for people outside the departments they
 *                        head; {@link Planner#COMPANY_WIDE} when not set (see {@link #withPlanner})
 */
public record PlanFacts(UUID companyId,
                        Map<UUID, Shift> shifts,
                        Map<UUID, Person> people,
                        Map<UUID, Map<LocalDate, BaselineDay>> baseline,
                        Map<LocalDate, String> holidays,
                        Map<UUID, Map<LocalDate, Leave>> leave,
                        Map<UUID, Map<LocalDate, OtherDay>> otherRosterDays,
                        List<PreviousRoster> previousRosters,
                        Map<UUID, String> designationNames,
                        Map<UUID, String> departmentNames,
                        Map<UUID, String> branchNames,
                        int minRestMinutes,
                        Planner planner) {

    /** The minimum rest when a company has set none: 8 hours (D-S8). */
    public static final int DEFAULT_MIN_REST_MINUTES = 480;

    public PlanFacts {
        shifts = shifts == null ? Map.of() : shifts;
        people = people == null ? Map.of() : people;
        baseline = baseline == null ? Map.of() : baseline;
        holidays = holidays == null ? Map.of() : holidays;
        leave = leave == null ? Map.of() : leave;
        otherRosterDays = otherRosterDays == null ? Map.of() : otherRosterDays;
        previousRosters = previousRosters == null ? List.of() : previousRosters;
        designationNames = designationNames == null ? Map.of() : designationNames;
        departmentNames = departmentNames == null ? Map.of() : departmentNames;
        branchNames = branchNames == null ? Map.of() : branchNames;
        planner = planner == null ? Planner.COMPANY_WIDE : planner;
    }

    /** No facts at all for a company (every member is then "not found"). */
    public static PlanFacts empty(UUID companyId) {
        return new PlanFacts(companyId, null, null, null, null, null, null, null, null, null, null,
                DEFAULT_MIN_REST_MINUTES, null);
    }

    /**
     * The same facts for this planner: a department planner (not {@link Actor#companyWide()}) gets check E5 for
     * every member outside the departments they head. The loader cannot know the caller, so whoever has the
     * {@link Actor} sets it; without it the plan treats the caller as company-wide.
     */
    public PlanFacts withPlanner(Actor actor) {
        Planner p = actor == null || actor.companyWide() ? Planner.COMPANY_WIDE
                : new Planner(false, actor.headedDepartmentIds() == null ? Set.of() : Set.copyOf(actor.headedDepartmentIds()));
        return new PlanFacts(companyId, shifts, people, baseline, holidays, leave, otherRosterDays, previousRosters,
                designationNames, departmentNames, branchNames, minRestMinutes, p);
    }

    /**
     * A shift definition ({@code attendance.shift_policies}). {@code code} may be blank (then the cell shows the
     * name's initials). Night = type NIGHT or an end at or before the start (the existing rule, {@code ShiftTiming}).
     */
    public record Shift(UUID id, UUID companyId, String code, String name, LocalTime start, LocalTime end,
                        String shiftType, boolean active) {

        public boolean night() {
            return "NIGHT".equalsIgnoreCase(shiftType) || (start != null && end != null && !end.isAfter(start));
        }

        /** The roster cell code: the shift's code, else the first letters of its name ("Night Shift" → "NS"). */
        public String displayCode() {
            if (code != null && !code.isBlank()) return code.trim();
            if (name == null || name.isBlank()) return "?";
            StringBuilder b = new StringBuilder();
            for (String word : name.trim().split("\\s+")) {
                if (!word.isEmpty() && b.length() < 3) b.appendCodePoint(Character.toUpperCase(word.codePointAt(0)));
            }
            return b.toString();
        }

        /** "Night (C)" for messages; just the name or the code when one is missing. */
        public String label() {
            String c = displayCode();
            if (name == null || name.isBlank()) return c;
            return name.trim() + " (" + c + ")";
        }
    }

    /** A member's employee record, as it is now. */
    public record Person(UUID id, UUID companyId, String name, String code, UUID designationId, String designationName,
                         UUID departmentId, String departmentName, UUID branchId, String branchName,
                         LocalDate joinedOn, LocalDate lastWorkingDay) {

        /** Employed on {@code d}: on or after joining (when known) and on or before the last working day (when set). */
        public boolean employedOn(LocalDate d) {
            return (joinedOn == null || !d.isBefore(joinedOn)) && (lastWorkingDay == null || !d.isAfter(lastWorkingDay));
        }
    }

    /**
     * Approved leave on one date: {@code COFF} for a leave type of category COMPENSATORY, else {@code L};
     * {@code label} = the leave type's name; {@code halfDay} = only half of the day is leave.
     */
    public record Leave(OverlayType type, String label, boolean halfDay) {}

    /** A published day of another roster: {@code kind} SHIFT or WO. */
    public record OtherDay(UUID rosterId, String rosterName, String kind, UUID shiftPolicyId) {}

    /**
     * A published roster that ends the day before this period starts, for "Continue from": its period, the pattern
     * and weekly-off mode it was generated with, and each member's start day in the pattern.
     */
    public record PreviousRoster(UUID id, String name, LocalDate startDate, LocalDate endDate,
                                 List<PatternDay> pattern, WeeklyOffMode weeklyOffMode, Map<UUID, Integer> offsets) {}

    /** {@code companyWide} = any person of the company; otherwise only people of {@code departmentIds} (E5). */
    public record Planner(boolean companyWide, Set<UUID> departmentIds) {
        public static final Planner COMPANY_WIDE = new Planner(true, Set.of());
    }
}
