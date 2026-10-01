package com.hrms.api.attendance;

import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * "Recent manual entries" on the Manual entry page (V143.53 redesign, BW-18):
 * the days HR or a manager entered by hand (attendance.records.manual_entry),
 * newest first, for the people in the caller's team scope (HR and admins: the
 * company; a manager: their team). Who entered each one and why. Read only.
 */
@Service
public class ManualEntryLog {

    static final int DEFAULT_DAYS = 30;
    static final int MAX_DAYS = 92;
    static final int DEFAULT_LIMIT = 20;
    static final int MAX_LIMIT = 100;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final TeamEmployeeScope teamScope;

    public ManualEntryLog(JdbcTemplate jdbc, TeamEmployeeScope teamScope) {
        this.jdbc = jdbc;
        this.teamScope = teamScope;
    }

    /** One manual entry: whose day, what was entered, by whom and why. */
    public record Entry(UUID recordId, UUID employeeId, String employeeName, String employeeCode, String departmentName,
                        LocalDate date, Instant checkInAt, Instant checkOutAt, String attendanceStatus,
                        String attendanceType, String reason, UUID enteredById, String enteredByName, Instant enteredAt) {}

    /** [from, to]: defaults to the last 30 days, swapped when reversed, at most 92 days, never past today. */
    static LocalDate[] range(LocalDate from, LocalDate to, LocalDate today) {
        LocalDate t = to != null ? to : today;
        if (t.isAfter(today)) t = today;
        LocalDate f = from != null ? from : t.minusDays(DEFAULT_DAYS - 1L);
        if (f.isAfter(t)) { LocalDate s = f; f = t; t = s; }
        if (f.isBefore(t.minusDays(MAX_DAYS - 1L))) f = t.minusDays(MAX_DAYS - 1L);
        return new LocalDate[]{f, t};
    }

    static int limit(Integer limit) {
        if (limit == null) return DEFAULT_LIMIT;
        return Math.max(1, Math.min(MAX_LIMIT, limit));
    }

    @Transactional(readOnly = true)
    public List<Entry> recent(Jwt jwt, LocalDate from, LocalDate to, Integer limit) {
        LocalDate[] r = range(from, to, LocalDate.now(IST));
        List<Employee> team;
        try {
            team = teamScope.resolve(jwt, null);
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
        if (team.isEmpty()) return List.of();
        List<Object> args = new ArrayList<>();
        args.add(TenantContext.requireTenantId());
        args.add(r[0]);
        args.add(r[1]);
        team.forEach(e -> args.add(e.getId()));
        args.add(limit(limit));
        return jdbc.query("""
                SELECT r.id, r.employee_id, e.first_name, e.last_name, e.employee_code, d.name AS department_name,
                       r.attendance_date, r.check_in_at, r.check_out_at, r.attendance_status, r.attendance_type,
                       COALESCE(NULLIF(btrim(r.manual_entry_reason), ''), r.regularization_reason) AS reason,
                       r.managed_by_employee_id, m.first_name AS by_first, m.last_name AS by_last, r.updated_at
                  FROM attendance.records r
                  JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN hrms.employees m ON m.id = r.managed_by_employee_id AND m.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND r.manual_entry = TRUE AND r.attendance_date BETWEEN ? AND ?
                   AND r.employee_id IN (%s)
                 ORDER BY r.updated_at DESC, r.attendance_date DESC
                 LIMIT ?
                """.formatted(String.join(",", Collections.nCopies(team.size(), "?"))), (rs, i) -> {
            Timestamp in = rs.getTimestamp("check_in_at"), out = rs.getTimestamp("check_out_at"), at = rs.getTimestamp("updated_at");
            String by = AttendanceController.joinName(rs.getString("by_first"), rs.getString("by_last"));
            return new Entry((UUID) rs.getObject("id"), (UUID) rs.getObject("employee_id"),
                    AttendanceController.joinName(rs.getString("first_name"), rs.getString("last_name")),
                    rs.getString("employee_code"), rs.getString("department_name"),
                    rs.getDate("attendance_date").toLocalDate(),
                    in != null ? in.toInstant() : null, out != null ? out.toInstant() : null,
                    rs.getString("attendance_status"), rs.getString("attendance_type"), rs.getString("reason"),
                    (UUID) rs.getObject("managed_by_employee_id"), by.isBlank() ? null : by,
                    at != null ? at.toInstant() : null);
        }, args.toArray());
    }
}
