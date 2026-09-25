package com.hrms.api.attendance;

import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.attendance.service.EmployeeShiftService;
import com.hrms.attendance.service.ShiftChangeRequestService;
import com.hrms.attendance.service.ShiftHistoryService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Who may read a shift history (GET /v1/shifts/employee/{id}/history) and whose
 * decided shift requests an approver sees (GET /v1/shifts/change-requests/decided).
 */
class ShiftHistoryAccessTest {

    private final EmployeeShiftService shifts = mock(EmployeeShiftService.class);
    private final ShiftChangeRequestService requests = mock(ShiftChangeRequestService.class);
    private final TeamEmployeeScope team = mock(TeamEmployeeScope.class);
    private final ShiftHistoryService history = mock(ShiftHistoryService.class);
    private final ShiftController controller = new ShiftController(shifts, requests, team, history);

    private final UUID me = UUID.randomUUID();
    private final UUID teammate = UUID.randomUUID();
    private final UUID stranger = UUID.randomUUID();

    @AfterEach void clear() { SecurityContextHolder.clearContext(); }

    private Jwt as(List<String> roles, String... authorities) {
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken("u", "p", authorities));
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).claim("roles", roles).build();
    }

    private void myTeamIs(UUID... ids) {
        List<Employee> people = java.util.Arrays.stream(ids).map(id -> { Employee e = new Employee(); e.setId(id); return e; }).toList();
        when(team.resolve(any(Jwt.class), isNull())).thenReturn(people);
    }

    @Test void everyoneMayReadTheirOwnHistory() {
        Jwt jwt = as(List.of("EMPLOYEE"), "attendance.checkin.self");
        assertEquals(200, controller.history(jwt, me).getStatusCode().value());
        verify(history).history(me);
    }

    @Test void anEmployeeCannotReadSomeoneElses() {
        Jwt jwt = as(List.of("EMPLOYEE"), "attendance.checkin.self");
        assertThrows(AccessDeniedException.class, () -> controller.history(jwt, stranger));
        verify(history, never()).history(any());
    }

    @Test void whoeverAssignsShiftsMayReadAnyonesHistory() {
        Jwt jwt = as(List.of("HR_MANAGER"), "attendance.workforce.admin", "attendance.team.read");
        assertEquals(200, controller.history(jwt, stranger).getStatusCode().value());
        verifyNoInteractions(team);
    }

    @Test void aManagerReadsTheirTeamOnly() {
        Jwt jwt = as(List.of("DEPT_MANAGER"), "attendance.team.read");
        myTeamIs(teammate);
        assertEquals(200, controller.history(jwt, teammate).getStatusCode().value());
        assertThrows(AccessDeniedException.class, () -> controller.history(jwt, stranger));
    }

    @Test void aManagerWithoutAnEmployeeRecordIsRefusedNotBroken() {
        Jwt jwt = as(List.of("DEPT_MANAGER"), "attendance.team.read");
        when(team.resolve(any(Jwt.class), isNull())).thenThrow(new IllegalArgumentException("Employee not found"));
        assertThrows(AccessDeniedException.class, () -> controller.history(jwt, stranger));
    }

    private ShiftChangeRequestResponse decided(UUID employee) {
        return new ShiftChangeRequestResponse(UUID.randomUUID(), employee, null, "General", UUID.randomUUID(), "Night",
                "Evening classes", "APPROVED", me, "Fine", Instant.now(), Instant.now(), LocalDate.now(), LocalDate.now(), "HR Manager");
    }

    @Test void aManagerSeesOnlyTheirTeamsDecidedRequests() {
        Jwt jwt = as(List.of("DEPT_MANAGER"), "attendance.regularization.approve");
        myTeamIs(teammate);
        when(requests.listDecided(30)).thenReturn(List.of(decided(teammate), decided(stranger)));
        var body = controller.decidedChangeRequests(jwt, 30).getBody();
        assertNotNull(body);
        assertEquals(1, body.size());
        assertEquals(teammate, body.getFirst().employeeId());
        assertEquals("HR Manager", body.getFirst().approverName());
    }

    @Test void hrSeesEveryDecidedRequest() {
        Jwt jwt = as(List.of("HR_MANAGER"), "attendance.regularization.approve");
        when(requests.listDecided(7)).thenReturn(List.of(decided(teammate), decided(stranger)));
        assertEquals(2, controller.decidedChangeRequests(jwt, 7).getBody().size());
    }

    @Test void theLookBackMustBeBetweenADayAndAYear() {
        Jwt jwt = as(List.of("HR_MANAGER"), "attendance.regularization.approve");
        assertThrows(BusinessRuleException.class, () -> controller.decidedChangeRequests(jwt, 0));
        assertThrows(BusinessRuleException.class, () -> controller.decidedChangeRequests(jwt, 366));
        verifyNoInteractions(requests);
    }
}
