package com.hrms.api.team;

import com.hrms.api.probation.ProbationService;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;

import java.lang.reflect.Method;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Probation for managers: the rights (confirm and extend need
 * hrms.probation.team.decide and a person in the caller's team, on
 * probation), today's services are reused unchanged, and HR and the employee
 * are told.
 */
class TeamProbationServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();
    private final UUID member = UUID.randomUUID();
    private TeamReadService read;
    private JdbcTemplate jdbc;
    private WorkforceEmployeeService workforce;
    private ProbationService probation;
    private PermissionHolders holders;
    private ApplicationEventPublisher events;
    private TeamProbationService service;
    private Jwt jwt;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        read = mock(TeamReadService.class);
        jdbc = mock(JdbcTemplate.class);
        workforce = mock(WorkforceEmployeeService.class);
        probation = mock(ProbationService.class);
        holders = mock(PermissionHolders.class);
        events = mock(ApplicationEventPublisher.class);
        service = new TeamProbationService(read, jdbc, workforce, probation, holders, mock(AuditService.class), events);
        jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).claim("permissions", List.of("attendance.team.read")).build();
        Employee e = new Employee();
        e.setId(member);
        e.setEmploymentStatus(EmploymentStatus.PROBATION);
        when(read.members(jwt)).thenReturn(List.of(e));
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private void personIs(String status, LocalDate end) {
        java.util.Map<String, Object> row = new java.util.HashMap<>();
        row.put("name", "Ravi Kumar");
        row.put("employment_status", status);
        row.put("probation_end_date", end == null ? null : java.sql.Date.valueOf(end));
        when(jdbc.queryForList(contains("FOR UPDATE"), eq(member), eq(tenant))).thenReturn(List.of(row));
    }

    @Test void confirmAndExtendNeedTheTeamDecidePermission() throws Exception {
        for (String name : List.of("confirm", "extend")) {
            Method m = java.util.Arrays.stream(TeamController.class.getMethods()).filter(x -> x.getName().equals(name))
                    .findFirst().orElseThrow();
            assertEquals("@perm.check('hrms.probation.team.decide')", m.getAnnotation(PreAuthorize.class).value(), name);
        }
        Method list = TeamController.class.getMethod("probation", int.class, Jwt.class);
        assertEquals("hasAuthority('attendance.team.read')", list.getAnnotation(PreAuthorize.class).value());
    }

    @Test void someoneOutsideTheTeamCannotBeConfirmedOrExtended() {
        UUID outsider = UUID.randomUUID();
        HrmsException e = assertThrows(HrmsException.class, () -> service.confirm(outsider, null, jwt));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("NOT_IN_TEAM", e.getErrorCode());
        assertThrows(HrmsException.class, () -> service.extend(outsider, LocalDate.now().plusMonths(2), null, jwt));
        verifyNoInteractions(workforce, probation, events);
    }

    @Test void onlySomeoneOnProbation() {
        personIs("ACTIVE", null);
        assertEquals("EMPLOYEE_NOT_IN_PROBATION",
                assertThrows(HrmsException.class, () -> service.confirm(member, null, jwt)).getErrorCode());
        verifyNoInteractions(workforce);
    }

    @Test void confirmUsesTodaysConfirmAndTellsTheEmployeeAndHr() {
        personIs("PROBATION", LocalDate.of(2026, 10, 5));
        UUID hr = UUID.randomUUID();
        when(holders.employeesHolding(tenant, "hrms.probation.reminders.read")).thenReturn(List.of(hr, me, member));
        LocalDate on = LocalDate.of(2026, 9, 27);
        TeamProbationService.TeamProbationDecision d = service.confirm(member, on, jwt);
        verify(workforce).confirm(member, on);
        assertEquals("ACTIVE", d.employmentStatus());
        assertEquals(on, d.confirmationDate());
        assertNull(d.probationEndDate());
        ArgumentCaptor<ProbationTeamDecisionEvent> told = ArgumentCaptor.forClass(ProbationTeamDecisionEvent.class);
        verify(events).publishEvent(told.capture());
        assertEquals("confirmed", told.getValue().decision());
        // HR, never the decider or the employee themself (the employee gets their own notice)
        assertEquals(List.of(hr), told.getValue().hrRecipients());
        assertEquals(member, told.getValue().employeeId());
    }

    @Test void extendMustMoveTheEndDateLaterAndUsesTodaysExtend() {
        LocalDate end = LocalDate.of(2026, 10, 5);
        personIs("PROBATION", end);
        assertEquals("PROBATION_DATE_INVALID",
                assertThrows(HrmsException.class, () -> service.extend(member, end, null, jwt)).getErrorCode());
        assertEquals("PROBATION_DATE_REQUIRED",
                assertThrows(HrmsException.class, () -> service.extend(member, null, null, jwt)).getErrorCode());
        verifyNoInteractions(probation);

        when(holders.employeesHolding(any(), any())).thenReturn(List.of());
        TeamProbationService.TeamProbationDecision d = service.extend(member, end.plusMonths(1), "Needs more time", jwt);
        verify(probation).extendProbation(tenant, member, end.plusMonths(1));
        assertEquals("PROBATION", d.employmentStatus());
        assertEquals(end.plusMonths(1), d.probationEndDate());
        ArgumentCaptor<ProbationTeamDecisionEvent> told = ArgumentCaptor.forClass(ProbationTeamDecisionEvent.class);
        verify(events).publishEvent(told.capture());
        assertEquals("extended", told.getValue().decision());
        assertEquals(end.plusMonths(1), told.getValue().newEndDate());
    }

    @Test void theListIsBoundedAndEmptyWithoutATeam() {
        assertEquals("PROBATION_RANGE_INVALID", assertThrows(HrmsException.class, () -> service.list(0, jwt)).getErrorCode());
        assertEquals("PROBATION_RANGE_INVALID", assertThrows(HrmsException.class, () -> service.list(366, jwt)).getErrorCode());
        when(read.members(jwt)).thenReturn(List.of());
        assertEquals(List.of(), service.list(30, jwt));
    }

    /**
     * A manager (DEPT_MANAGER / MANAGER: attendance.team.read, no
     * attendance.workforce.admin) decides only for their own team, through the
     * real My team rule: their direct report yes; a colleague outside the team,
     * or themself, no. The company-wide list is never consulted.
     */
    @Test void aManagerDecidesOnlyForTheirOwnTeam() {
        com.hrms.employee.repository.EmployeeRepository repo = mock(com.hrms.employee.repository.EmployeeRepository.class);
        com.hrms.employee.workforce.repository.WorkforceDepartmentRepository depts =
                mock(com.hrms.employee.workforce.repository.WorkforceDepartmentRepository.class);
        com.hrms.api.attendance.TeamEmployeeScope scope = new com.hrms.api.attendance.TeamEmployeeScope(repo, depts);
        TeamReadService realRead = new TeamReadService(scope, repo, depts, jdbc,
                mock(com.unifiedtree.rbac.security.PermissionChecker.class));
        TeamProbationService real = new TeamProbationService(realRead, jdbc, workforce, probation, holders,
                mock(AuditService.class), events);
        Employee manager = new Employee();
        manager.setId(me);
        manager.setCompanyId(UUID.randomUUID());
        manager.setEmploymentStatus(EmploymentStatus.ACTIVE);
        Employee report = new Employee();
        report.setId(member);
        report.setEmploymentStatus(EmploymentStatus.PROBATION);
        UUID colleague = UUID.randomUUID();
        when(repo.findById(me)).thenReturn(java.util.Optional.of(manager));
        when(depts.findByDepartmentHeadEmployeeId(me)).thenReturn(List.of());
        when(repo.findByManagerId(me)).thenReturn(List.of(report, manager));
        personIs("PROBATION", LocalDate.of(2026, 10, 5));

        LocalDate on = LocalDate.of(2026, 10, 5);
        assertEquals("ACTIVE", real.confirm(member, on, jwt).employmentStatus());
        verify(workforce).confirm(member, on);
        for (UUID notInTeam : List.of(colleague, me)) {
            assertEquals("NOT_IN_TEAM", assertThrows(HrmsException.class,
                    () -> real.confirm(notInTeam, null, jwt)).getErrorCode());
            assertEquals("NOT_IN_TEAM", assertThrows(HrmsException.class,
                    () -> real.extend(notInTeam, LocalDate.of(2026, 12, 1), null, jwt)).getErrorCode());
        }
        verify(workforce, times(1)).confirm(any(), any());
        verifyNoInteractions(probation);
        verify(repo, never()).findActiveByCompany(any());
    }

    @Test void v143_85GivesTheBuiltInManagerRolesTheTeamDecidePermissionOnly() throws Exception {
        String sql = java.nio.file.Files.readString(java.nio.file.Path.of(
                "../hrms-app/src/main/resources/db/canonical/V143_85__managers_decide_team_probation.sql"));
        String statement = sql.substring(sql.indexOf("INSERT INTO rbac.role_permissions"));
        assertTrue(statement.contains("'hrms.probation.team.decide'"));
        assertTrue(statement.contains("r.tenant_id IS NULL"), "built-in roles only");
        assertTrue(statement.contains("r.code IN ('DEPT_MANAGER', 'MANAGER')"));
        assertTrue(statement.contains("ON CONFLICT DO NOTHING"), "idempotent");
        assertFalse(sql.contains("DELETE FROM"), "adds a grant, removes none");
        assertFalse(sql.contains("INSERT INTO rbac.permissions"), "the permission already exists (V143.55)");
        assertEquals(1, sql.split("INSERT INTO", -1).length - 1, "one statement");
    }
}
