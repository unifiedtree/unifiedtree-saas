package com.hrms.api.attendance;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.security.tenant.CompanyContext;
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
        return resolve(jwt, departmentId, formerStaff, false);
    }

    /**
     * {@link #resolve(Jwt, UUID, java.util.function.Function)}, and with
     * {@code includeSelf} a company-wide caller stays in their own list: a
     * company register (the muster roll, the shift roster) lists everyone in
     * the company, the person reading it too. A manager's team never includes
     * the manager, flag or not. Every other caller (the approval guard among
     * them) uses the overloads above, which always leave the caller out.
     */
    public List<Employee> resolve(Jwt jwt, UUID departmentId, java.util.function.Function<UUID, List<Employee>> formerStaff,
                                  boolean includeSelf) {
        UUID currentEmployeeId = UUID.fromString(jwt.getClaimAsString("employee_id") != null ? jwt.getClaimAsString("employee_id") : jwt.getSubject());
        Employee current = employeeRepository.findById(currentEmployeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + currentEmployeeId));

        List<Employee> employees;
        boolean companyWide = AttendanceController.isAdmin(jwt);
        if (companyWide) {
            // Admin + HR: organisation-wide, every active employee of the current
            // company (the X-Company-Id the client selected, else their own).
            UUID companyId = currentCompany(current);
            employees = withFormer(employeeRepository.findActiveByCompany(companyId), formerStaff, companyId);
        } else {
            employees = teamOf(current, formerStaff);
        }

        // Exclude the caller from the team list — admins and managers don't
        // punch on this app, so counting them produces phantom "Not Marked /
        // Absent" tiles. (HR does punch, but they're rarely their own report.)
        // A company register asks to keep them (includeSelf, company-wide only).
        if (!(includeSelf && companyWide)) {
            employees = employees.stream()
                    .filter(employee -> !employee.getId().equals(currentEmployeeId))
                    .toList();
        }

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
     * The My team rule on its own, whatever permissions the manager holds
     * (owner decision Q-22): a department head sees everyone in the
     * department(s) they head, and also their direct reports outside those
     * departments; every other manager sees their direct reports; never the
     * manager themself. Only the departments they head, not the departments
     * under them. {@link #resolve} uses it for callers without the
     * company-wide permission; assisted face punch (V143.40) uses it for
     * "punch for their team".
     */
    public List<Employee> teamOf(Employee manager) {
        return teamOf(manager, null);
    }

    /** {@link #teamOf(Employee)}, with the people who have since left (see {@link #resolve(Jwt, UUID, java.util.function.Function)}). */
    List<Employee> teamOf(Employee manager, java.util.function.Function<UUID, List<Employee>> formerStaff) {
        UUID managerId = manager.getId();
        // With a current company chosen (X-Company-Id), the team is the part of
        // it in that company: department heads see their departments' people
        // there plus their direct reports there, others their direct reports
        // there. Without one: as before.
        UUID selected = CompanyContext.getCompanyId();
        UUID companyId = selected != null ? selected : manager.getCompanyId();
        // DEPT_MANAGER: everyone in the department(s) they head — not just
        // direct reports whose reporting_manager_id points at them. A
        // department head "owns" the whole department, so their dashboard
        // shows every teammate in it. Managers who head no department see
        // their direct reports.
        List<UUID> ledDepartmentIds = departmentRepository
                .findByDepartmentHeadEmployeeId(managerId).stream()
                .map(d -> d.getId())
                .toList();
        List<Employee> directReports = employeeRepository.findByManagerId(managerId);
        if (selected != null) {
            directReports = directReports.stream().filter(e -> selected.equals(e.getCompanyId())).toList();
        }
        List<Employee> employees;
        if (!ledDepartmentIds.isEmpty()) {
            List<Employee> companyEmployees =
                    withFormer(employeeRepository.findActiveByCompany(companyId), formerStaff, companyId);
            List<Employee> team = new java.util.ArrayList<>(companyEmployees.stream()
                    .filter(e -> e.getDepartmentId() != null
                            && ledDepartmentIds.contains(e.getDepartmentId()))
                    .toList());
            // Q-22: a head who is also someone's reporting manager outside the
            // department(s) they head sees those people too (the union). Their
            // direct reports inside the department are already in it, as the
            // department has them.
            java.util.Set<UUID> seen = new java.util.HashSet<>();
            team.forEach(e -> seen.add(e.getId()));
            directReports.stream()
                    .filter(e -> e.getDepartmentId() == null || !ledDepartmentIds.contains(e.getDepartmentId()))
                    .filter(e -> seen.add(e.getId()))
                    .forEach(team::add);
            employees = team;
        } else {
            employees = directReports;
        }
        return employees.stream()
                .filter(employee -> !employee.getId().equals(managerId))
                .toList();
    }

    /** The current company: the one the client selected (X-Company-Id, access already checked), else the caller's own. */
    private static UUID currentCompany(Employee caller) {
        UUID selected = CompanyContext.getCompanyId();
        return selected != null ? selected : caller.getCompanyId();
    }

}
