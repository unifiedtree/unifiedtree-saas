package com.hrms.api.attendance;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.UUID;
@Service
public class TeamEmployeeScope {
 private final EmployeeRepository employeeRepository;
 private final WorkforceDepartmentRepository departmentRepository;
 public TeamEmployeeScope(EmployeeRepository employees, WorkforceDepartmentRepository departments) { employeeRepository=employees; departmentRepository=departments; }
    public List<Employee> resolve(Jwt jwt, UUID departmentId) {
        return resolve(jwt, departmentId, null);
    }

    /**
     * The same team, as it was on a past day (the admin dashboard's history
     * view): {@code formerStaff} gives, for the caller's company, the people who
     * have since left but were still employed then. They join the company-wide
     * list before the admin / department-head rules pick the team. (Direct
     * reports already include people who have left.) Null: today's team.
     */
    public List<Employee> resolve(Jwt jwt, UUID departmentId, java.util.function.Function<UUID, List<Employee>> formerStaff) {
        UUID currentEmployeeId = UUID.fromString(jwt.getClaimAsString("employee_id") != null ? jwt.getClaimAsString("employee_id") : jwt.getSubject());
        Employee current = employeeRepository.findById(currentEmployeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + currentEmployeeId));

        List<Employee> employees;
        if (AttendanceController.isAdmin(jwt)) {
            // Admin + HR: organisation-wide, every active employee.
            employees = withFormer(employeeRepository.findActiveByCompany(current.getCompanyId()), formerStaff, current.getCompanyId());
        } else {
            employees = teamOf(current, formerStaff);
        }

        // Exclude the caller from the team list — admins and managers don't
        // punch on this app, so counting them produces phantom "Not Marked /
        // Absent" tiles. (HR does punch, but they're rarely their own report.)
        employees = employees.stream()
                .filter(employee -> !employee.getId().equals(currentEmployeeId))
                .toList();

        if (departmentId != null) {
            employees = employees.stream()
                    .filter(employee -> departmentId.equals(employee.getDepartmentId()))
                    .toList();
        }
        return employees;
    }

    private static List<Employee> withFormer(List<Employee> current, java.util.function.Function<UUID, List<Employee>> formerStaff, UUID companyId) {
        if (formerStaff == null) return current;
        List<Employee> former = formerStaff.apply(companyId);
        if (former == null || former.isEmpty()) return current;
        List<Employee> all = new java.util.ArrayList<>(current);
        java.util.Set<UUID> seen = new java.util.HashSet<>();
        current.forEach(e -> seen.add(e.getId()));
        former.stream().filter(e -> companyId.equals(e.getCompanyId()) && seen.add(e.getId())).forEach(all::add);
        return all;
    }

    /**
     * The My team rule on its own, whatever permissions the manager holds:
     * the department(s) they head, else their direct reports; never the
     * manager themself. {@link #resolve} uses it for callers without the
     * company-wide permission; assisted face punch (V143.40) uses it for
     * "punch for their team".
     */
    public List<Employee> teamOf(Employee manager) {
        return teamOf(manager, null);
    }

    /** {@link #teamOf(Employee)}, with the people who have since left (see {@link #resolve(Jwt, UUID, java.util.function.Function)}). */
    List<Employee> teamOf(Employee manager, java.util.function.Function<UUID, List<Employee>> formerStaff) {
        UUID managerId = manager.getId();
        // DEPT_MANAGER: everyone in the department(s) they head — not just
        // direct reports whose reporting_manager_id points at them. A
        // department head "owns" the whole department, so their dashboard
        // shows every teammate in it. Fall back to legacy direct-report
        // scope for managers who haven't been set as any dept's head yet.
        List<UUID> ledDepartmentIds = departmentRepository
                .findByDepartmentHeadEmployeeId(managerId).stream()
                .map(d -> d.getId())
                .toList();
        List<Employee> employees;
        if (!ledDepartmentIds.isEmpty()) {
            List<Employee> companyEmployees =
                    withFormer(employeeRepository.findActiveByCompany(manager.getCompanyId()), formerStaff, manager.getCompanyId());
            employees = companyEmployees.stream()
                    .filter(e -> e.getDepartmentId() != null
                            && ledDepartmentIds.contains(e.getDepartmentId()))
                    .toList();
        } else {
            employees = employeeRepository.findByManagerId(managerId);
        }
        return employees.stream()
                .filter(employee -> !employee.getId().equals(managerId))
                .toList();
    }

}
