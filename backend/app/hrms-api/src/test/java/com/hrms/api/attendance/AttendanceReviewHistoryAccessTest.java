package com.hrms.api.attendance;

import com.hrms.attendance.policy.EffectiveDayStatusService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Who may read the manual status changes on someone's days (GET /v1/attendance/review/history).
 * The team check covers today's staff only, so people who have left (exited, terminated) answered
 * 403 even for owner / admin / HR. A company-wide reader now sees anyone in their own company,
 * leavers included; a manager still sees only their team.
 */
class AttendanceReviewHistoryAccessTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TeamEmployeeScope team = mock(TeamEmployeeScope.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final AttendanceReviewService review = new AttendanceReviewService(jdbc, mock(EffectiveDayStatusService.class), team,
            employees, mock(WorkforceDepartmentRepository.class), mock(ApplicationEventPublisher.class));

    private final UUID company = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();
    private final UUID teammate = UUID.randomUUID();
    private final UUID leaver = UUID.randomUUID();
    private final UUID otherCompanyPerson = UUID.randomUUID();

    AttendanceReviewHistoryAccessTest() {
        person(me, company);
        person(teammate, company);
        person(leaver, company);
        person(otherCompanyPerson, UUID.randomUUID());
    }

    private void person(UUID id, UUID companyId) {
        Employee e = new Employee();
        e.setId(id);
        e.setCompanyId(companyId);
        when(employees.findById(id)).thenReturn(Optional.of(e));
    }

    /** Today's team (the leaver is never in it: findActiveByCompany leaves them out). */
    private void myTeamIs(UUID... ids) {
        List<Employee> people = Arrays.stream(ids).map(id -> { Employee e = new Employee(); e.setId(id); return e; }).toList();
        when(team.resolve(any(Jwt.class), isNull())).thenReturn(people);
    }

    private Jwt as(String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).claim("permissions", List.of(permissions)).build();
    }

    private void queried(UUID employeeId) {
        verify(jdbc).query(anyString(), any(RowMapper.class), eq(employeeId), any(), any());
    }

    @Test void hrReadsTheHistoryOfSomeoneWhoHasLeft() {
        myTeamIs(teammate);
        assertNotNull(review.history(as("attendance.workforce.admin", "attendance.team.read", "attendance.status.review"), leaver, null, null));
        queried(leaver);
    }

    @Test void hrStillReadsTodaysStaff() {
        myTeamIs(teammate);
        assertNotNull(review.history(as("attendance.workforce.admin", "attendance.team.read"), teammate, null, null));
        queried(teammate);
    }

    @Test void hrCannotReadSomeoneInAnotherCompany() {
        myTeamIs(teammate);
        assertThrows(AccessDeniedException.class,
                () -> review.history(as("attendance.workforce.admin", "attendance.team.read"), otherCompanyPerson, null, null));
        verifyNoInteractions(jdbc);
    }

    @Test void hrCannotReadSomeoneWhoDoesNotExist() {
        myTeamIs(teammate);
        UUID nobody = UUID.randomUUID();
        when(employees.findById(nobody)).thenReturn(Optional.empty());
        assertThrows(AccessDeniedException.class, () -> review.history(as("attendance.workforce.admin"), nobody, null, null));
        verifyNoInteractions(jdbc);
    }

    @Test void aManagerReadsTheirTeamButNotALeaverOutsideIt() {
        myTeamIs(teammate);
        Jwt manager = as("attendance.team.read", "attendance.status.review");
        assertNotNull(review.history(manager, teammate, null, null));
        assertThrows(AccessDeniedException.class, () -> review.history(manager, leaver, null, null));
        queried(teammate);
        verify(jdbc, never()).query(anyString(), any(RowMapper.class), eq(leaver), any(), any());
    }

    @Test void anEmployeeReadsOnlyTheirOwn() {
        myTeamIs();
        Jwt employee = as("attendance.checkin.self");
        assertNotNull(review.history(employee, me, null, null));
        assertThrows(AccessDeniedException.class, () -> review.history(employee, leaver, null, null));
    }
}
