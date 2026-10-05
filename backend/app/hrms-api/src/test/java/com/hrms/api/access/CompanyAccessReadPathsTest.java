package com.hrms.api.access;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.workforce.WorkforceController;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.service.CompanyService;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.CompanyContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * The read paths that follow company access: the company list (only the
 * companies a company-scoped person may access) and the team scope every team
 * view uses (the selected company's people; unchanged without a selection).
 * Two companies each have an EMP-0001: they stay apart because everything is
 * keyed by company id, never by code.
 */
class CompanyAccessReadPathsTest {

    private final UUID companyA = UUID.randomUUID();
    private final UUID companyB = UUID.randomUUID();

    @AfterEach
    void clear() {
        CompanyContext.clear();
    }

    private CompanyResponse company(UUID id, String name) {
        return new CompanyResponse(id, name, null, null, null, null, null, "India", "Asia/Kolkata",
                "INR", "APRIL", null, 0, true, null, null, null);
    }

    private static Employee person(String code, UUID company) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(code);
        e.setEmployeeCode(code);
        e.setCompanyId(company);
        e.setEmploymentStatus(EmploymentStatus.ACTIVE);
        return e;
    }

    private static Jwt token(Employee caller, List<String> permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", caller.getId().toString()).claim("permissions", permissions).build();
    }

    // ── GET /v1/hrms/companies ──────────────────────────────────────────────

    @Test
    void companyScopedPeopleListOnlyTheirCompaniesEveryoneElseAll() {
        CompanyService companies = mock(CompanyService.class);
        when(companies.list(false)).thenReturn(List.of(company(companyA, "Alpha"), company(companyB, "Beta")));
        WorkforceController controller = new WorkforceController(companies, null, null, null, null, null, null, null, null, null, null);
        assertEquals(2, controller.listCompanies(false).size(), "no company access bean: as before");

        CompanyAccessService access = mock(CompanyAccessService.class);
        ReflectionTestUtils.setField(controller, "companyAccess", access);
        when(access.accessibleCompanyIds()).thenReturn(null);
        assertEquals(2, controller.listCompanies(false).size(), "all-companies person");
        when(access.accessibleCompanyIds()).thenReturn(Set.of(companyB));
        assertEquals(List.of(companyB), controller.listCompanies(false).stream().map(CompanyResponse::id).toList());
    }

    // ── the team scope ──────────────────────────────────────────────────────

    @Test
    void anAdminsCompanyWideTeamIsTheSelectedCompanysPeople() {
        EmployeeRepository repo = mock(EmployeeRepository.class);
        TeamEmployeeScope scope = new TeamEmployeeScope(repo, mock(WorkforceDepartmentRepository.class));
        Employee admin = person("EMP-0001", companyA);
        Employee inA = person("EMP-0002", companyA);
        Employee sameCodeInB = person("EMP-0001", companyB);
        when(repo.findById(admin.getId())).thenReturn(Optional.of(admin));
        when(repo.findActiveByCompany(companyA)).thenReturn(List.of(admin, inA));
        when(repo.findActiveByCompany(companyB)).thenReturn(List.of(sameCodeInB));
        Jwt jwt = token(admin, List.of("attendance.workforce.admin"));

        assertEquals(List.of(inA), scope.resolve(jwt, null), "no selection: their own company, as before");
        CompanyContext.setCompanyId(companyB);
        List<Employee> inB = scope.resolve(jwt, null);
        assertEquals(List.of(sameCodeInB), inB, "Company B's EMP-0001, not the admin (A's EMP-0001)");
        assertEquals(companyB, inB.get(0).getCompanyId());
    }

    @Test
    void aManagersTeamInTheSelectedCompanyIsTheirPeopleThere() {
        EmployeeRepository repo = mock(EmployeeRepository.class);
        WorkforceDepartmentRepository depts = mock(WorkforceDepartmentRepository.class);
        TeamEmployeeScope scope = new TeamEmployeeScope(repo, depts);
        Employee manager = person("EMP-0003", companyA);
        Employee reportA = person("EMP-0004", companyA);
        Employee reportB = person("EMP-0001", companyB);
        when(depts.findByDepartmentHeadEmployeeId(manager.getId())).thenReturn(List.of());
        when(repo.findByManagerId(manager.getId())).thenReturn(List.of(reportA, reportB));

        assertEquals(List.of(reportA, reportB), scope.teamOf(manager), "no selection: every direct report, as before");
        CompanyContext.setCompanyId(companyB);
        assertEquals(List.of(reportB), scope.teamOf(manager));
        CompanyContext.setCompanyId(companyA);
        assertEquals(List.of(reportA), scope.teamOf(manager));
    }

    @Test
    void aDepartmentHeadInAGrantedCompanySeesThatDepartmentThere() {
        EmployeeRepository repo = mock(EmployeeRepository.class);
        WorkforceDepartmentRepository depts = mock(WorkforceDepartmentRepository.class);
        TeamEmployeeScope scope = new TeamEmployeeScope(repo, depts);
        Employee head = person("EMP-0003", companyA);
        UUID bSales = UUID.randomUUID();
        Department dept = new Department();
        dept.setId(bSales);
        Employee inBSales = person("EMP-0001", companyB);
        inBSales.setDepartmentId(bSales);
        Employee elsewhereInB = person("EMP-0002", companyB);
        elsewhereInB.setDepartmentId(UUID.randomUUID());
        when(depts.findByDepartmentHeadEmployeeId(head.getId())).thenReturn(List.of(dept));
        when(repo.findActiveByCompany(companyA)).thenReturn(List.of(head));
        when(repo.findActiveByCompany(companyB)).thenReturn(List.of(inBSales, elsewhereInB));

        assertEquals(List.of(), scope.teamOf(head), "no selection: their own company only, as before");
        CompanyContext.setCompanyId(companyB);
        assertEquals(List.of(inBSales), scope.teamOf(head));
    }
}
