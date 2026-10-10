package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.Overlay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.ScheduleDay;
import com.hrms.api.roster.RosterContract.ScheduleDaySource;
import com.hrms.api.roster.RosterContract.ScheduleKind;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Each person's effective schedule for a period (design §0.3, §1.2): the published schedule day when
 * there is one, else today's answer ({@link BaselineSchedule}), plus the overlays worked out on read
 * (D-S6): PH = an active company holiday (Settings › Holidays, the calendar attendance uses), L =
 * approved leave covering the day, COFF = approved leave of a COMPENSATORY-category type. Shown in the
 * week grid's order: PH over L/COFF over the planned day.
 *
 * <p>Phase 1: read by the two schedule endpoints only. Attendance, late marks, overtime, payroll and
 * leave never call it (they switch in Phase 3, inside the resolver, behind the company's switch).
 */
@Service
public class EffectiveSchedule {

    /** A person to show, with their name (null for "me"). */
    public record Person(UUID employeeId, String name) {}

    private final JdbcTemplate jdbc;
    private final RosterStore store;
    private final BaselineSchedule baseline;
    private final ShiftCatalog shifts;

    public EffectiveSchedule(JdbcTemplate jdbc, RosterStore store, BaselineSchedule baseline, ShiftCatalog shifts) {
        this.jdbc = jdbc;
        this.store = store;
        this.baseline = baseline;
        this.shifts = shifts;
    }

    /** Every person's days {@code from..to}, person by person in the order given, then by date. */
    @Transactional(readOnly = true)
    public List<ScheduleDay> days(UUID tenant, List<Person> people, LocalDate from, LocalDate to) {
        if (people.isEmpty()) return List.of();
        List<UUID> ids = people.stream().map(Person::employeeId).distinct().toList();
        Map<String, RosterStore.Day> rostered = new HashMap<>();
        for (RosterStore.Day d : store.days(tenant, ids, from, to)) rostered.put(d.employeeId() + "|" + d.date(), d);
        Map<UUID, List<BaselineSchedule.BaselineDay>> base = baseline.between(tenant, ids, from, to);
        Map<String, String> holidays = holidays(tenant, ids, from, to);
        Map<String, Overlay> leave = leave(tenant, ids, from, to);

        Set<UUID> shiftIds = new HashSet<>();
        rostered.values().forEach(d -> { if (d.shiftPolicyId() != null) shiftIds.add(d.shiftPolicyId()); });
        base.values().forEach(list -> list.forEach(b -> { if (b.shiftPolicyId() != null) shiftIds.add(b.shiftPolicyId()); }));
        Map<UUID, ShiftCatalog.Shift> catalog = shifts.byIds(tenant, shiftIds);

        List<ScheduleDay> out = new ArrayList<>();
        Set<UUID> done = new HashSet<>();
        for (Person p : people) {
            if (!done.add(p.employeeId())) continue;
            Map<LocalDate, BaselineSchedule.BaselineDay> mine = new HashMap<>();
            for (BaselineSchedule.BaselineDay b : base.getOrDefault(p.employeeId(), List.of())) mine.put(b.date(), b);
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                String key = p.employeeId() + "|" + d;
                Overlay overlay = holidays.containsKey(key) ? new Overlay(OverlayType.PH, holidays.get(key), false) : leave.get(key);
                RosterStore.Day r = rostered.get(key);
                if (r != null) {
                    out.add(day(p, d, RosterStore.WO.equals(r.kind()) ? null : r.shiftPolicyId(), RosterStore.WO.equals(r.kind()),
                            ScheduleDaySource.ROSTER, r.rosterId(), r.rosterName(), overlay, catalog));
                } else {
                    BaselineSchedule.BaselineDay b = mine.get(d);
                    boolean off = b != null && b.weeklyOff();
                    out.add(day(p, d, b == null || off ? null : b.shiftPolicyId(), off, ScheduleDaySource.BASELINE, null, null,
                            overlay, catalog));
                }
            }
        }
        return out;
    }

    private static ScheduleDay day(Person p, LocalDate date, UUID shiftId, boolean weeklyOff, ScheduleDaySource source,
                                   UUID rosterId, String rosterName, Overlay overlay, Map<UUID, ShiftCatalog.Shift> catalog) {
        if (weeklyOff) {
            return new ScheduleDay(p.employeeId(), p.name(), date, ScheduleKind.WO, null, RosterStore.WO, null, null, null, false,
                    source, rosterId, rosterName, overlay);
        }
        ShiftCatalog.Shift s = shiftId == null ? null : catalog.get(shiftId);
        if (s == null) {
            return new ScheduleDay(p.employeeId(), p.name(), date, ScheduleKind.NONE, null, null, null, null, null, false,
                    source, rosterId, rosterName, overlay);
        }
        return new ScheduleDay(p.employeeId(), p.name(), date, ScheduleKind.SHIFT, s.id(), s.label(), s.name(), s.startText(),
                s.endText(), s.night(), source, rosterId, rosterName, overlay);
    }

    /** person|date → holiday name: active holidays of each person's company (as attendance counts them). */
    Map<String, String> holidays(UUID tenant, Collection<UUID> ids, LocalDate from, LocalDate to) {
        Map<String, String> out = new LinkedHashMap<>();
        jdbc.query("""
                SELECT e.id AS employee_id, h.holiday_date, h.holiday_name
                  FROM hrms.employees e
                  JOIN settings.holiday_calendar h ON h.company_id = e.company_id AND h.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.id = ANY(CAST(? AS uuid[])) AND h.is_active = TRUE AND h.holiday_date BETWEEN ? AND ?
                 ORDER BY h.holiday_date, h.holiday_name
                """, (RowCallbackHandler) rs -> out.putIfAbsent(rs.getObject("employee_id", UUID.class) + "|"
                        + rs.getObject("holiday_date", LocalDate.class), rs.getString("holiday_name")),
                tenant, PlannerScopeService.uuidArray(ids), from, to);
        return out;
    }

    /** person|date → L or COFF overlay from approved leave covering the day. */
    Map<String, Overlay> leave(UUID tenant, Collection<UUID> ids, LocalDate from, LocalDate to) {
        Map<String, Overlay> out = new HashMap<>();
        jdbc.query("""
                SELECT lr.employee_id, lr.start_date, lr.end_date, lr.half_day, lt.name AS type_name, lt.category
                  FROM leave_mgmt.leave_requests lr
                  LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id
                 WHERE lr.tenant_id = ? AND lr.employee_id = ANY(CAST(? AS uuid[])) AND lr.status = 'APPROVED'
                   AND lr.start_date <= ? AND lr.end_date >= ?
                 ORDER BY lr.start_date
                """, (RowCallbackHandler) rs -> {
            UUID e = rs.getObject("employee_id", UUID.class);
            LocalDate s = rs.getObject("start_date", LocalDate.class), t = rs.getObject("end_date", LocalDate.class);
            boolean coff = "COMPENSATORY".equalsIgnoreCase(rs.getString("category"));
            String label = rs.getString("type_name") == null ? (coff ? "Comp-off" : "Leave") : rs.getString("type_name");
            Overlay o = new Overlay(coff ? OverlayType.COFF : OverlayType.L, label, rs.getBoolean("half_day"));
            for (LocalDate d = s.isBefore(from) ? from : s; !d.isAfter(t) && !d.isAfter(to); d = d.plusDays(1)) {
                out.putIfAbsent(e + "|" + d, o);
            }
        }, tenant, PlannerScopeService.uuidArray(ids), to, from);
        return out;
    }
}
