package com.hrms.api.roster.plan;

import com.hrms.api.roster.RosterContract.CoverageDay;
import com.hrms.api.roster.RosterContract.CoverageRow;
import com.hrms.api.roster.RosterContract.CoverageStatus;
import com.hrms.api.roster.RosterContract.StaffingIn;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Coverage per date × shift × designation (design §1.3): {@code scheduled(d, s, g)} = members of designation
 * {@code g} whose cell on {@code d} is shift {@code s}, minus those on approved full-day leave (L or COFF) that
 * day; half-day leave still counts. A holiday column is not checked (status HOLIDAY). Status: OK (scheduled =
 * required), SHORT (fewer), OVER (more), NONE (no requirement).
 *
 * <p>Rows, per shift: first the shift's total over all designations ({@code designationId} null; required = the
 * sum of the designations' requirements, SHORT when any designation is short), then one row per designation that
 * has a requirement for the shift or anyone on it. People with no designation ({@link #NO_DESIGNATION}, pending
 * default 8) count in the total's scheduled number and toward no requirement.
 */
final class Coverage {

    private Coverage() {}

    /** The "No designation" bucket: counted in the totals, required for nothing, no row of its own. */
    static final UUID NO_DESIGNATION = null;

    /** A run of SHORT (W3) or OVER (I2) days for one shift and designation. */
    record Gap(UUID shiftPolicyId, UUID designationId, int required, List<LocalDate> dates, int minScheduled,
               int maxScheduled) {}

    record Result(List<CoverageRow> rows, List<Gap> shorts, List<Gap> overs, List<UUID> nightShifts,
                  List<LocalDate> nightUncovered) {}

    /**
     * @param columns the shifts the preview shows (ticked shifts first, then any with a requirement, then any
     *                used in a cell), already in order
     */
    static Result compute(Grid g, List<UUID> columns, List<StaffingIn> staffing) {
        int days = g.days();
        // required[(designation, shift)], the last entry winning when the same pair is sent twice
        Map<UUID, Map<UUID, Integer>> required = new HashMap<>();
        for (StaffingIn s : staffing) {
            if (s == null || s.designationId() == null || s.shiftPolicyId() == null) continue;
            required.computeIfAbsent(s.shiftPolicyId(), k -> new HashMap<>()).put(s.designationId(), Math.max(0, s.required()));
        }
        // counts[shift][designation][day] and the shift's total over everyone
        Map<UUID, Map<UUID, int[]>> counts = new HashMap<>();
        Map<UUID, int[]> totals = new HashMap<>();
        for (UUID s : columns) {
            counts.put(s, new HashMap<>());
            totals.put(s, new int[days]);
        }
        for (int m = 0; m < g.members.size(); m++) {
            UUID designation = g.designations.get(m);
            for (int i = 0; i < days; i++) {
                UUID s = Grid.shiftId(g.tokens[m][i]);
                if (s == null || !totals.containsKey(s) || g.fullLeave[m][i]) continue;
                totals.get(s)[i]++;
                if (designation != NO_DESIGNATION) {
                    counts.get(s).computeIfAbsent(designation, k -> new int[days])[i]++;
                }
            }
        }

        List<CoverageRow> rows = new ArrayList<>();
        List<Gap> shorts = new ArrayList<>();
        List<Gap> overs = new ArrayList<>();
        for (UUID s : columns) {
            PlanFacts.Shift shift = g.facts.shifts().get(s);
            String code = shift == null ? null : shift.displayCode();
            Map<UUID, Integer> req = required.getOrDefault(s, Map.of());
            Map<UUID, int[]> byDesignation = counts.get(s);
            Set<UUID> designations = new LinkedHashSet<>();
            designations.addAll(req.keySet());
            designations.addAll(byDesignation.keySet());
            List<UUID> ordered = new ArrayList<>(designations);
            ordered.sort(Comparator.comparing((UUID d) -> designationName(g, d).toLowerCase())
                    .thenComparing(UUID::toString));

            Integer totalRequired = req.isEmpty() ? null : req.values().stream().mapToInt(Integer::intValue).sum();
            boolean[] anyShort = new boolean[days];
            List<CoverageRow> designationRows = new ArrayList<>();
            for (UUID d : ordered) {
                Integer r = req.get(d);
                int[] c = byDesignation.getOrDefault(d, new int[days]);
                List<CoverageDay> perDay = new ArrayList<>(days);
                List<LocalDate> shortDates = new ArrayList<>(), overDates = new ArrayList<>();
                int shortMin = Integer.MAX_VALUE, shortMax = 0, overMin = Integer.MAX_VALUE, overMax = 0;
                for (int i = 0; i < days; i++) {
                    CoverageStatus st = status(g.holiday[i], r, c[i]);
                    perDay.add(new CoverageDay(r, c[i], st));
                    if (st == CoverageStatus.SHORT) {
                        anyShort[i] = true;
                        shortDates.add(g.dates.get(i));
                        shortMin = Math.min(shortMin, c[i]);
                        shortMax = Math.max(shortMax, c[i]);
                    } else if (st == CoverageStatus.OVER) {
                        overDates.add(g.dates.get(i));
                        overMin = Math.min(overMin, c[i]);
                        overMax = Math.max(overMax, c[i]);
                    }
                }
                designationRows.add(new CoverageRow(s, code, d, perDay));
                if (!shortDates.isEmpty()) shorts.add(new Gap(s, d, r, shortDates, shortMin, shortMax));
                if (!overDates.isEmpty()) overs.add(new Gap(s, d, r, overDates, overMin, overMax));
            }
            int[] t = totals.get(s);
            List<CoverageDay> totalDays = new ArrayList<>(days);
            for (int i = 0; i < days; i++) {
                CoverageStatus st;
                if (g.holiday[i]) st = CoverageStatus.HOLIDAY;
                else if (totalRequired == null) st = CoverageStatus.NONE;
                else if (anyShort[i]) st = CoverageStatus.SHORT;
                else if (t[i] > totalRequired) st = CoverageStatus.OVER;
                else st = CoverageStatus.OK;
                totalDays.add(new CoverageDay(totalRequired, t[i], st));
            }
            rows.add(new CoverageRow(s, code, null, totalDays));
            rows.addAll(designationRows);
        }

        // Night coverage (W5): the roster uses a night shift and nobody works one on a (non-holiday) date.
        List<UUID> nights = new ArrayList<>();
        for (UUID s : columns) {
            PlanFacts.Shift shift = g.facts.shifts().get(s);
            if (shift != null && shift.night()) nights.add(s);
        }
        List<LocalDate> uncovered = new ArrayList<>();
        if (!nights.isEmpty()) {
            for (int i = 0; i < days; i++) {
                if (g.holiday[i]) continue;
                int onNight = 0;
                for (UUID s : nights) onNight += totals.get(s)[i];
                if (onNight == 0) uncovered.add(g.dates.get(i));
            }
        }
        return new Result(rows, shorts, overs, nights, uncovered);
    }

    static CoverageStatus status(boolean holiday, Integer required, int scheduled) {
        if (holiday) return CoverageStatus.HOLIDAY;
        if (required == null) return CoverageStatus.NONE;
        if (scheduled == required) return CoverageStatus.OK;
        return scheduled < required ? CoverageStatus.SHORT : CoverageStatus.OVER;
    }

    /** A designation's title from the members, else the company's list, else a placeholder. */
    static String designationName(Grid g, UUID designationId) {
        if (designationId == null) return "No designation";
        for (PlanFacts.Person p : g.persons) {
            if (p != null && designationId.equals(p.designationId()) && p.designationName() != null) return p.designationName();
        }
        String n = g.facts.designationNames().get(designationId);
        return n == null ? "Unknown designation" : n;
    }

    /**
     * The coverage columns: the ticked shifts in their order, then shifts with a requirement, then shifts used in
     * a cell (first use first). Each once.
     */
    static List<UUID> columns(List<UUID> ticked, List<StaffingIn> staffing, Grid g) {
        LinkedHashMap<UUID, Boolean> out = new LinkedHashMap<>();
        for (UUID s : ticked) if (s != null) out.putIfAbsent(s, true);
        for (StaffingIn s : staffing) if (s != null && s.shiftPolicyId() != null) out.putIfAbsent(s.shiftPolicyId(), true);
        for (int m = 0; m < g.members.size(); m++) {
            for (int i = 0; i < g.days(); i++) {
                UUID s = Grid.shiftId(g.tokens[m][i]);
                if (s != null) out.putIfAbsent(s, true);
            }
        }
        return new ArrayList<>(out.keySet());
    }
}
