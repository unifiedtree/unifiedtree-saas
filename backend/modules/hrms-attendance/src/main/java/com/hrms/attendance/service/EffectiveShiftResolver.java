package com.hrms.attendance.service;

import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.repository.EmployeeShiftAssignmentRepository;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The one place that answers "which shift does this person have on this date" (shift-ot GAP-MAP §2.2). Every reader
 * of {@code attendance.employee_shift_assignments} that asks it comes through here, so whatever is later put in front
 * of the assignments (a published roster) is put in one place.
 *
 * <p>The rule: of the person's assignments that cover the date (effective_from on or before it, effective_to empty or
 * on or after it), the one that started last; no assignment, no shift. Which date to ask about is the caller's: a
 * punch belongs to the India date of its check-in, so a night-shift check-in after midnight is judged against the next
 * date's shift (AttendanceService, unchanged).
 *
 * <p>The copies this replaced did not apply the rule in quite the same way, and each difference is kept, by name,
 * until someone decides otherwise:
 * <ul>
 *   <li>{@link #attendanceShift}, {@link #attendanceShifts} and {@link #shiftsOn} (late marks, my day and app home, the weekly target,
 *       the overtime threshold, the shift's weekly offs, day status): an archived shift is skipped, so the assignment
 *       before it applies; the tenant is the caller's (row-level security), with no condition of its own; two
 *       assignments starting the same day are not told apart.</li>
 *   <li>{@link #dashboardShifts} (the dashboard's shift windows and shift ends): the latest start among active shifts
 *       as above, then only the rows of that start whose shift is the assignment's tenant's; none means no shift that
 *       day, not the one before.</li>
 *   <li>{@link #scheduleAssignment} and {@link #scheduleShiftJoin} (team schedule, overtime list, people per shift),
 *       as SQL for those set-based queries: the tenant's latest assignment whatever its shift (an archived one still
 *       counts); of two from the same day, the one created later; its shift is joined only when it is the tenant's.</li>
 *   <li>{@link #assignmentInForce} (the profile's current shift and a shift change's baseline, JPA): the first row of
 *       {@link EmployeeShiftAssignmentRepository#findEffectiveOn}, whatever its shift.</li>
 *   <li>{@link #peopleOnEachShift} (the approvals inbox's "On &lt;shift&gt; now"): every assignment covering the day
 *       counts, not only the latest, whatever its shift.</li>
 * </ul>
 *
 * <p>Weekly offs follow three rules today and they stay apart: attendance
 * ({@link AttendanceCalendar#resolveWeeklyOffDays}: own days, else the shift's from {@link #attendanceShifts}, else
 * the company's, else Saturday and Sunday), payroll ({@code PayrollCalc.resolveOffDays}: own, else the company's,
 * else Saturday and Sunday) and leave day counting ({@code LeaveService.resolveOffDays}: the company's only). Only the
 * attendance rule reads a shift.
 */
public final class EffectiveShiftResolver {

    private EffectiveShiftResolver() {
    }

    /**
     * A person's assignment that applies on a date and its shift's definition, as the lookups read them (times are
     * the shift's wall-clock times; grace and working hours are null only when the database has none).
     */
    public record EffectiveShift(UUID employeeId, UUID tenantId, LocalDate effectiveFrom, LocalDate effectiveTo,
                                 UUID shiftPolicyId, UUID shiftTenantId, String code, String name, String shiftType,
                                 LocalTime startTime, LocalTime endTime, Integer graceMinutes, Double workingHoursPerDay,
                                 LocalTime coreStartTime, String weeklyOffDays) {

        /** A FLEXIBLE shift with core hours is late after core start, with no grace on top (V143.23). */
        public boolean lateFromCoreStart() {
            return "FLEXIBLE".equals(shiftType) && coreStartTime != null;
        }

        /** When lateness is counted from: core start on a flexible shift with core hours, else the shift's start. */
        public LocalTime lateFrom() {
            return lateFromCoreStart() ? coreStartTime : startTime;
        }

        /** The grace on top of {@link #lateFrom}: none on a flexible shift with core hours, else the shift's. */
        public Integer lateGraceMinutes() {
            return lateFromCoreStart() ? Integer.valueOf(0) : graceMinutes;
        }

        /** Whether this assignment covers {@code date}. */
        public boolean covers(LocalDate date) {
            return date != null && effectiveFrom != null && !effectiveFrom.isAfter(date)
                    && (effectiveTo == null || !effectiveTo.isBefore(date));
        }
    }

    private static final String COLUMNS = """
            esa.employee_id, esa.tenant_id, esa.effective_from, esa.effective_to, esa.shift_policy_id,
                   sp.tenant_id AS shift_tenant_id, sp.code, sp.name, sp.shift_type, sp.start_time, sp.end_time,
                   sp.grace_period_minutes, sp.working_hours_per_day, sp.core_start_time, sp.weekly_off_days
            """;

    // ── Attendance: late marks, my day, weekly target, overtime threshold, weekly offs, day status ────────────────

    /**
     * The attendance rule for one person and date: the latest assignment covering it whose shift is active (an
     * archived shift is skipped, so the one before applies). No tenant condition: the caller's tenant (RLS). Null
     * when there is none. Database errors are the caller's to handle.
     */
    public static EffectiveShift attendanceShift(JdbcOperations jdbc, UUID employeeId, LocalDate date) {
        return jdbc.query("SELECT " + COLUMNS + """
                  FROM attendance.employee_shift_assignments esa
                  JOIN attendance.shift_policies sp
                    ON sp.id = esa.shift_policy_id
                 WHERE esa.employee_id = ?
                   AND esa.effective_from <= ?
                   AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                   AND sp.is_active = TRUE
                 ORDER BY esa.effective_from DESC
                 LIMIT 1
                """,
                rs -> rs.next() ? read(rs) : null,
                employeeId, date, date);
    }

    /**
     * The attendance rule's candidates for many people over [from, to]: every assignment covering a day of it whose
     * shift is active, per person, latest start first. Pick a day's with {@link #inForceOn}. People with none are
     * absent. Database errors are the caller's to handle.
     */
    public static Map<UUID, List<EffectiveShift>> attendanceShifts(JdbcOperations jdbc, Collection<UUID> employeeIds,
                                                                   LocalDate from, LocalDate to) {
        Map<UUID, List<EffectiveShift>> out = new HashMap<>();
        if (employeeIds == null || employeeIds.isEmpty() || from == null || to == null) return out;
        List<Object> args = new ArrayList<>(employeeIds);
        args.add(Date.valueOf(to));
        args.add(Date.valueOf(from));
        jdbc.query("SELECT " + COLUMNS
                        + "  FROM attendance.employee_shift_assignments esa"
                        + "  JOIN attendance.shift_policies sp ON sp.id = esa.shift_policy_id"
                        + " WHERE esa.employee_id IN (" + in(employeeIds.size()) + ") AND sp.is_active = TRUE"
                        + "   AND esa.effective_from <= ? AND (esa.effective_to IS NULL OR esa.effective_to >= ?)"
                        + " ORDER BY esa.employee_id, esa.effective_from DESC",
                (RowCallbackHandler) rs -> {
                    EffectiveShift s = read(rs);
                    out.computeIfAbsent(s.employeeId(), k -> new ArrayList<>()).add(s);
                },
                args.toArray());
        return out;
    }

    /** Of {@code candidates}, the one in force on {@code date}: the latest start covering it (the first such on a tie). */
    public static EffectiveShift inForceOn(List<EffectiveShift> candidates, LocalDate date) {
        EffectiveShift best = null;
        if (candidates == null) return null;
        for (EffectiveShift s : candidates) {
            if (!s.covers(date)) continue;
            if (best == null || s.effectiveFrom().isAfter(best.effectiveFrom())) best = s;
        }
        return best;
    }

    /**
     * The attendance rule for many people on one date, in one query: person → the assignment and shift in force (as
     * {@link #attendanceShift}); people with none are absent. The tenant is the caller's (row-level security, inside
     * its transaction). The bulk entry point for new readers (shift-ot DESIGN §0.2 {@code shiftsOn}). Database errors
     * are the caller's to handle.
     */
    public static Map<UUID, EffectiveShift> shiftsOn(JdbcOperations jdbc, Collection<UUID> employeeIds, LocalDate date) {
        Map<UUID, EffectiveShift> out = new HashMap<>();
        attendanceShifts(jdbc, employeeIds, date, date).forEach((id, shifts) -> {
            EffectiveShift shift = inForceOn(shifts, date);
            if (shift != null) out.put(id, shift);
        });
        return out;
    }

    /**
     * The ATTENDANCE weekly-off rule for many people on one date: their own days, else the days of the shift
     * {@link #shiftsOn} gives, else their company's, else Saturday and Sunday ({@link AttendanceCalendar#resolveWeeklyOffDays},
     * unchanged). Not the payroll or leave rule. Every person asked for is in the map.
     */
    public static Map<UUID, Set<Integer>> attendanceWeeklyOffDays(JdbcTemplate jdbc, Collection<UUID> employeeIds, LocalDate date) {
        return AttendanceCalendar.resolveWeeklyOffDays(jdbc, employeeIds, date);
    }

    // ── Dashboard: shift windows and shift ends ────────────────────────────────────────────────────────────────

    /**
     * The dashboard's rule for many people on one date: the latest start among assignments covering it whose shift is
     * active (as {@link #attendanceShift}), then the rows of that start whose shift is the assignment's tenant's. A
     * person whose latest such row has another tenant's shift gets nothing, not the row before. Rows in the
     * database's order (a person can appear twice on a tie). Database errors are the caller's to handle.
     */
    public static List<EffectiveShift> dashboardShifts(JdbcOperations jdbc, List<UUID> employeeIds, LocalDate date) {
        List<EffectiveShift> out = new ArrayList<>();
        if (employeeIds == null || employeeIds.isEmpty()) return out;
        String sql = ("SELECT " + COLUMNS + """
                  FROM attendance.employee_shift_assignments esa
                  JOIN attendance.shift_policies sp ON sp.id = esa.shift_policy_id AND sp.tenant_id = esa.tenant_id
                 WHERE esa.employee_id IN (%s)
                   AND esa.effective_from <= ?
                   AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                   AND sp.is_active = TRUE
                   AND esa.effective_from = (
                       SELECT MAX(esa2.effective_from)
                         FROM attendance.employee_shift_assignments esa2
                         JOIN attendance.shift_policies sp2 ON sp2.id = esa2.shift_policy_id
                        WHERE esa2.employee_id = esa.employee_id
                          AND esa2.effective_from <= ?
                          AND (esa2.effective_to IS NULL OR esa2.effective_to >= ?)
                          AND sp2.is_active = TRUE
                   )
                """).formatted(in(employeeIds.size()));
        Object[] args = new Object[employeeIds.size() + 4];
        for (int i = 0; i < employeeIds.size(); i++) {
            args[i] = employeeIds.get(i);
        }
        args[employeeIds.size()] = date;
        args[employeeIds.size() + 1] = date;
        args[employeeIds.size() + 2] = date;
        args[employeeIds.size() + 3] = date;
        jdbc.query(sql, (RowCallbackHandler) rs -> out.add(read(rs)), args);
        return out;
    }

    // ── Schedule: team schedule, overtime list, people per shift (SQL for set-based queries) ───────────────────

    /**
     * The schedule rule as a subquery, to be used as {@code LATERAL (...)}: the latest assignment of {@code employee}
     * in {@code tenant} covering {@code date} (its shift_policy_id and effective_from), whatever its shift; of two from
     * the same day, the one created later. Arguments are SQL expressions; the assignment's alias is {@code a}.
     */
    public static String scheduleAssignment(String tenant, String employee, String date) {
        return "SELECT a.shift_policy_id, a.effective_from FROM attendance.employee_shift_assignments a\n"
                + " WHERE a.tenant_id = " + tenant + " AND a.employee_id = " + employee + " AND a.effective_from <= " + date + "\n"
                + "   AND (a.effective_to IS NULL OR a.effective_to >= " + date + ")\n"
                + " ORDER BY a.effective_from DESC, a.created_at DESC LIMIT 1";
    }

    /**
     * The schedule rule's shift for {@link #scheduleAssignment} (aliased {@code assignment}): {@code LEFT JOIN}ed as
     * {@code s}, only when it is {@code tenant}'s (an archived shift still is).
     */
    public static String scheduleShiftJoin(String assignment, String tenant) {
        return "LEFT JOIN attendance.shift_policies s ON s.id = " + assignment + ".shift_policy_id AND s.tenant_id = " + tenant;
    }

    // ── Profile and shift change baseline (JPA) ──────────────────────────────────────────────────────────────

    /**
     * The assignment in force for the profile's current shift and a shift change's baseline: the first of
     * {@link EmployeeShiftAssignmentRepository#findEffectiveOn} (latest start first), whatever its shift.
     */
    public static Optional<EmployeeShiftAssignment> assignmentInForce(EmployeeShiftAssignmentRepository assignments,
                                                                      UUID employeeId, LocalDate date) {
        return assignments.findEffectiveOn(employeeId, date).stream().findFirst();
    }

    // ── Approvals inbox ──────────────────────────────────────────────────────────────────────────────────────

    /**
     * Shift policy id → how many of {@code employees} are on it on {@code date}, counting EVERY assignment of
     * {@code tenantId} that covers the day, not only the latest, whatever its shift: someone with two overlapping
     * rows counts on both. Shifts nobody is on are absent.
     */
    public static Map<UUID, Integer> peopleOnEachShift(JdbcOperations jdbc, UUID tenantId, Collection<UUID> employees,
                                                       LocalDate date) {
        Map<UUID, Integer> out = new HashMap<>();
        if (employees == null || employees.isEmpty()) return out;
        jdbc.query("""
                SELECT a.shift_policy_id, COUNT(DISTINCT a.employee_id) AS people
                  FROM attendance.employee_shift_assignments a
                 WHERE a.tenant_id = ? AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)
                   AND a.employee_id = ANY(CAST(? AS uuid[]))
                 GROUP BY a.shift_policy_id
                """, (RowCallbackHandler) rs -> out.put(rs.getObject("shift_policy_id", UUID.class), rs.getInt("people")),
                tenantId, date, date, employees.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}")));
        return out;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────

    private static EffectiveShift read(ResultSet rs) throws SQLException {
        Date from = rs.getDate("effective_from"), to = rs.getDate("effective_to");
        Time start = rs.getTime("start_time"), end = rs.getTime("end_time"), core = rs.getTime("core_start_time");
        int graceRaw = rs.getInt("grace_period_minutes");
        Integer grace = rs.wasNull() ? null : graceRaw;
        double hoursRaw = rs.getDouble("working_hours_per_day");
        Double hours = rs.wasNull() ? null : hoursRaw;
        return new EffectiveShift((UUID) rs.getObject("employee_id"), (UUID) rs.getObject("tenant_id"),
                from != null ? from.toLocalDate() : null, to != null ? to.toLocalDate() : null,
                (UUID) rs.getObject("shift_policy_id"), (UUID) rs.getObject("shift_tenant_id"),
                rs.getString("code"), rs.getString("name"), rs.getString("shift_type"),
                start != null ? start.toLocalTime() : null, end != null ? end.toLocalTime() : null,
                grace, hours, core != null ? core.toLocalTime() : null, rs.getString("weekly_off_days"));
    }

    private static String in(int n) {
        return String.join(",", Collections.nCopies(n, "?"));
    }
}
