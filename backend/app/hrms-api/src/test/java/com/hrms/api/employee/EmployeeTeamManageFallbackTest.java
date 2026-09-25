package com.hrms.api.employee;

import com.hrms.employee.service.EmployeeService;
import com.unifiedtree.rbac.security.PermissionChecker;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * hrms.employee.team.manage is new in V143.17, so a department manager's token
 * minted before the deploy lacks it. The team checks must then fall back to
 * the database-backed @perm bean instead of refusing until the next sign-in.
 */
class EmployeeTeamManageFallbackTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static void signIn(String... authorities) {
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken("u", null, authorities));
    }

    @Test
    void tokenWithThePermissionPassesWithoutADatabaseLookup() {
        PermissionChecker perm = mock(PermissionChecker.class);
        EmployeeController c = new EmployeeController(mock(EmployeeService.class), null, null, null, perm);
        signIn("hrms.employee.team.manage");
        assertThat(c.holdsTeamManage()).isTrue();
        verify(perm, never()).check("hrms.employee.team.manage");
    }

    @Test
    void oldTokenFallsBackToTheDatabase() {
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check("hrms.employee.team.manage")).thenReturn(true);
        EmployeeController c = new EmployeeController(mock(EmployeeService.class), null, null, null, perm);
        signIn("attendance.team.read");
        assertThat(c.holdsTeamManage()).isTrue();
    }

    @Test
    void notHeldAnywhereIsRefused() {
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check("hrms.employee.team.manage")).thenReturn(false);
        EmployeeController c = new EmployeeController(mock(EmployeeService.class), null, null, null, perm);
        signIn("attendance.team.read");
        assertThat(c.holdsTeamManage()).isFalse();
    }

    @Test
    void aFailingLookupIsRefusedNotThrown() {
        PermissionChecker perm = mock(PermissionChecker.class);
        when(perm.check("hrms.employee.team.manage")).thenThrow(new IllegalStateException("db down"));
        EmployeeController c = new EmployeeController(mock(EmployeeService.class), null, null, null, perm);
        signIn();
        assertThat(c.holdsTeamManage()).isFalse();
    }
}
