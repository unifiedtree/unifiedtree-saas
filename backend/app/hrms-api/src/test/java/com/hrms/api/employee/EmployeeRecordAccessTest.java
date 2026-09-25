package com.hrms.api.employee;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Who may read another person's leave / expense record (HR any, manager team, else self). */
class EmployeeRecordAccessTest {

    private static final String ANYONE = "hrms.leave.employee.read";
    private static final String TEAM = "hrms.leave.approve.l1";

    private final TeamEmployeeScope teamScope = mock(TeamEmployeeScope.class);
    private final EmployeeRecordAccess access = new EmployeeRecordAccess(teamScope);
    private final UUID me = UUID.randomUUID(), teammate = UUID.randomUUID(), stranger = UUID.randomUUID();

    private static Jwt jwt(UUID employeeId) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString());
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    private static TestingAuthenticationToken auth(Jwt jwt, String... perms) {
        return new TestingAuthenticationToken(jwt, null, perms);
    }

    private static Employee employee(UUID id) {
        Employee e = new Employee();
        e.setId(id);
        return e;
    }

    @Test void hrReadsAnyoneWithoutResolvingATeam() {
        Jwt j = jwt(me);
        assertDoesNotThrow(() -> access.assertCanView(stranger, j, auth(j, ANYONE), ANYONE, TEAM));
        verifyNoInteractions(teamScope);
    }

    @Test void everyoneReadsThemselves() {
        Jwt j = jwt(me);
        assertDoesNotThrow(() -> access.assertCanView(me, j, auth(j, "leave.balance.read"), ANYONE, TEAM));
    }

    @Test void employeeCannotReadSomeoneElse() {
        Jwt j = jwt(me);
        assertThrows(AccessDeniedException.class,
                () -> access.assertCanView(stranger, j, auth(j, "leave.balance.read"), ANYONE, TEAM));
        verifyNoInteractions(teamScope);
    }

    @Test void managerReadsTheirTeamOnly() {
        Jwt j = jwt(me);
        when(teamScope.resolve(any(), isNull())).thenReturn(List.of(employee(teammate)));
        assertDoesNotThrow(() -> access.assertCanView(teammate, j, auth(j, TEAM), ANYONE, TEAM));
        AccessDeniedException refused = assertThrows(AccessDeniedException.class,
                () -> access.assertCanView(stranger, j, auth(j, TEAM), ANYONE, TEAM));
        assertTrue(refused.getMessage().contains("not in your team"));
    }

    @Test void teamPermissionWithoutAnEmployeeRecordIsRefused() {
        Jwt j = jwt(null);
        assertThrows(AccessDeniedException.class,
                () -> access.assertCanView(teammate, j, auth(j, TEAM), ANYONE, TEAM));
        verifyNoInteractions(teamScope);
    }

    @Test void managerWhoseEmployeeRowIsMissingIsRefusedNot500() {
        Jwt j = jwt(me);
        when(teamScope.resolve(any(), isNull())).thenThrow(new IllegalArgumentException("Employee not found"));
        assertThrows(AccessDeniedException.class,
                () -> access.assertCanView(teammate, j, auth(j, TEAM), ANYONE, TEAM));
    }

    @Test void noTeamPermissionConfiguredMeansSelfOnly() {
        Jwt j = jwt(me);
        assertThrows(AccessDeniedException.class,
                () -> access.assertCanView(teammate, j, auth(j, TEAM), ANYONE, null));
    }

    @Test void missingTargetIsRefused() {
        Jwt j = jwt(me);
        assertThrows(AccessDeniedException.class, () -> access.assertCanView(null, j, auth(j, ANYONE), ANYONE, TEAM));
    }
}
