package com.hrms.api.team;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** My team's read models: how the team is chosen, who is in it, and the time-off range. */
class TeamReadServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private TeamEmployeeScope scope;
    private TeamReadService service;
    private Jwt jwt;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        scope = mock(TeamEmployeeScope.class);
        service = new TeamReadService(scope, mock(EmployeeRepository.class), mock(WorkforceDepartmentRepository.class),
                mock(JdbcTemplate.class), mock(PermissionChecker.class));
        jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", UUID.randomUUID().toString()).claim("permissions", List.of("attendance.team.read")).build();
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    @Test void theTeamIsTheCompanyTheDepartmentsTheyHeadOrTheirDirectReports() {
        assertEquals("COMPANY", TeamReadService.scopeKind(true, List.of(new Department())));
        assertEquals("DEPARTMENT", TeamReadService.scopeKind(false, List.of(new Department())));
        assertEquals("DIRECT_REPORTS", TeamReadService.scopeKind(false, List.of()));
    }

    @Test void peopleWhoLeftAreNeverMembersAndACallerWithNoRecordHasNoTeam() {
        Employee stays = new Employee();
        stays.setId(UUID.randomUUID());
        stays.setEmploymentStatus(EmploymentStatus.NOTICE_PERIOD);
        Employee gone = new Employee();
        gone.setId(UUID.randomUUID());
        gone.setEmploymentStatus(EmploymentStatus.EXITED);
        when(scope.resolve(jwt, null)).thenReturn(List.of(stays, gone));
        assertEquals(List.of(stays), service.members(jwt));
        when(scope.resolve(jwt, null)).thenThrow(new IllegalArgumentException("Employee not found"));
        assertEquals(List.of(), service.members(jwt));
    }

    @Test void timeOffIsAtMostSixtyTwoDays() {
        Authentication auth = mock(Authentication.class);
        LocalDate from = LocalDate.of(2026, 10, 1);
        HrmsException tooLong = assertThrows(HrmsException.class, () -> service.timeOff(from, from.plusDays(62), jwt, auth));
        assertEquals(HttpStatus.BAD_REQUEST, tooLong.getStatus());
        assertEquals("TIME_OFF_RANGE_INVALID", tooLong.getErrorCode());
        assertThrows(HrmsException.class, () -> service.timeOff(from, from.minusDays(1), jwt, auth));
        when(scope.resolve(jwt, null)).thenReturn(List.of());
        assertEquals(List.of(), service.timeOff(from, from.plusDays(61), jwt, auth));
    }
}
