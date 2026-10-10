package com.hrms.api.roster.plan;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.hrms.api.roster.BaselineSchedule;
import com.hrms.api.roster.BaselineSchedule.BaselineDay;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.core.exception.FeatureNotReady;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Array;
import java.sql.Date;
import java.sql.SQLException;
import java.sql.Time;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Loads the {@link PlanFacts} of one plan with one bulk query per kind of fact (design §1.3). Read only; every
 * query names the tenant as well (row-level security does too).
 *
 * <ul>
 *   <li>Shifts: every shift of the company, active or not (E1 tells a deleted one from a usable one), and any other
 *       shift a published day or the baseline refers to.</li>
 *   <li>People: the members' employee records (an inactive record counts as not found).</li>
 *   <li>Baseline: {@link BaselineSchedule} (today's rule, no roster), {@code from..to}; from the earliest start of
 *       a roster that ends on {@code from} when there is one ("Continue from" a FIXED roster counts its working
 *       days).</li>
 *   <li>Holidays: the company's active {@code settings.holiday_calendar} rows, the ones attendance uses.</li>
 *   <li>Leave: APPROVED leave requests overlapping the range; category COMPENSATORY = COFF; half day = the request's
 *       half-day flag or a HALF_DAY duration (the team schedule's rule).</li>
 *   <li>Other rosters: published {@code schedule_days} of these people that belong to another roster.</li>
 *   <li>Previous rosters: the company's PUBLISHED rosters that end on {@code from}, the day before the period.</li>
 *   <li>The company's minimum rest ({@code roster_settings}, 480 minutes when it has none).</li>
 * </ul>
 * A missing shift-planning table (V143.106 not applied) answers FEATURE_NOT_READY, and so does a baseline that is
 * not available yet.
 */
@Service
public class JdbcPlanFactsLoader implements PlanFactsLoader {

    private static final Logger log = LoggerFactory.getLogger(JdbcPlanFactsLoader.class);

    private final JdbcTemplate jdbc;
    private final BaselineSchedule baseline;
    private final ObjectReader configReader;

    public JdbcPlanFactsLoader(JdbcTemplate jdbc, BaselineSchedule baseline, ObjectMapper json) {
        this.jdbc = jdbc;
        this.baseline = baseline;
        this.configReader = json.readerFor(RosterConfig.class).without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    @Override
    @Transactional(readOnly = true)
    public PlanFacts load(UUID tenantId, UUID companyId, UUID rosterId, Collection<UUID> employeeIds,
                          LocalDate from, LocalDate to) {
        List<UUID> ids = employeeIds == null ? List.of() : new ArrayList<>(new LinkedHashSet<>(employeeIds));
        ids.removeIf(java.util.Objects::isNull);
        return FeatureNotReady.guard(() -> {
            Map<UUID, PlanFacts.Person> people = people(tenantId, ids);
            Map<LocalDate, String> holidays = holidays(tenantId, companyId, from, to);
            Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave = leave(tenantId, ids, from, to);
            Map<UUID, Map<LocalDate, PlanFacts.OtherDay>> other = otherRosterDays(tenantId, companyId, rosterId, ids, from, to);
            List<PlanFacts.PreviousRoster> previous = previousRosters(tenantId, companyId, rosterId, from);
            LocalDate baselineFrom = from;
            for (PlanFacts.PreviousRoster p : previous) {
                if (p.startDate().isBefore(baselineFrom)) baselineFrom = p.startDate();
            }
            Map<UUID, Map<LocalDate, BaselineDay>> base = baseline(tenantId, ids, baselineFrom, to);
            Set<UUID> referenced = new LinkedHashSet<>();
            other.values().forEach(days -> days.values().forEach(d -> { if (d.shiftPolicyId() != null) referenced.add(d.shiftPolicyId()); }));
            base.values().forEach(days -> days.values().forEach(d -> { if (d.shiftPolicyId() != null) referenced.add(d.shiftPolicyId()); }));
            Map<UUID, PlanFacts.Shift> shifts = shifts(tenantId, companyId, referenced);
            return new PlanFacts(companyId, shifts, people, base, holidays, leave, other, previous,
                    names(tenantId, companyId, "SELECT id, title AS name FROM hrms.designations WHERE tenant_id = ? AND company_id = ?"),
                    names(tenantId, companyId, "SELECT id, name FROM hrms.departments WHERE tenant_id = ? AND company_id = ?"),
                    names(tenantId, companyId, "SELECT id, name FROM org.branches WHERE tenant_id = ? AND company_id = ?"),
                    minRest(tenantId, companyId), null);
        });
    }

    private Map<UUID, PlanFacts.Shift> shifts(UUID tenantId, UUID companyId, Set<UUID> referenced) {
        Map<UUID, PlanFacts.Shift> out = new LinkedHashMap<>();
        RowCallbackHandler row = rs -> {
            Time s = rs.getTime("start_time"), e = rs.getTime("end_time");
            UUID id = rs.getObject("id", UUID.class);
            out.put(id, new PlanFacts.Shift(id, rs.getObject("company_id", UUID.class), rs.getString("code"),
                    rs.getString("name"), s == null ? null : s.toLocalTime(), e == null ? null : e.toLocalTime(),
                    rs.getString("shift_type"), rs.getBoolean("is_active")));
        };
        jdbc.query("""
                SELECT id, company_id, code, name, start_time, end_time, shift_type, is_active
                  FROM attendance.shift_policies
                 WHERE tenant_id = ? AND company_id = ?
                 ORDER BY name, id
                """, row, tenantId, companyId);
        List<UUID> missing = referenced.stream().filter(id -> !out.containsKey(id)).toList();
        if (!missing.isEmpty()) {
            jdbc.query(con -> {
                var ps = con.prepareStatement("""
                        SELECT id, company_id, code, name, start_time, end_time, shift_type, is_active
                          FROM attendance.shift_policies
                         WHERE tenant_id = ? AND id = ANY (?)
                        """);
                ps.setObject(1, tenantId);
                ps.setArray(2, uuids(con, missing));
                return ps;
            }, row);
        }
        return out;
    }

    private Map<UUID, PlanFacts.Person> people(UUID tenantId, List<UUID> ids) {
        Map<UUID, PlanFacts.Person> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.query(con -> {
            var ps = con.prepareStatement("""
                    SELECT e.id, e.company_id, concat_ws(' ', e.first_name, e.last_name) AS name, e.employee_code,
                           e.designation_id, ds.title AS designation_name,
                           e.department_id, dp.name AS department_name,
                           e.branch_id, b.name AS branch_name,
                           e.date_of_joining, e.last_working_day
                      FROM hrms.employees e
                      LEFT JOIN hrms.designations ds ON ds.id = e.designation_id AND ds.tenant_id = e.tenant_id
                      LEFT JOIN hrms.departments dp ON dp.id = e.department_id AND dp.tenant_id = e.tenant_id
                      LEFT JOIN org.branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
                     WHERE e.tenant_id = ? AND e.is_active = TRUE AND e.id = ANY (?)
                    """);
            ps.setObject(1, tenantId);
            ps.setArray(2, uuids(con, ids));
            return ps;
        }, (RowCallbackHandler) rs -> {
            UUID id = rs.getObject("id", UUID.class);
            out.put(id, new PlanFacts.Person(id, rs.getObject("company_id", UUID.class), rs.getString("name"),
                    rs.getString("employee_code"),
                    rs.getObject("designation_id", UUID.class), rs.getString("designation_name"),
                    rs.getObject("department_id", UUID.class), rs.getString("department_name"),
                    rs.getObject("branch_id", UUID.class), rs.getString("branch_name"),
                    date(rs.getDate("date_of_joining")), date(rs.getDate("last_working_day"))));
        });
        return out;
    }

    private Map<UUID, Map<LocalDate, BaselineDay>> baseline(UUID tenantId, List<UUID> ids, LocalDate from, LocalDate to) {
        Map<UUID, Map<LocalDate, BaselineDay>> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        Map<UUID, List<BaselineDay>> days;
        try {
            days = baseline.between(tenantId, ids, from, to);
        } catch (UnsupportedOperationException e) {
            // The adapter over the shift resolver is not built yet: say so instead of planning on a guess.
            log.warn("Shift planning: the baseline schedule is not available yet ({})", e.getMessage());
            throw new FeatureNotReady();
        }
        if (days == null) return out;
        days.forEach((emp, list) -> {
            Map<LocalDate, BaselineDay> byDate = new HashMap<>();
            if (list != null) for (BaselineDay d : list) if (d != null && d.date() != null) byDate.put(d.date(), d);
            out.put(emp, byDate);
        });
        return out;
    }

    private Map<LocalDate, String> holidays(UUID tenantId, UUID companyId, LocalDate from, LocalDate to) {
        Map<LocalDate, String> out = new HashMap<>();
        jdbc.query("""
                SELECT holiday_date, string_agg(holiday_name, ', ' ORDER BY holiday_name) AS names
                  FROM settings.holiday_calendar
                 WHERE tenant_id = ? AND company_id = ? AND is_active AND holiday_date BETWEEN ? AND ?
                 GROUP BY holiday_date
                """, (RowCallbackHandler) rs -> out.put(rs.getDate("holiday_date").toLocalDate(), rs.getString("names")),
                tenantId, companyId, Date.valueOf(from), Date.valueOf(to));
        return out;
    }

    private Map<UUID, Map<LocalDate, PlanFacts.Leave>> leave(UUID tenantId, List<UUID> ids, LocalDate from, LocalDate to) {
        Map<UUID, Map<LocalDate, List<PlanFacts.Leave>>> all = new HashMap<>();
        if (ids.isEmpty()) return Map.of();
        jdbc.query(con -> {
            var ps = con.prepareStatement("""
                    SELECT lr.employee_id, lr.start_date, lr.end_date,
                           (lr.half_day OR coalesce(lr.duration, '') LIKE 'HALF_DAY%') AS half_day,
                           lt.name AS leave_type_name, lt.category
                      FROM leave_mgmt.leave_requests lr
                      LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id
                     WHERE lr.tenant_id = ? AND lr.employee_id = ANY (?) AND lr.status::text = 'APPROVED'
                       AND lr.start_date <= ? AND lr.end_date >= ?
                     ORDER BY lr.start_date, lr.created_at, lr.id
                    """);
            ps.setObject(1, tenantId);
            ps.setArray(2, uuids(con, ids));
            ps.setDate(3, Date.valueOf(to));
            ps.setDate(4, Date.valueOf(from));
            return ps;
        }, (RowCallbackHandler) rs -> {
            UUID emp = rs.getObject("employee_id", UUID.class);
            LocalDate s = rs.getDate("start_date").toLocalDate(), e = rs.getDate("end_date").toLocalDate();
            OverlayType type = "COMPENSATORY".equalsIgnoreCase(rs.getString("category")) ? OverlayType.COFF : OverlayType.L;
            String name = rs.getString("leave_type_name");
            PlanFacts.Leave l = new PlanFacts.Leave(type, name == null || name.isBlank() ? (type == OverlayType.COFF ? "Comp off" : "Leave") : name,
                    rs.getBoolean("half_day"));
            for (LocalDate d = s.isBefore(from) ? from : s; !d.isAfter(e) && !d.isAfter(to); d = d.plusDays(1)) {
                all.computeIfAbsent(emp, k -> new HashMap<>()).computeIfAbsent(d, k -> new ArrayList<>()).add(l);
            }
        });
        Map<UUID, Map<LocalDate, PlanFacts.Leave>> out = new HashMap<>();
        all.forEach((emp, byDate) -> {
            Map<LocalDate, PlanFacts.Leave> days = new HashMap<>();
            byDate.forEach((d, list) -> days.put(d, merge(list)));
            out.put(emp, days);
        });
        return out;
    }

    /**
     * Several approved leaves on one date: a full-day one wins (the first); two half days make a full day off;
     * otherwise the one half day.
     */
    static PlanFacts.Leave merge(List<PlanFacts.Leave> list) {
        for (PlanFacts.Leave l : list) if (!l.halfDay()) return l;
        PlanFacts.Leave first = list.get(0);
        return list.size() >= 2 ? new PlanFacts.Leave(first.type(), first.label(), false) : first;
    }

    private Map<UUID, Map<LocalDate, PlanFacts.OtherDay>> otherRosterDays(UUID tenantId, UUID companyId, UUID rosterId,
                                                                          List<UUID> ids, LocalDate from, LocalDate to) {
        Map<UUID, Map<LocalDate, PlanFacts.OtherDay>> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.query(con -> {
            // The roster being edited is only left out when it is one of this company's (a stray id hides nothing).
            var ps = con.prepareStatement("""
                    SELECT sd.employee_id, sd.work_date, sd.kind, sd.shift_policy_id, sd.roster_id, r.name AS roster_name
                      FROM attendance.schedule_days sd
                      LEFT JOIN attendance.rosters r ON r.id = sd.roster_id AND r.tenant_id = sd.tenant_id
                     WHERE sd.tenant_id = ? AND sd.employee_id = ANY (?) AND sd.work_date BETWEEN ? AND ?
                       AND NOT (sd.roster_id IS NOT DISTINCT FROM ? AND sd.company_id = ?)
                    """);
            ps.setObject(1, tenantId);
            ps.setArray(2, uuids(con, ids));
            ps.setDate(3, Date.valueOf(from));
            ps.setDate(4, Date.valueOf(to));
            ps.setObject(5, rosterId);
            ps.setObject(6, companyId);
            return ps;
        }, (RowCallbackHandler) rs -> out
                .computeIfAbsent(rs.getObject("employee_id", UUID.class), k -> new HashMap<>())
                .put(rs.getDate("work_date").toLocalDate(), new PlanFacts.OtherDay(rs.getObject("roster_id", UUID.class),
                        rs.getString("roster_name"), rs.getString("kind"), rs.getObject("shift_policy_id", UUID.class))));
        return out;
    }

    private List<PlanFacts.PreviousRoster> previousRosters(UUID tenantId, UUID companyId, UUID rosterId, LocalDate dayBefore) {
        List<PlanFacts.PreviousRoster> out = new ArrayList<>();
        Map<UUID, Object[]> heads = new LinkedHashMap<>();
        jdbc.query("""
                SELECT id, name, start_date, end_date, config::text AS config
                  FROM attendance.rosters
                 WHERE tenant_id = ? AND company_id = ? AND status = 'PUBLISHED' AND end_date = ?
                   AND id IS DISTINCT FROM ?
                 ORDER BY start_date, id
                """, (RowCallbackHandler) rs -> heads.put(rs.getObject("id", UUID.class), new Object[]{
                        rs.getString("name"), rs.getDate("start_date").toLocalDate(), rs.getDate("end_date").toLocalDate(),
                        rs.getString("config")}),
                tenantId, companyId, Date.valueOf(dayBefore), rosterId);
        if (heads.isEmpty()) return out;
        Map<UUID, Map<UUID, Integer>> offsets = new HashMap<>();
        List<UUID> rosterIds = new ArrayList<>(heads.keySet());
        jdbc.query(con -> {
            var ps = con.prepareStatement("""
                    SELECT roster_id, employee_id, rotation_offset FROM attendance.roster_members
                     WHERE tenant_id = ? AND roster_id = ANY (?)
                    """);
            ps.setObject(1, tenantId);
            ps.setArray(2, uuids(con, rosterIds));
            return ps;
        }, (RowCallbackHandler) rs -> offsets.computeIfAbsent(rs.getObject("roster_id", UUID.class), k -> new HashMap<>())
                .put(rs.getObject("employee_id", UUID.class), rs.getInt("rotation_offset")));
        heads.forEach((id, h) -> {
            RosterConfig config = config((String) h[3], id);
            List<PatternDay> pattern = config == null || config.pattern() == null ? List.of() : config.pattern();
            WeeklyOffMode mode = config == null || config.weeklyOffMode() == null ? WeeklyOffMode.ROTATIONAL : config.weeklyOffMode();
            out.add(new PlanFacts.PreviousRoster(id, (String) h[0], (LocalDate) h[1], (LocalDate) h[2], pattern, mode,
                    offsets.getOrDefault(id, Map.of())));
        });
        return out;
    }

    /** A roster's stored wizard choices; null when they can't be read (that roster then can't be continued). */
    private RosterConfig config(String text, UUID rosterId) {
        if (text == null || text.isBlank()) return null;
        try {
            return configReader.readValue(text);
        } catch (Exception e) {
            log.warn("Shift planning: roster {} has a config that can't be read ({})", rosterId, e.getMessage());
            return null;
        }
    }

    private Map<UUID, String> names(UUID tenantId, UUID companyId, String sql) {
        Map<UUID, String> out = new HashMap<>();
        jdbc.query(sql, (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class), rs.getString("name")), tenantId, companyId);
        return out;
    }

    private int minRest(UUID tenantId, UUID companyId) {
        List<Integer> rows = jdbc.query("SELECT min_rest_minutes FROM attendance.roster_settings WHERE tenant_id = ? AND company_id = ?",
                (rs, i) -> rs.getInt(1), tenantId, companyId);
        return rows.isEmpty() ? PlanFacts.DEFAULT_MIN_REST_MINUTES : rows.get(0);
    }

    private static Array uuids(java.sql.Connection con, Collection<UUID> ids) throws SQLException {
        return con.createArrayOf("uuid", ids.toArray(new UUID[0]));
    }

    private static LocalDate date(Date d) {
        return d == null ? null : d.toLocalDate();
    }
}
