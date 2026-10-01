package com.hrms.api.team;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** "Message team": recipients are only the sender's own team, never the sender or people who left. */
class TeamMessageServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private Employee sender;
    private JdbcTemplate jdbc;
    private TeamEmployeeScope scope;
    private EmployeeRepository employees;
    private WorkforceDepartmentRepository departments;
    private ApplicationEventPublisher events;
    private TeamMessageService service;
    private Jwt jwt;

    private static Employee person(String first, EmploymentStatus status) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setFirstName(first);
        e.setLastName("Kumar");
        e.setEmploymentStatus(status);
        return e;
    }

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        sender = person("Priya", EmploymentStatus.ACTIVE);
        jdbc = mock(JdbcTemplate.class);
        scope = mock(TeamEmployeeScope.class);
        employees = mock(EmployeeRepository.class);
        departments = mock(WorkforceDepartmentRepository.class);
        events = mock(ApplicationEventPublisher.class);
        service = new TeamMessageService(jdbc, scope, employees, departments, mock(AuditService.class), events);
        jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", sender.getId().toString())
                .claim("permissions", List.of("hrms.team.message", "attendance.workforce.admin")).build();
        when(employees.findById(sender.getId())).thenReturn(Optional.of(sender));
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("INSERT INTO hrms.team_messages"), eq(Timestamp.class), any(Object[].class)))
                .thenReturn(Timestamp.from(Instant.now()));
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    @Test void theBodyIsOneToFiveHundredCharacters() {
        assertEquals("Hello team", TeamMessageService.validBody("  Hello team \n"));
        assertEquals("TEAM_MESSAGE_EMPTY", assertThrows(HrmsException.class, () -> TeamMessageService.validBody("   ")).getErrorCode());
        assertEquals("TEAM_MESSAGE_EMPTY", assertThrows(HrmsException.class, () -> TeamMessageService.validBody(null)).getErrorCode());
        assertEquals(500, TeamMessageService.validBody("x".repeat(500)).length());
        HrmsException tooLong = assertThrows(HrmsException.class, () -> TeamMessageService.validBody("x".repeat(501)));
        assertEquals(HttpStatus.BAD_REQUEST, tooLong.getStatus());
    }

    @Test void recipientsAreTheSendersOwnTeamOnlyEvenWithACompanyWidePermission() {
        Employee report = person("Ravi", EmploymentStatus.PROBATION);
        Employee left = person("Anil", EmploymentStatus.EXITED);
        when(scope.teamOf(sender)).thenReturn(List.of(report, left, sender));
        when(departments.findByDepartmentHeadEmployeeId(sender.getId())).thenReturn(List.of());

        TeamMessageService.TeamMessage sent = service.post("Stand-up moves to 10:30 tomorrow", jwt);

        assertEquals(1, sent.recipientCount());
        assertNull(sent.teamLabel());
        // the company-wide scope (resolve) is never used for recipients
        verify(scope, never()).resolve(any(), any());
        ArgumentCaptor<TeamMessagePostedEvent> told = ArgumentCaptor.forClass(TeamMessagePostedEvent.class);
        verify(events).publishEvent(told.capture());
        assertEquals(List.of(report.getId()), told.getValue().recipients());
        assertEquals("Priya Kumar", told.getValue().senderName());
        ArgumentCaptor<BatchPreparedStatementSetter> rows = ArgumentCaptor.forClass(BatchPreparedStatementSetter.class);
        verify(jdbc).batchUpdate(contains("team_message_recipients"), rows.capture());
        assertEquals(1, rows.getValue().getBatchSize());
    }

    @Test void withNoTeamThereIsNothingToSend() {
        when(scope.teamOf(sender)).thenReturn(List.of());
        assertEquals("TEAM_EMPTY", assertThrows(HrmsException.class, () -> service.post("Hello", jwt)).getErrorCode());
        verifyNoInteractions(events);
    }

    @Test void withoutTheTablesItIsNotSwitchedOn() {
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(false);
        assertThrows(FeatureNotReady.class, () -> service.post("Hello", jwt));
        assertThrows(FeatureNotReady.class, () -> service.mine(30, jwt));
        assertThrows(FeatureNotReady.class, () -> service.sent(jwt));
        verifyNoInteractions(events);
    }

    @Test void theReceivedListIsBounded() {
        assertEquals("TEAM_MESSAGE_RANGE_INVALID", assertThrows(HrmsException.class, () -> service.mine(0, jwt)).getErrorCode());
        assertEquals("TEAM_MESSAGE_RANGE_INVALID", assertThrows(HrmsException.class, () -> service.mine(400, jwt)).getErrorCode());
    }
}
