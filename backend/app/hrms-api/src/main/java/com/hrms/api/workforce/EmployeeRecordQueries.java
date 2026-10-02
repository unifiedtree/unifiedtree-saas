package com.hrms.api.workforce;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Two read models over hrms.employees for the redesign, both JDBC and
 * tenant-filtered (RLS as well):
 * <ul>
 *   <li>{@link #myRecord}: the signed-in person's own work record (BW-98),
 *       with names instead of ids and nothing about pay, bank or identity;</li>
 *   <li>{@link #exits}: people on notice or gone, with why and when (BW-91).</li>
 * </ul>
 */
@Service
public class EmployeeRecordQueries {

    private final JdbcTemplate jdbc;

    public EmployeeRecordQueries(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The web contract (contracts.ts MyEmployeeRecord): only these fields, never pay, bank or identity. */
    public record MyEmployeeRecord(UUID employeeId, String employeeCode, String firstName, String lastName,
                                   UUID companyId, String employmentStatus, LocalDate dateOfJoining,
                                   String designationName, String departmentName, String managerName,
                                   LocalDate probationEndDate, LocalDate confirmationDate,
                                   LocalDate noticeStartDate, LocalDate lastWorkingDay) {}

    /** One row of the exit lists. The reason is shown only to people who manage employees (the endpoint's guard). */
    public record ExitRow(UUID employeeId, UUID companyId, String employeeCode, String firstName, String lastName,
                          UUID departmentId, String departmentName, String designationName,
                          String employmentStatus, LocalDate noticeStartDate, LocalDate lastWorkingDay,
                          String exitType, String exitReason) {}

    static final Set<String> EXIT_LIST_STATUSES = Set.of("NOTICE_PERIOD", "EXITED", "TERMINATED");

    /** @throws ResourceNotFoundException (404) for a login without an employee record, or one this tenant can't see */
    @Transactional(readOnly = true)
    public MyEmployeeRecord myRecord(UUID employeeId) {
        if (employeeId == null) throw new ResourceNotFoundException("No employee record is linked to this login");
        List<MyEmployeeRecord> rows = jdbc.query("""
                SELECT e.id, e.employee_code, e.first_name, e.last_name, e.company_id, e.employment_status,
                       e.date_of_joining, COALESCE(g.title, e.job_title) AS designation_name, d.name AS department_name,
                       NULLIF(concat_ws(' ', NULLIF(trim(m.first_name), ''), NULLIF(trim(m.last_name), '')), '') AS manager_name,
                       e.probation_end_date, e.confirmation_date, e.notice_start_date, e.last_working_day
                  FROM hrms.employees e
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id AND g.tenant_id = e.tenant_id
                  LEFT JOIN hrms.departments  d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN hrms.employees    m ON m.id = e.reporting_manager_id AND m.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.id = ?
                """, (rs, i) -> new MyEmployeeRecord(
                        rs.getObject("id", UUID.class), rs.getString("employee_code"),
                        rs.getString("first_name"), rs.getString("last_name"),
                        rs.getObject("company_id", UUID.class), rs.getString("employment_status"),
                        day(rs.getDate("date_of_joining")), rs.getString("designation_name"),
                        rs.getString("department_name"), rs.getString("manager_name"),
                        day(rs.getDate("probation_end_date")), day(rs.getDate("confirmation_date")),
                        day(rs.getDate("notice_start_date")), day(rs.getDate("last_working_day"))),
                TenantContext.getTenantId(), employeeId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("No employee record is linked to this login");
        return rows.get(0);
    }

    /** The status filter of the exit lists: blank = all three; anything else outside them is a 422. */
    static List<String> exitStatuses(String raw) {
        if (raw == null || raw.isBlank()) return List.of("NOTICE_PERIOD", "EXITED", "TERMINATED");
        String s = raw.trim().toUpperCase(Locale.ROOT);
        if (!EXIT_LIST_STATUSES.contains(s)) {
            throw new BusinessRuleException("status must be NOTICE_PERIOD, EXITED or TERMINATED", "EXIT_STATUS_INVALID");
        }
        return List.of(s);
    }

    /** People on notice or gone, latest last working day first, then by code. Paged like the directory (at most 200 a page). */
    @Transactional(readOnly = true)
    public PageResponse<ExitRow> exits(UUID companyId, String status, int page, int pageSize) {
        List<String> statuses = exitStatuses(status);
        int size = pageSize <= 0 ? 50 : Math.min(pageSize, 200);
        int p = Math.max(0, page);
        UUID tenant = TenantContext.getTenantId();
        String cid = companyId == null ? null : companyId.toString();
        String in = String.join(",", java.util.Collections.nCopies(statuses.size(), "?"));
        String where = """
                  FROM hrms.employees e
                  LEFT JOIN hrms.departments  d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN hrms.designations g ON g.id = e.designation_id AND g.tenant_id = e.tenant_id
                 WHERE e.tenant_id = ? AND e.is_active = TRUE
                   AND (CAST(? AS uuid) IS NULL OR e.company_id = CAST(? AS uuid))
                   AND e.employment_status IN (""" + in + ")\n";
        List<Object> args = new java.util.ArrayList<>();
        args.add(tenant);
        args.add(cid);   // null = every company
        args.add(cid);
        args.addAll(statuses);
        Long total = jdbc.queryForObject("SELECT count(*) " + where, Long.class, args.toArray());
        List<Object> pageArgs = new java.util.ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) p * size);
        List<ExitRow> rows = jdbc.query("""
                SELECT e.id, e.company_id, e.employee_code, e.first_name, e.last_name, e.department_id,
                       d.name AS department_name, COALESCE(g.title, e.job_title) AS designation_name,
                       e.employment_status, e.notice_start_date, e.last_working_day, e.exit_type, e.exit_reason
                """ + where + """
                 ORDER BY e.last_working_day DESC NULLS LAST, e.employee_code, e.id
                 LIMIT ? OFFSET ?
                """, (rs, i) -> new ExitRow(
                        rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                        rs.getString("employee_code"), rs.getString("first_name"), rs.getString("last_name"),
                        rs.getObject("department_id", UUID.class), rs.getString("department_name"),
                        rs.getString("designation_name"), rs.getString("employment_status"),
                        day(rs.getDate("notice_start_date")), day(rs.getDate("last_working_day")),
                        rs.getString("exit_type"), rs.getString("exit_reason")),
                pageArgs.toArray());
        long totalElements = total == null ? 0 : total;
        int totalPages = (int) ((totalElements + size - 1) / size);
        return new PageResponse<>(rows, p, size, totalElements, totalPages, p + 1 >= totalPages);
    }

    private static LocalDate day(Date d) { return d == null ? null : d.toLocalDate(); }
}
