package com.hrms.api.team;

import com.hrms.api.attendance.ApproverScopeGuard;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Owner decision Q-22: a department head sees their whole department, every
 * other manager sees their direct reports, and someone who is both sees both.
 * One rule (TeamEmployeeScope) is behind My team, the team's day and time off,
 * and the check that lets a manager decide their team's requests, so they are
 * tested together. Only the departments a head heads count, not the ones
 * under them.
 */
class DepartmentHeadTeamTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY_A = UUID.randomUUID();
    private static final UUID COMPANY_B = UUID.randomUUID();
    private static final UUID SALES = UUID.randomUUID();
    private static final UUID SALES_EAST = UUID.randomUUID(); // a department under Sales
    private static final UUID SUPPORT = UUID.randomUUID();

    private final EmployeeRepository repo = mock(EmployeeRepository.class);
    private final WorkforceDepartmentRepository depts = mock(WorkforceDepartmentRepository.class);
    private final TeamEmployeeScope scope = new TeamEmployeeScope(repo, depts);

    private final Employee otherManager = person("Other", "Manager", COMPANY_A, SUPPORT, null);
    private final Employee head = person("Hema", "Head", COMPANY_A, SALES, null);
    private final Employee salesOfOther = person("Arun", "Sales", COMPANY_A, SALES, otherManager);
    private final Employee salesOfHead = person("Bala", "Sales", COMPANY_A, SALES, head);
    private final Employee eastOfOther = person("Chitra", "East", COMPANY_A, SALES_EAST, otherManager);
    private final Employee plainManager = person("Mani", "Manager", COMPANY_A, SUPPORT, null);
    private final Employee reportOfPlain = person("Divya", "Support", COMPANY_A, SUPPORT, plainManager);
    private final Employee supportColleague = person("Ezhil", "Support", COMPANY_A, SUPPORT, otherManager);
    private final Employee employee = person("Farah", "Employee", COMPANY_A, SUPPORT, plainManager);

    @BeforeEach void setUp() {
        TenantContext.setTenantId(TENANT);
        Department sales = new Department();
        sales.setId(SALES);
        sales.setCompanyId(COMPANY_A);
        sales.setName("Sales");
        sales.setDepartmentHeadEmployeeId(head.getId());
        when(depts.findByDepartmentHeadEmployeeId(any())).thenReturn(List.of());
        when(depts.findByDepartmentHeadEmployeeId(head.getId())).thenReturn(List.of(sales));
        when(repo.findByManagerId(any())).thenReturn(List.of());
        when(repo.findByManagerId(head.getId())).thenReturn(List.of(salesOfHead));
        when(repo.findByManagerId(plainManager.getId())).thenReturn(List.of(reportOfPlain, employee));
        when(repo.findActiveByCompany(COMPANY_A)).thenReturn(List.of(otherManager, head, salesOfOther, salesOfHead,
                eastOfOther, plainManager, reportOfPlain, supportColleague, employee));
        for (Employee e : List.of(otherManager, head, salesOfOther, salesOfHead, eastOfOther, plainManager, reportOfPlain,
                supportColleague, employee)) {
            when(repo.findById(e.getId())).thenReturn(Optional.of(e));
        }
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
        CompanyContext.clear();
    }

    private static Employee person(String first, String last, UUID company, UUID department, Employee manager) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName(last);
        e.setCompanyId(company);
        e.setDepartmentId(department);
        e.setManagerId(manager == null ? null : manager.getId());
        e.setEmploymentStatus(EmploymentStatus.ACTIVE);
        return e;
    }

    private static Jwt token(Employee caller) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", caller.getId().toString())
                .claim("permissions", List.of("attendance.team.read", "hrms.leave.approve.l1")).build();
    }

    private static Set<UUID> ids(List<Employee> team) {
        return team.stream().map(Employee::getId).collect(Collectors.toSet());
    }

    /** A direct report of the head who works in another department. */
    private Employee outsideReport(UUID company) {
        Employee outside = person("Gopi", "Support", company, SUPPORT, head);
        when(repo.findById(outside.getId())).thenReturn(Optional.of(outside));
        when(repo.findByManagerId(head.getId())).thenReturn(List.of(salesOfHead, outside));
        return outside;
    }

    // ── who is in the team ──────────────────────────────────────────────────

    @Test void aHeadSeesTheirWholeDepartmentButNotTheDepartmentsUnderIt() {
        List<Employee> team = scope.teamOf(head);
        assertEquals(Set.of(salesOfOther.getId(), salesOfHead.getId()), ids(team),
                "everyone in Sales, whoever they report to; not Sales East, not Support, not the head");
        assertEquals(2, team.size());
        assertEquals(ids(team), ids(scope.resolve(token(head), null)), "the endpoints' resolve() is the same team");
    }

    @Test void aManagerWhoHeadsNoDepartmentSeesOnlyTheirDirectReports() {
        assertEquals(Set.of(reportOfPlain.getId(), employee.getId()), ids(scope.teamOf(plainManager)),
                "their reports, not the rest of Support");
        assertEquals(Set.of(reportOfPlain.getId(), employee.getId()), ids(scope.resolve(token(plainManager), null)));
    }

    @Test void anEmployeeWithNoReportsWhoHeadsNothingHasNoTeam() {
        assertEquals(List.of(), scope.teamOf(employee));
        assertEquals(List.of(), scope.resolve(token(employee), null));
    }

    @Test void aHeadWhoAlsoHasDirectReportsElsewhereSeesBothEachPersonOnce() {
        Employee outside = outsideReport(COMPANY_A);
        List<Employee> team = scope.teamOf(head);
        assertEquals(Set.of(salesOfOther.getId(), salesOfHead.getId(), outside.getId()), ids(team));
        assertEquals(3, team.size(), "the direct report in Sales is listed once");
        assertFalse(ids(team).contains(supportColleague.getId()), "the rest of Support stays out");
        assertFalse(ids(team).contains(head.getId()));
    }

    @Test void aHeadsDirectReportInTheDepartmentWhoHasLeftStaysOutAsBefore() {
        Employee left = person("Hari", "Sales", COMPANY_A, SALES, head);
        left.setEmploymentStatus(EmploymentStatus.EXITED);
        when(repo.findByManagerId(head.getId())).thenReturn(List.of(salesOfHead, left));
        assertFalse(ids(scope.teamOf(head)).contains(left.getId()), "the department is its working people, as before");
    }

    @Test void theSelectedCompanyKeepsBothPartsToThatCompany() {
        Employee outsideInB = outsideReport(COMPANY_B);
        Employee bColleague = person("Indu", "Support", COMPANY_B, SUPPORT, otherManager);
        when(repo.findActiveByCompany(COMPANY_B)).thenReturn(List.of(outsideInB, bColleague));

        assertEquals(Set.of(salesOfOther.getId(), salesOfHead.getId(), outsideInB.getId()), ids(scope.teamOf(head)),
                "no company chosen: their own company's department and every direct report, as before");
        CompanyContext.setCompanyId(COMPANY_B);
        assertEquals(Set.of(outsideInB.getId()), ids(scope.teamOf(head)),
                "company B: their direct report there; Sales has nobody in B");
        CompanyContext.setCompanyId(COMPANY_A);
        assertEquals(Set.of(salesOfOther.getId(), salesOfHead.getId()), ids(scope.teamOf(head)),
                "company A: the department there, and no direct report from B");
    }

    @Test void aPastDaysTeamAddsTheDepartmentsFormerStaffAndKeepsTheDirectReports() {
        Employee outside = outsideReport(COMPANY_A);
        Employee formerInSales = person("Jaya", "Sales", COMPANY_A, SALES, otherManager);
        formerInSales.setEmploymentStatus(EmploymentStatus.RESIGNED);
        Set<UUID> team = ids(scope.resolve(token(head), null, company -> List.of(formerInSales)));
        assertEquals(Set.of(salesOfOther.getId(), salesOfHead.getId(), formerInSales.getId(), outside.getId()), team);
    }

    // ── the decide check follows the team ───────────────────────────────────

    @Test void theDecideCheckFollowsTheTeam() {
        ApproverScopeGuard guard = new ApproverScopeGuard(scope);
        Employee outside = outsideReport(COMPANY_A);

        assertDoesNotThrow(() -> guard.assertCanDecideFor(outside.getId(), token(head), null),
                "the head's own report in Support: in their team now");
        assertDoesNotThrow(() -> guard.assertCanDecideFor(salesOfOther.getId(), token(head), null));
        assertThrows(AccessDeniedException.class, () -> guard.assertCanDecideFor(supportColleague.getId(), token(head), null));
        assertThrows(AccessDeniedException.class, () -> guard.assertCanDecideFor(eastOfOther.getId(), token(head), null),
                "a department under Sales is not Sales");

        assertDoesNotThrow(() -> guard.assertCanDecideFor(reportOfPlain.getId(), token(plainManager), null));
        assertThrows(AccessDeniedException.class, () -> guard.assertCanDecideFor(supportColleague.getId(), token(plainManager), null),
                "a manager who heads nothing: their reports only");
    }

    // ── what My team shows ──────────────────────────────────────────────────

    private TeamReadService readService() {
        return new TeamReadService(scope, repo, depts, mock(JdbcTemplate.class), mock(PermissionChecker.class));
    }

    private static List<String> names(TeamReadService.TeamSummary s) {
        List<String> out = new ArrayList<>();
        s.members().forEach(m -> out.add(m.name()));
        return out;
    }

    @Test void myTeamForAHeadAManagerAndAnEmployee() {
        Employee outside = outsideReport(COMPANY_A);
        TeamReadService read = readService();

        TeamReadService.TeamSummary headTeam = read.summary(token(head));
        assertEquals("DEPARTMENT", headTeam.scope());
        assertEquals(List.of("Sales"), headTeam.departmentNames());
        assertEquals(List.of("Arun Sales", "Bala Sales", "Gopi Support"), names(headTeam));
        assertEquals(outside.getId(), headTeam.members().get(2).employeeId());

        TeamReadService.TeamSummary managerTeam = read.summary(token(plainManager));
        assertEquals("DIRECT_REPORTS", managerTeam.scope());
        assertEquals(List.of("Divya Support", "Farah Employee"), names(managerTeam));

        TeamReadService.TeamSummary none = read.summary(token(employee));
        assertEquals("DIRECT_REPORTS", none.scope());
        assertEquals(List.of(), none.members());
    }
}
