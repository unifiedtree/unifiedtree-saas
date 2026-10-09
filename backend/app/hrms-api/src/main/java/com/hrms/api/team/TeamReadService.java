package com.hrms.api.team;

import com.hrms.api.approvals.Callers;
import com.hrms.api.approvals.DateText;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.attendance.service.AttendanceCalendar;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * My team's read models (redesign BW-07, BW-08): who is in the team and how it
 * is chosen, and the team's leave and work from home over a range. The team is
 * always {@link TeamEmployeeScope}: the whole company with
 * attendance.workforce.admin, else the departments the caller heads and
 * their direct reports (owner decision Q-22), else their direct reports;
 * never the caller.
 */
@Service
public class TeamReadService {

    /** Longest range the time-off list serves. */
    public static final int TIME_OFF_MAX_DAYS = 62;
    /** Statuses of people who have left: never team members. */
    static final Set<EmploymentStatus> LEFT = Set.of(EmploymentStatus.EXITED, EmploymentStatus.TERMINATED,
            EmploymentStatus.RESIGNED, EmploymentStatus.RETIRED);

    private final TeamEmployeeScope teamScope;
    private final EmployeeRepository employees;
    private final WorkforceDepartmentRepository departments;
    private final JdbcTemplate jdbc;
    private final PermissionChecker perm;

    public TeamReadService(TeamEmployeeScope teamScope, EmployeeRepository employees,
                           WorkforceDepartmentRepository departments, JdbcTemplate jdbc, PermissionChecker perm) {
        this.teamScope = teamScope;
        this.employees = employees;
        this.departments = departments;
        this.jdbc = jdbc;
        this.perm = perm;
    }

    public record TeamSummary(String scope, List<String> departmentNames, List<TeamMember> members) {
    }

    public record TeamMember(UUID employeeId, String name, String employeeCode, String jobTitle, String departmentName,
                             String employmentStatus, LocalDate dateOfJoining, LocalDate probationEndDate,
                             String offToday, String profilePhotoUrl) {
    }

    public record TimeOffEntry(String kind, UUID requestId, UUID employeeId, String employeeName, LocalDate fromDate,
                               LocalDate toDate, String status, String leaveTypeName, String duration, double days,
                               boolean canDecide) {
    }

