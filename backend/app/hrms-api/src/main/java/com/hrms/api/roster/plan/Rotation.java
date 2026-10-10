package com.hrms.api.roster.plan;

import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Where each person is in the rotation pattern on each date, and the start days ("offsets") that stagger
 * people (design §1.3). Pure: no database, no clock.
 *
 * <p>Positions. For a member with offset {@code o} on day index {@code i} (0 = the period's first day):
 * <ul>
 *   <li>ROTATIONAL and CUSTOM: {@code pos = (i + o) mod N}.</li>
 *   <li>FIXED: the person's usual weekly-off weekdays (the baseline's {@code weeklyOff}) are WO, and the cycle
 *       advances on working days only: {@code pos = (w + o) mod N}, {@code w} = the non-off days before the date
 *       in the period. A WO inside the pattern is an extra day off.</li>
 *   <li>With {@code repeats = false} only {@code i + o < N} (FIXED: {@code w + o < N}) gets a day.</li>
 *   <li>CUSTOM: the pattern's WO days are left empty, for HR to pick in the preview.</li>
 * </ul>
 */
final class Rotation {

    private Rotation() {}

    /** Largest offset the store keeps ({@code roster_members.rotation_offset}, 0..61). */
    static final int MAX_OFFSET = 61;

    /**
     * The pattern value of one day, before joining / leaving and hand edits are applied: a shift id, {@code WO},
     * or null (empty). This is the one switch on the weekly-off mode (pending-owner default 4).
     *
     * @param dayIndex           days since the period's start
     * @param workingDaysBefore  FIXED only: the person's non-off days before this date in the period
     * @param personalOff        FIXED only: this date is one of the person's usual weekly-off days
     */
    static String cellFor(WeeklyOffMode mode, List<PatternDay> pattern, boolean repeats, int offset,
                          int dayIndex, int workingDaysBefore, boolean personalOff) {
        if (mode == WeeklyOffMode.FIXED && personalOff) return RosterContract.WO;
        int n = pattern.size();
        if (n == 0) return null;
        int step = (mode == WeeklyOffMode.FIXED ? workingDaysBefore : dayIndex) + offset;
        if (!repeats && step >= n) return null;
        PatternDay day = pattern.get(Math.floorMod(step, n));
        if (isOff(day)) return mode == WeeklyOffMode.CUSTOM ? null : RosterContract.WO;
        return day.shiftPolicyId().toString();
    }

    /** A pattern day is a weekly off when it says so or names no shift (each day is exactly one of the two). */
    static boolean isOff(PatternDay day) {
        return day == null || day.weeklyOff() || day.shiftPolicyId() == null;
    }

    /**
     * One person's generated row: {@code personalOff[i]} = day {@code i} is one of their usual weekly-off days
     * (only read in FIXED mode).
     */
    static String[] row(WeeklyOffMode mode, List<PatternDay> pattern, boolean repeats, int offset, boolean[] personalOff) {
        String[] out = new String[personalOff.length];
        int w = 0;
        for (int i = 0; i < out.length; i++) {
            out[i] = cellFor(mode, pattern, repeats, offset, i, w, personalOff[i]);
            if (!personalOff[i]) w++;
        }
        return out;
    }

    /** "Spread start days": the j-th of k people of a designation starts on pattern day {@code floor(j × N / k) mod N}. */
    static int spread(int j, int k, int n) {
        if (n <= 0 || k <= 0) return 0;
        return (int) Math.floorMod((long) j * n / k, (long) n);
    }

    /** An offset as it is stored: 0..N−1 with a pattern, else 0..61. */
    static int normalize(int offset, int n) {
        if (n > 0) return Math.floorMod(offset, n);
        return Math.max(0, Math.min(MAX_OFFSET, offset));
    }

