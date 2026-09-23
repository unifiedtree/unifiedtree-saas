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
        UUID currentEmployeeId = UUID.fromString(jwt.getClaimAsString("employee_id") != null ? jwt.getClaimAsString("employee_id") : jwt.getSubject());
        Employee current = employeeRepository.findById(currentEmployeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + currentEmployeeId));

        List<Employee> employees;
        if (AttendanceController.isAdmin(jwt)) {
            // Admin + HR: organisation-wide, every active employee.
            employees = employeeRepository.findActiveByCompany(current.getCompanyId());
        } else {
            // DEPT_MANAGER: everyone in the department(s) they head — not just
            // direct reports whose reporting_manager_id points at them. A
            // department head "owns" the whole department, so their dashboard
            // shows every teammate in it. Fall back to legacy direct-report
            // scope for managers who haven't been set as any dept's head yet.
            List<UUID> ledDepartmentIds = departmentRepository
                    .findByDepartmentHeadEmployeeId(currentEmployeeId).stream()
                    .map(d -> d.getId())
                    .toList();
            if (!ledDepartmentIds.isEmpty()) {
                List<Employee> companyEmployees =
                        employeeRepository.findActiveByCompany(current.getCompanyId());
                employees = companyEmployees.stream()
                        .filter(e -> e.getDepartmentId() != null
                                && ledDepartmentIds.contains(e.getDepartmentId()))
                        .toList();
            } else {
                employees = employeeRepository.findByManagerId(currentEmployeeId);
            }
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

}
