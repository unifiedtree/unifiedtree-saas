package com.hrms.attendance.policy;

import com.hrms.attendance.policy.AttendancePolicyEvaluator.DayFacts;
import com.hrms.attendance.policy.AttendancePolicyEvaluator.EmployeeContext;
import com.hrms.attendance.policy.AttendancePolicyEvaluator.ManualStatus;
import com.hrms.attendance.policy.AttendancePolicyEvaluator.ShiftSlot;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The one place an employee-day's attendance status is decided.
 *
 * <h2>For integrators (payroll, reports, mobile)</h2>
 * <pre>
 *   EffectiveDay day = effectiveDayStatusService.effectiveStatus(employeeId, date);
 *   Map&lt;UUID, Map&lt;LocalDate, EffectiveDay&gt;&gt; month =
 *       effectiveDayStatusService.effectiveStatuses(employeeIds, periodStart, periodEnd);
 * </pre>
 * Both must run on a request thread or inside a transaction with the tenant set
 * (RLS). {@link EffectiveDay#status()} is the status after the company's timing
 * policy (grace, half-day rules, minimum hours, late allowance) and any manual
 * change by a reviewer; {@link EffectiveDay#payableFraction()} says how much of
 * the day counts as worked (1, 0.5, 0, or null where leave/holiday rules decide).
 *
 * <p>Absent = no punch, no approved leave, not a weekly off or holiday, and the
 * day is over (an India business date before today). Today without a punch is
 * NOT_MARKED. Days before the person joined, before the company's first
 * attendance record, or after their last working day are NOT_TRACKED.
 */
@Service
public class EffectiveDayStatusService {

    private final JdbcTemplate jdbc;
    private final AttendancePolicyService policies;

    public EffectiveDayStatusService(JdbcTemplate jdbc, AttendancePolicyService policies) {
        this.jdbc = jdbc;
        this.policies = policies;
    }

    /** Today in India. */
    public static LocalDate today() {
        return LocalDate.now(AttendancePolicyEvaluator.IST);
    }

    /** One employee-day's effective status (null only when the employee isn't in this tenant). */
    @Transactional(readOnly = true)
    public EffectiveDay effectiveStatus(UUID employeeId, LocalDate date) {
        Map<LocalDate, EffectiveDay> days = effectiveStatuses(List.of(employeeId), date, date).get(employeeId);
        return days == null ? null : days.get(date);
    }

    /**
     * Effective statuses for every employee and every day in [from, to]. The
     * data is read from the start of the allowance period before {@code from}
     * so the late count is right; only [from, to] is returned.
     */
    @Transactional(readOnly = true)
    public Map<UUID, Map<LocalDate, EffectiveDay>> effectiveStatuses(Collection<UUID> employeeIdsIn, LocalDate from, LocalDate to) {
        Map<UUID, Map<LocalDate, EffectiveDay>> result = new HashMap<>();
        List<UUID> ids = employeeIdsIn == null ? List.of() : employeeIdsIn.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty() || from == null || to == null) return result;
        if (from.isAfter(to)) { LocalDate s = from; from = to; to = s; }
        LocalDate today = today();

        // Employees
        record Emp(UUID id, UUID companyId, LocalDate joined, LocalDate lastDay, Set<Integer> offs) {}
        Map<UUID, Emp> emps = new HashMap<>();
        String in = in(ids.size());
        jdbc.query("SELECT id, company_id, date_of_joining, last_working_day, weekly_off_days FROM hrms.employees WHERE id IN (" + in + ")",
                (RowCallbackHandler) rs -> {
                    UUID id = (UUID) rs.getObject("id");
                    Date j = rs.getDate("date_of_joining"), l = rs.getDate("last_working_day");
                    emps.put(id, new Emp(id, (UUID) rs.getObject("company_id"), j != null ? j.toLocalDate() : null,
                            l != null ? l.toLocalDate() : null, parseOffs(rs.getString("weekly_off_days"))));
                }, ids.toArray());
        if (emps.isEmpty()) return result;
        List<UUID> empIds = new ArrayList<>(emps.keySet());
        String ein = in(empIds.size());
        Set<UUID> companyIds = new HashSet<>();
        emps.values().forEach(e -> { if (e.companyId() != null) companyIds.add(e.companyId()); });
        Map<UUID, AttendanceTimingPolicy> policyByCompany = policies.forCompanies(companyIds);

        // Load from the start of the earliest allowance period (a week or a month back).
        LocalDate loadFrom = from.withDayOfMonth(1);
        if (from.minusDays(6).isBefore(loadFrom)) loadFrom = from.minusDays(6);
        final LocalDate lf = loadFrom, lt = to;

        // When the company started using attendance (its first record).
        Map<UUID, LocalDate> companyStart = new HashMap<>();
        if (!companyIds.isEmpty()) {
            List<UUID> cids = new ArrayList<>(companyIds);
            jdbc.query("SELECT company_id, MIN(attendance_date) AS first_day FROM attendance.records WHERE company_id IN ("
                            + in(cids.size()) + ") GROUP BY company_id",
                    (RowCallbackHandler) rs -> {
                        Date d = rs.getDate("first_day");
                        if (d != null) companyStart.put((UUID) rs.getObject("company_id"), d.toLocalDate());
                    }, cids.toArray());
        }

        // Punches
        record Rec(Instant in, Instant out, String type, Boolean outside, Integer distance) {}
        Map<UUID, Map<LocalDate, Rec>> recs = new HashMap<>();
        jdbc.query("SELECT employee_id, attendance_date, check_in_at, check_out_at, attendance_type, check_in_outside_geofence, check_in_distance_m "
                        + "FROM attendance.records WHERE employee_id IN (" + ein + ") AND attendance_date BETWEEN ? AND ?",
                (RowCallbackHandler) rs -> {
                    Timestamp i = rs.getTimestamp("check_in_at"), o = rs.getTimestamp("check_out_at");
                    Object outside = rs.getObject("check_in_outside_geofence");
                    int dist = rs.getInt("check_in_distance_m");
                    Integer distance = rs.wasNull() ? null : dist;
                    Rec r = new Rec(i != null ? i.toInstant() : null, o != null ? o.toInstant() : null, rs.getString("attendance_type"),
                            outside instanceof Boolean b ? b : null, distance);
                    Map<LocalDate, Rec> byDate = recs.computeIfAbsent((UUID) rs.getObject("employee_id"), k -> new HashMap<>());
                    LocalDate d = rs.getDate("attendance_date").toLocalDate();
                    // Keep the row with a check-in if a day ever has two.
                    Rec prev = byDate.get(d);
                    if (prev == null || prev.in() == null) byDate.put(d, r);
                }, args(empIds, Date.valueOf(lf), Date.valueOf(lt)));

        // Approved leave
        Map<UUID, Set<LocalDate>> leave = new HashMap<>();
        jdbc.query("SELECT employee_id, start_date, end_date FROM leave_mgmt.leave_requests WHERE employee_id IN (" + ein + ") "
                        + "AND status::text = 'APPROVED' AND start_date <= ? AND end_date >= ?",
                (RowCallbackHandler) rs -> {
                    LocalDate s = rs.getDate("start_date").toLocalDate(), e = rs.getDate("end_date").toLocalDate();
                    Set<LocalDate> set = leave.computeIfAbsent((UUID) rs.getObject("employee_id"), k -> new HashSet<>());
                    for (LocalDate d = s.isBefore(lf) ? lf : s; !d.isAfter(e) && !d.isAfter(lt); d = d.plusDays(1)) set.add(d);
                }, args(empIds, Date.valueOf(lt), Date.valueOf(lf)));

        // Holidays per company
        Map<UUID, Set<LocalDate>> holidays = new HashMap<>();
        if (!companyIds.isEmpty()) {
            List<UUID> cids = new ArrayList<>(companyIds);
            jdbc.query("SELECT company_id, holiday_date FROM settings.holiday_calendar WHERE company_id IN (" + in(cids.size())
                            + ") AND is_active = TRUE AND holiday_date BETWEEN ? AND ?",
                    (RowCallbackHandler) rs -> holidays.computeIfAbsent((UUID) rs.getObject("company_id"), k -> new HashSet<>())
                            .add(rs.getDate("holiday_date").toLocalDate()),
                    args(cids, Date.valueOf(lf), Date.valueOf(lt)));
        }

        // Shift assignments overlapping the window
        Map<UUID, List<Assign>> assigns = new HashMap<>();
        jdbc.query("""
                SELECT esa.employee_id, esa.effective_from, esa.effective_to, sp.name, sp.start_time, sp.end_time, sp.grace_period_minutes
                  FROM attendance.employee_shift_assignments esa
                  JOIN attendance.shift_policies sp ON sp.id = esa.shift_policy_id
                 WHERE esa.employee_id IN (%s) AND sp.is_active = TRUE
                   AND esa.effective_from <= ? AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                """.formatted(ein),
                (RowCallbackHandler) rs -> {
                    Time s = rs.getTime("start_time"), e = rs.getTime("end_time");
                    if (s == null || e == null) return;
                    Date t = rs.getDate("effective_to");
                    assigns.computeIfAbsent((UUID) rs.getObject("employee_id"), k -> new ArrayList<>()).add(new Assign(
                            rs.getDate("effective_from").toLocalDate(), t != null ? t.toLocalDate() : null,
                            new ShiftSlot(rs.getString("name"), s.toLocalTime(), e.toLocalTime(), rs.getInt("grace_period_minutes"))));
                }, args(empIds, Date.valueOf(lt), Date.valueOf(lf)));

        // Manual statuses: the newest SET / EXCUSE / CLEAR per day.
        Map<UUID, Map<LocalDate, ManualStatus>> manual = new HashMap<>();
        jdbc.query("""
                SELECT DISTINCT ON (employee_id, attendance_date) employee_id, attendance_date, action, to_status, reason, reviewer_name, created_at
                  FROM attendance.day_status_reviews
                 WHERE employee_id IN (%s) AND attendance_date BETWEEN ? AND ? AND action IN ('SET', 'EXCUSE', 'CLEAR')
                 ORDER BY employee_id, attendance_date, created_at DESC
                """.formatted(ein),
                (RowCallbackHandler) rs -> {
                    if ("CLEAR".equals(rs.getString("action"))) return;
                    Timestamp at = rs.getTimestamp("created_at");
                    manual.computeIfAbsent((UUID) rs.getObject("employee_id"), k -> new HashMap<>()).put(
                            rs.getDate("attendance_date").toLocalDate(),
                            new ManualStatus(rs.getString("to_status"), rs.getString("action"), rs.getString("reason"),
                                    rs.getString("reviewer_name"), at != null ? at.toInstant() : null));
                }, args(empIds, Date.valueOf(lf), Date.valueOf(lt)));

        // Face punches HR rejected ("Not them"): the newest decision per event.
        Map<UUID, Set<LocalDate>> rejected = new HashMap<>();
        jdbc.query("""
                SELECT employee_id, attendance_date, decision FROM (
                    SELECT DISTINCT ON (event_id) event_id, employee_id, attendance_date, decision
                      FROM attendance.face_event_reviews
                     WHERE employee_id IN (%s) AND attendance_date BETWEEN ? AND ?
                     ORDER BY event_id, created_at DESC) latest
                 WHERE decision = 'REJECTED'
                """.formatted(ein),
                (RowCallbackHandler) rs -> rejected.computeIfAbsent((UUID) rs.getObject("employee_id"), k -> new HashSet<>())
                        .add(rs.getDate("attendance_date").toLocalDate()),
                args(empIds, Date.valueOf(lf), Date.valueOf(lt)));

        for (Emp e : emps.values()) {
            AttendanceTimingPolicy policy = policyByCompany.getOrDefault(e.companyId(), AttendanceTimingPolicy.defaults(e.companyId()));
            LocalDate cStart = companyStart.get(e.companyId());
            // No attendance record in the company yet: nothing before today is judged.
            LocalDate trackingStart = cStart == null ? today : cStart;
            if (e.joined() != null && e.joined().isAfter(trackingStart)) trackingStart = e.joined();
            EmployeeContext ctx = new EmployeeContext(e.id(), trackingStart, e.lastDay(), e.offs());
            Map<LocalDate, Rec> r = recs.getOrDefault(e.id(), Map.of());
            Set<LocalDate> lv = leave.getOrDefault(e.id(), Set.of());
            Set<LocalDate> hol = holidays.getOrDefault(e.companyId(), Set.of());
            List<Assign> as = assigns.getOrDefault(e.id(), List.of());
            Map<LocalDate, ManualStatus> man = manual.getOrDefault(e.id(), Map.of());
            Set<LocalDate> rej = rejected.getOrDefault(e.id(), Set.of());
            List<DayFacts> days = new ArrayList<>();
            for (LocalDate d = lf; !d.isAfter(lt); d = d.plusDays(1)) {
                Rec rec = r.get(d);
                days.add(new DayFacts(d, rec != null ? rec.in() : null, rec != null ? rec.out() : null, rec != null ? rec.type() : null,
                        lv.contains(d), hol.contains(d), shiftOn(as, d), rej.contains(d),
                        rec != null && Boolean.TRUE.equals(rec.outside()), rec != null ? rec.distance() : null, man.get(d)));
            }
            Map<LocalDate, EffectiveDay> all = AttendancePolicyEvaluator.evaluate(ctx, days, policy, today);
            Map<LocalDate, EffectiveDay> window = new java.util.LinkedHashMap<>();
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) window.put(d, all.get(d));
            result.put(e.id(), window);
        }
        return result;
    }

    /** One shift assignment: in force from {@code from} to {@code to} (open-ended when null). */
    record Assign(LocalDate from, LocalDate to, ShiftSlot slot) {}

    /** The assignment in force on {@code d}: the latest start on or before it. */
    static ShiftSlot shiftOn(List<Assign> assigns, LocalDate d) {
        ShiftSlot best = null;
        LocalDate bestFrom = null;
        for (Assign a : assigns) {
            if (a.from().isAfter(d) || (a.to() != null && a.to().isBefore(d))) continue;
            if (bestFrom == null || a.from().isAfter(bestFrom)) { best = a.slot(); bestFrom = a.from(); }
        }
        return best;
    }

    static Set<Integer> parseOffs(String csv) {
        Set<Integer> set = new HashSet<>();
        if (csv != null) {
            for (String tok : csv.split(",")) {
                try {
                    int d = Integer.parseInt(tok.trim());
                    if (d >= 1 && d <= 7) set.add(d);
                } catch (NumberFormatException ignored) { /* skip junk */ }
            }
        }
        if (set.isEmpty()) { set.add(6); set.add(7); }
        return set;
    }

    private static String in(int n) {
        return String.join(",", Collections.nCopies(n, "?"));
    }

    private static Object[] args(List<UUID> ids, Object... tail) {
        Object[] a = new Object[ids.size() + tail.length];
        for (int i = 0; i < ids.size(); i++) a[i] = ids.get(i);
        System.arraycopy(tail, 0, a, ids.size(), tail.length);
        return a;
    }
}