    /**
     * The offsets as used, in member order. A member keeps the offset it came with; a member that has none
     * ({@code given[i] < 0}) gets one by the stagger mode:
     * <ul>
     *   <li>SPREAD: by {@link #spread} within their designation group (members grouped by designation in member
     *       order; the people with no designation are one group). The group is the whole designation, so the
     *       first Generate gives exactly the design's offsets.</li>
     *   <li>SAME: 0.</li>
     *   <li>CONTINUE: people who were on {@code previous} continue their cycle ({@link #continued}); anyone else
     *       is spread. Without a usable previous roster (not found, or another pattern) everyone is spread.</li>
     * </ul>
     *
     * @param designations each member's designation (null = no designation), same order as {@code members}
     */
    static int[] offsets(List<UUID> members, List<UUID> designations, int[] given, StaggerMode stagger,
                         List<PatternDay> pattern, LocalDate start, PlanFacts.PreviousRoster previous,
                         Map<UUID, Map<LocalDate, BaselineDay>> baseline) {
        int n = pattern.size();
        int[] out = new int[members.size()];
        // Each member's place in its designation group, and the group sizes.
        Map<UUID, List<Integer>> groups = new LinkedHashMap<>();
        for (int i = 0; i < members.size(); i++) {
            groups.computeIfAbsent(designations.get(i), k -> new ArrayList<>()).add(i);
        }
        int[] spreadOf = new int[members.size()];
        for (List<Integer> group : groups.values()) {
            for (int j = 0; j < group.size(); j++) spreadOf[group.get(j)] = spread(j, group.size(), n);
        }
        boolean canContinue = stagger == StaggerMode.CONTINUE && usable(previous, pattern, start);
        for (int i = 0; i < members.size(); i++) {
            if (given[i] >= 0) {
                out[i] = normalize(given[i], n);
                continue;
            }
            Integer cont = canContinue ? continued(previous, members.get(i), start, n, baseline) : null;
            if (cont != null) out[i] = cont;
            else if (stagger == StaggerMode.SAME) out[i] = 0;
            else out[i] = spreadOf[i];
        }
        return out;
    }

    /** "Continue from" applies to a published roster that ends the day before {@code start} and used the same pattern. */
    static boolean usable(PlanFacts.PreviousRoster previous, List<PatternDay> pattern, LocalDate start) {
        return previous != null && !pattern.isEmpty() && previous.endDate() != null && previous.startDate() != null
                && previous.endDate().plusDays(1).equals(start)
                && samePattern(previous.pattern(), pattern);
    }

    static boolean samePattern(List<PatternDay> a, List<PatternDay> b) {
        if (a == null || b == null || a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) {
            PatternDay x = a.get(i), y = b.get(i);
            if (isOff(x) != isOff(y)) return false;
            if (!isOff(x) && !Objects.equals(x.shiftPolicyId(), y.shiftPolicyId())) return false;
        }
        return true;
    }

    /**
     * The offset that carries a person's cycle on from {@code previous}, or null when they were not on it.
     * ROTATIONAL / CUSTOM (design §1.3): {@code (o_prev + (start − start_prev)) mod N}. A FIXED previous roster
     * advanced its cycle on working days only, so there the advance is the person's non-off days in the previous
     * period (from the baseline; a date the baseline does not know counts as a working day). Either way the
     * person is on the next pattern day on the first day of this period.
     */
    static Integer continued(PlanFacts.PreviousRoster previous, UUID employeeId, LocalDate start, int n,
                             Map<UUID, Map<LocalDate, BaselineDay>> baseline) {
        Integer prev = previous.offsets() == null ? null : previous.offsets().get(employeeId);
        if (prev == null || n <= 0) return null;
        long advance;
        if (previous.weeklyOffMode() == WeeklyOffMode.FIXED) {
            Map<LocalDate, BaselineDay> days = baseline == null ? null : baseline.get(employeeId);
            advance = 0;
            for (LocalDate d = previous.startDate(); d.isBefore(start); d = d.plusDays(1)) {
                BaselineDay b = days == null ? null : days.get(d);
                if (b == null || !b.weeklyOff()) advance++;
            }
        } else {
            advance = ChronoUnit.DAYS.between(previous.startDate(), start);
        }
        return (int) Math.floorMod(prev + advance, (long) n);
    }
}
