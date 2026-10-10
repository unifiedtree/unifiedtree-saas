package com.hrms.api.roster;

import com.hrms.attendance.service.AttendanceCalendar;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The one place {@link BaselineSchedule} meets attendance's own rules (design §0.2): the shift in
 * force and the attendance weekly-off rule, read, never changed, for the planner and the schedule
 * endpoints. Nothing in attendance, overtime, payroll or leave calls this.
 *
 * <ul>
 *   <li><b>Weekly off</b>: {@link AttendanceCalendar#resolveWeeklyOffDays} itself (own days, else the
 *       shift's, else the company's, else Saturday and Sunday), which the shift resolver of
 *       {@code shift/p0-resolver} also delegates to. Its only dependence on the date is the shift in
 *       force, so it is asked on the first day and on each day someone's assignments start or end,
 *       and that answer holds until the next such day.</li>
 *   <li><b>Shift in force</b>: the resolver's attendance rule ({@code EffectiveShiftResolver.attendanceShifts}
 *       + {@code inForceOn}): of the person's assignments covering the date whose shift is active, the
 *       one that started last; none, no shift.</li>
 * </ul>
 *
 * <p><b>Bridge until {@code shift/p0-resolver} is merged.</b> The resolver is not on this branch's
 * base, so {@link #candidates} and {@link #inForceOn} repeat its {@code attendanceShifts} query and
 * {@code inForceOn} pick word for word. When the resolver lands, their bodies become
 * {@code EffectiveShiftResolver.attendanceShifts(jdbc, ids, from, to)} and
 * {@code EffectiveShiftResolver.inForceOn(list, date)}; nothing else in shift planning changes.
 * The tenant is the caller's (row-level security), as in the resolver.
 */
@Component
public class BaselineScheduleAdapter implements BaselineSchedule {

    private final JdbcTemplate jdbc;

    public BaselineScheduleAdapter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Map<UUID, List<BaselineDay>> between(UUID tenantId, Collection<UUID> employeeIds, LocalDate from, LocalDate to) {
        Map<UUID, List<BaselineDay>> out = new LinkedHashMap<>();
        if (employeeIds == null || employeeIds.isEmpty() || from == null || to == null || to.isBefore(from)) return out;
        List<UUID> ids = new ArrayList<>(new LinkedHashSet<>(employeeIds));
        Map<UUID, List<Assignment>> assignments = candidates(ids, from, to);

        // The weekly-off rule, asked where its answer can change.
        TreeSet<LocalDate> asks = new TreeSet<>();
        asks.add(from);
        for (List<Assignment> list : assignments.values()) {
            for (Assignment s : list) {
                if (s.effectiveFrom() != null && s.effectiveFrom().isAfter(from) && !s.effectiveFrom().isAfter(to)) asks.add(s.effectiveFrom());
                if (s.effectiveTo() != null && !s.effectiveTo().isBefore(from) && s.effectiveTo().isBefore(to)) asks.add(s.effectiveTo().plusDays(1));
            }
        }
        NavigableMap<LocalDate, Map<UUID, Set<Integer>>> offs = new TreeMap<>();
        for (LocalDate d : asks) offs.put(d, AttendanceCalendar.resolveWeeklyOffDays(jdbc, ids, d));

        for (UUID id : ids) {
            List<Assignment> mine = assignments.getOrDefault(id, List.of());
            List<BaselineDay> days = new ArrayList<>();
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                Assignment s = inForceOn(mine, d);
                Set<Integer> off = offs.floorEntry(d).getValue().getOrDefault(id, AttendanceCalendar.DEFAULT_OFF_DAYS);
                days.add(new BaselineDay(d, s == null ? null : s.shiftPolicyId(), off.contains(d.getDayOfWeek().getValue())));
            }
            out.put(id, days);
        }
        return out;
    }

    /** One assignment covering part of the period, with an active shift. */
    record Assignment(UUID employeeId, LocalDate effectiveFrom, LocalDate effectiveTo, UUID shiftPolicyId) {
        boolean covers(LocalDate date) {
            return date != null && effectiveFrom != null && !effectiveFrom.isAfter(date)
                    && (effectiveTo == null || !effectiveTo.isBefore(date));
        }
    }

    /**
     * BRIDGE = {@code EffectiveShiftResolver.attendanceShifts(jdbc, ids, from, to)}: every assignment
     * covering a day of the period whose shift is active, per person, latest start first.
     */
    Map<UUID, List<Assignment>> candidates(List<UUID> ids, LocalDate from, LocalDate to) {
        Map<UUID, List<Assignment>> out = new HashMap<>();
        jdbc.query("""
                SELECT esa.employee_id, esa.effective_from, esa.effective_to, esa.shift_policy_id
                  FROM attendance.employee_shift_assignments esa
                  JOIN attendance.shift_policies sp ON sp.id = esa.shift_policy_id
                 WHERE esa.employee_id = ANY(CAST(? AS uuid[])) AND sp.is_active = TRUE
                   AND esa.effective_from <= ? AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                 ORDER BY esa.employee_id, esa.effective_from DESC
                """, (RowCallbackHandler) rs -> {
            Assignment s = new Assignment(rs.getObject("employee_id", UUID.class), rs.getObject("effective_from", LocalDate.class),
                    rs.getObject("effective_to", LocalDate.class), rs.getObject("shift_policy_id", UUID.class));
            out.computeIfAbsent(s.employeeId(), k -> new ArrayList<>()).add(s);
        }, PlannerScopeService.uuidArray(ids), java.sql.Date.valueOf(to), java.sql.Date.valueOf(from));
        return out;
    }

    /** BRIDGE = {@code EffectiveShiftResolver.inForceOn}: the latest start covering {@code date} (the first such on a tie). */
    static Assignment inForceOn(List<Assignment> candidates, LocalDate date) {
        Assignment best = null;
        if (candidates == null) return null;
        for (Assignment s : candidates) {
            if (!s.covers(date)) continue;
            if (best == null || s.effectiveFrom().isAfter(best.effectiveFrom())) best = s;
        }
        return best;
    }
}
