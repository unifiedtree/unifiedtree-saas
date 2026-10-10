package com.hrms.api.roster;

import com.hrms.attendance.service.AttendanceCalendar;
import com.hrms.attendance.service.EffectiveShiftResolver;
import com.hrms.attendance.service.EffectiveShiftResolver.EffectiveShift;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
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
 * The one place {@link BaselineSchedule} meets the shared shift resolver (design §0.2): today's answer
 * for a person and date with no roster, read, never changed, for the planner and the schedule
 * endpoints. Nothing in attendance, overtime, payroll or leave calls this. When the resolver's API
 * moves, only this class changes.
 *
 * <ul>
 *   <li><b>Shift in force</b>: the resolver's attendance rule,
 *       {@link EffectiveShiftResolver#attendanceShifts} then {@link EffectiveShiftResolver#inForceOn}
 *       for each date (of the person's assignments covering the date whose shift is active, the one
 *       that started last; none, no shift).</li>
 *   <li><b>Weekly off</b>: attendance's own rule, {@link AttendanceCalendar#resolveWeeklyOffDays}
 *       (own days, else the shift's, else the company's, else Saturday and Sunday), not the leave or
 *       payroll rule. Its only dependence on the date is the shift in force, so it is asked on the
 *       first day and on each day someone's assignments start or end, and that answer holds until the
 *       next such day.</li>
 * </ul>
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
        Map<UUID, List<EffectiveShift>> assignments = shifts(ids, from, to);

        // The weekly-off rule, asked where its answer can change.
        TreeSet<LocalDate> asks = new TreeSet<>();
        asks.add(from);
        for (List<EffectiveShift> list : assignments.values()) {
            for (EffectiveShift s : list) {
                if (s.effectiveFrom() != null && s.effectiveFrom().isAfter(from) && !s.effectiveFrom().isAfter(to)) asks.add(s.effectiveFrom());
                if (s.effectiveTo() != null && !s.effectiveTo().isBefore(from) && s.effectiveTo().isBefore(to)) asks.add(s.effectiveTo().plusDays(1));
            }
        }
        NavigableMap<LocalDate, Map<UUID, Set<Integer>>> offs = new TreeMap<>();
        for (LocalDate d : asks) offs.put(d, weeklyOffDays(ids, d));

        for (UUID id : ids) {
            List<EffectiveShift> mine = assignments.getOrDefault(id, List.of());
            List<BaselineDay> days = new ArrayList<>();
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                EffectiveShift s = EffectiveShiftResolver.inForceOn(mine, d);
                Set<Integer> off = offs.floorEntry(d).getValue().getOrDefault(id, AttendanceCalendar.DEFAULT_OFF_DAYS);
                days.add(new BaselineDay(d, s == null ? null : s.shiftPolicyId(), off.contains(d.getDayOfWeek().getValue())));
            }
            out.put(id, days);
        }
        return out;
    }

    /** The resolver's candidates: every assignment covering a day of the period whose shift is active, per person. */
    Map<UUID, List<EffectiveShift>> shifts(List<UUID> ids, LocalDate from, LocalDate to) {
        return EffectiveShiftResolver.attendanceShifts(jdbc, ids, from, to);
    }

    /** Attendance's weekly-off rule on {@code date} (Saturday and Sunday for everyone without a database). */
    Map<UUID, Set<Integer>> weeklyOffDays(List<UUID> ids, LocalDate date) {
        return AttendanceCalendar.resolveWeeklyOffDays(jdbc, ids, date);
    }
}