    /** The team members, never the caller or people who have left. Empty for a caller with no employee record. */
    List<Employee> members(Jwt jwt) {
        try {
            return teamScope.resolve(jwt, null).stream()
                    .filter(e -> e.getEmploymentStatus() == null || !LEFT.contains(e.getEmploymentStatus()))
                    .toList();
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
    }

    /** How the team is chosen: COMPANY, DEPARTMENT (the departments they head) or DIRECT_REPORTS. */
    static String scopeKind(boolean workforceAdmin, List<Department> headed) {
        if (workforceAdmin) return "COMPANY";
        return headed.isEmpty() ? "DIRECT_REPORTS" : "DEPARTMENT";
    }

    @Transactional(readOnly = true)
    public TeamSummary summary(Jwt jwt) {
        UUID tenantId = TenantContext.requireTenantId();
        UUID me = Callers.employeeId(jwt);
        List<Department> headed = departments.findByDepartmentHeadEmployeeId(me);
        String scope = scopeKind(Callers.hasClaim(jwt, Callers.WORKFORCE_ADMIN), headed);
        List<String> departmentNames = "DEPARTMENT".equals(scope)
                ? headed.stream().map(Department::getName).filter(Objects::nonNull).sorted().toList()
                : List.of();

        List<Employee> team = members(jwt);
        if (team.isEmpty()) return new TeamSummary(scope, departmentNames, List.of());
        List<UUID> ids = team.stream().map(Employee::getId).toList();
        LocalDate today = DateText.todayIst();

        Map<UUID, String> departmentName = departmentNames(tenantId, team);
        Map<UUID, Set<Integer>> weeklyOff = AttendanceCalendar.resolveWeeklyOffDays(jdbc, ids, today);
        Set<UUID> companiesOnHoliday = new HashSet<>(jdbc.queryForList("""
                SELECT DISTINCT company_id FROM settings.holiday_calendar
                 WHERE tenant_id = ? AND holiday_date = ? AND is_active = TRUE
                """, UUID.class, tenantId, today));
        Set<UUID> onLeave = new HashSet<>(jdbc.queryForList("""
                SELECT DISTINCT employee_id FROM leave_mgmt.leave_requests
                 WHERE tenant_id = ? AND status = 'APPROVED' AND start_date <= ? AND end_date >= ?
                   AND employee_id = ANY(CAST(? AS uuid[]))
                """, UUID.class, tenantId, today, today, uuidArray(ids)));

        int dow = today.getDayOfWeek().getValue();
        List<TeamMember> members = team.stream()
                .map(e -> {
                    String off = weeklyOff.getOrDefault(e.getId(), AttendanceCalendar.DEFAULT_OFF_DAYS).contains(dow) ? "WEEKLY_OFF"
                            : companiesOnHoliday.contains(e.getCompanyId()) ? "HOLIDAY"
                            : onLeave.contains(e.getId()) ? "LEAVE" : null;
                    boolean probation = e.getEmploymentStatus() == EmploymentStatus.PROBATION;
                    return new TeamMember(e.getId(), name(e), e.getEmployeeCode(), e.getJobTitle(),
                            e.getDepartmentId() == null ? null : departmentName.get(e.getDepartmentId()),
                            e.getEmploymentStatus() == null ? null : e.getEmploymentStatus().name(),
                            e.getDateOfJoining(), probation ? e.getProbationEndDate() : null, off, e.getProfilePhotoUrl());
                })
                .sorted(Comparator.comparing(TeamMember::name, String.CASE_INSENSITIVE_ORDER))
                .toList();
        return new TeamSummary(scope, departmentNames, members);
    }

    /**
     * The team's approved and waiting leave, and approved and waiting work
     * from home, that overlap {@code from}..{@code to} (at most 62 days), each
     * with its request id and whether the caller may decide it the way its
     * decide endpoint would.
     */
    @Transactional(readOnly = true)
    public List<TimeOffEntry> timeOff(LocalDate from, LocalDate to, Jwt jwt, Authentication auth) {
        if (from == null || to == null || to.isBefore(from) || ChronoUnit.DAYS.between(from, to) + 1 > TIME_OFF_MAX_DAYS) {
            throw new HrmsException("Choose a range of up to " + TIME_OFF_MAX_DAYS + " days.", HttpStatus.BAD_REQUEST,
                    "TIME_OFF_RANGE_INVALID");
        }
        UUID tenantId = TenantContext.requireTenantId();
        UUID me = Callers.employeeId(jwt);
        List<Employee> team = members(jwt);
        if (team.isEmpty()) return List.of();
        String ids = uuidArray(team.stream().map(Employee::getId).toList());
        // The decide endpoints' checks. Team members pass ApproverScopeGuard, so only the permission is left.
        boolean leaveL1 = perm.check("hrms.leave.approve.l1");
        boolean leaveL2 = perm.check(Callers.LEAVE_L2);
        boolean wfh = Callers.hasAuthority(auth, "wfh.approve");

        List<TimeOffEntry> out = new ArrayList<>();
        jdbc.query("""
                SELECT lr.id, lr.employee_id, lr.start_date, lr.end_date, lr.status, lr.duration, lr.total_days,
                       lr.approver_id, lt.name AS type_name,
                       NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS employee_name
                  FROM leave_mgmt.leave_requests lr
                  LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id AND lt.tenant_id = lr.tenant_id
                  LEFT JOIN hrms.employees e ON e.id = lr.employee_id AND e.tenant_id = lr.tenant_id
                 WHERE lr.tenant_id = ? AND lr.status IN ('APPROVED', 'PENDING', 'PENDING_L2')
                   AND lr.start_date <= ? AND lr.end_date >= ? AND lr.employee_id = ANY(CAST(? AS uuid[]))
                """, (RowCallbackHandler) rs -> {
            String status = rs.getString("status");
            UUID approver = rs.getObject("approver_id", UUID.class);
            boolean canDecide = "PENDING".equals(status) ? leaveL1
                    : "PENDING_L2".equals(status) && leaveL2 && !me.equals(approver);
            out.add(new TimeOffEntry("LEAVE", rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                    rs.getString("employee_name"), rs.getObject("start_date", LocalDate.class),
                    rs.getObject("end_date", LocalDate.class), status, rs.getString("type_name"),
                    rs.getString("duration"), rs.getDouble("total_days"), canDecide));
        }, tenantId, to, from, ids);
        jdbc.query("""
                SELECT w.id, w.employee_id, w.from_date, w.to_date, w.status,
                       NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS employee_name
                  FROM leave_mgmt.wfh_requests w
                  LEFT JOIN hrms.employees e ON e.id = w.employee_id AND e.tenant_id = w.tenant_id
                 WHERE w.tenant_id = ? AND w.status IN ('APPROVED', 'PENDING')
                   AND w.from_date <= ? AND w.to_date >= ? AND w.employee_id = ANY(CAST(? AS uuid[]))
                """, (RowCallbackHandler) rs -> {
            LocalDate f = rs.getObject("from_date", LocalDate.class);
            LocalDate t = rs.getObject("to_date", LocalDate.class);
            String status = rs.getString("status");
            out.add(new TimeOffEntry("WFH", rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                    rs.getString("employee_name"), f, t, status, null, null,
                    t.toEpochDay() - f.toEpochDay() + 1, "PENDING".equals(status) && wfh));
        }, tenantId, to, from, ids);
        out.sort(Comparator.comparing(TimeOffEntry::fromDate)
                .thenComparing(e -> e.employeeName() == null ? "" : e.employeeName(), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(e -> e.requestId().toString()));
        return out;
    }

    private Map<UUID, String> departmentNames(UUID tenantId, List<Employee> team) {
        List<UUID> ids = team.stream().map(Employee::getDepartmentId).filter(Objects::nonNull).distinct().toList();
        Map<UUID, String> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.query("SELECT id, name FROM hrms.departments WHERE tenant_id = ? AND id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class), rs.getString("name")),
                tenantId, uuidArray(ids));
        return out;
    }

    static String name(Employee e) {
        String n = ((e.getFirstName() == null ? "" : e.getFirstName().trim()) + " "
                + (e.getLastName() == null ? "" : e.getLastName().trim())).trim();
        return n.isEmpty() ? "Employee" : n;
    }

    static String uuidArray(java.util.Collection<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }
}
