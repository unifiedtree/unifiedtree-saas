package com.hrms.api.employee;

import com.hrms.api.access.WorkspaceAccessService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.service.EmployeeService;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The old app's "Change role" (PUT /v1/employees/{id}/access): the levels rules of
 * WorkspaceAccessService apply (so an Admin, owner minus billing, can't give more
 * than they hold), and a refused change leaves the person's roles as they were.
 */
class LegacyAccessEndpointTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final WorkspaceAccessService access = mock(WorkspaceAccessService.class);
    private final EmployeeController controller =
            new EmployeeController(mock(EmployeeService.class), null, jdbc, access, null);
    private final UUID employeeId = UUID.randomUUID(), userId = UUID.randomUUID(), actorId = UUID.randomUUID();

    private Jwt jwt() {
        return Jwt.withTokenValue("t").header("alg", "none").subject(actorId.toString()).build();
    }

    private void holds(String... codes) {
        when(jdbc.queryForObject(anyString(), eq(UUID.class), eq(employeeId))).thenReturn(userId);
        when(jdbc.queryForList(anyString(), eq(String.class), eq(userId))).thenReturn(List.of(codes));
    }

    @Test void onlyTheFourLegacyRolesNeverOwnerOrAdmin() {
        for (String role : List.of("OWNER", "SUPER_ADMIN", "ADMIN", "FINANCE_LEAD")) {
            BusinessRuleException e = assertThrows(BusinessRuleException.class,
                    () -> controller.setAccess(employeeId, role, null, jwt()));
            assertTrue(e.getMessage().startsWith("Role must be one of"));
        }
        verifyNoInteractions(access);
    }

    @Test void promotionGivesTheNewRoleThenTakesTheOldOneAway() {
        holds("EMPLOYEE", "DEPT_MANAGER");
        controller.setAccess(employeeId, "HR_MANAGER", null, jwt());
        InOrder order = inOrder(access);
        order.verify(access).assignRole(any(), eq(userId), eq("HR_MANAGER"), eq(actorId));
        order.verify(access).revokeRole(any(), eq(userId), eq("DEPT_MANAGER"), eq(actorId));
        verify(access, never()).revokeRole(any(), any(), eq("HR_MANAGER"), any());
    }

    @Test void aRefusedRoleLeavesTheirRolesAsTheyWere() {
        holds("EMPLOYEE", "DEPT_MANAGER");
        // e.g. an Admin giving a role with a permission they don't hold.
        doThrow(new AccessDeniedException("You can only give a role whose permissions you hold yourself."))
                .when(access).assignRole(any(), eq(userId), eq("HR_MANAGER"), eq(actorId));
        assertThrows(AccessDeniedException.class, () -> controller.setAccess(employeeId, "HR_MANAGER", null, jwt()));
        verify(access, never()).revokeRole(any(), any(), any(), any());
    }

    @Test void aRefusedDemotionIsReportedNotAFakeSuccess() {
        holds("EMPLOYEE", "HR_MANAGER");
        // e.g. your own roles, or an owner's.
        doThrow(new AccessDeniedException("You can't change your own access."))
                .when(access).revokeRole(any(), eq(userId), eq("HR_MANAGER"), eq(actorId));
        assertThrows(AccessDeniedException.class, () -> controller.setAccess(employeeId, "EMPLOYEE", null, jwt()));
        verify(access, never()).assignRole(any(), any(), eq("EMPLOYEE"), any());
    }

    @Test void demotionToEmployeeTakesTheElevatedRolesAway() {
        holds("EMPLOYEE", "DEPT_MANAGER", "HR_MANAGER");
        controller.setAccess(employeeId, "EMPLOYEE", null, jwt());
        verify(access).revokeRole(any(), eq(userId), eq("DEPT_MANAGER"), eq(actorId));
        verify(access).revokeRole(any(), eq(userId), eq("HR_MANAGER"), eq(actorId));
        verify(access, never()).assignRole(any(), any(), any(), any());
    }
}
