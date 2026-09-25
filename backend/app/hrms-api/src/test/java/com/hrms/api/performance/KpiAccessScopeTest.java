package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class KpiAccessScopeTest {
    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();

    @AfterEach void clearContext() {
        SecurityContextHolder.clearContext();
        com.hrms.core.tenant.TenantContext.clear();
        com.unifiedtree.security.tenant.TenantContext.clear();
    }

    /** What each built-in role's token carries for these checks (V143.17: permissions, not role names). */
    private static final java.util.Map<String, List<String>> PERMS = java.util.Map.of(
            "OWNER", List.of("hrms.performance.write", "hrms.kpi.manage", "attendance.team.read"),
            "SUPER_ADMIN", List.of("hrms.performance.write", "hrms.kpi.manage", "attendance.team.read"),
            "HR_MANAGER", List.of("hrms.performance.write", "hrms.kpi.manage", "attendance.team.read"),
            "ADMIN", List.of("hrms.performance.write", "hrms.kpi.manage", "attendance.team.read"),
            "DEPT_MANAGER", List.of("hrms.performance.read", "hrms.kpi.progress", "attendance.team.read"),
            "MANAGER", List.of("attendance.team.read"),
            "EMPLOYEE", List.of("hrms.performance.review.self"),
            "CUSTOM_REVIEWER", List.of("hrms.performance.read"));

    private JwtAuthenticationToken authentication(String role, UUID employeeId) {
        return authentication(role, employeeId, PERMS.getOrDefault(role, List.of()));
    }

    private JwtAuthenticationToken authentication(String role, UUID employeeId, List<String> permissions) {
        var builder = Jwt.withTokenValue("local-test").header("alg", "none")
                .subject(UUID.randomUUID().toString()).claim("roles", List.of(role)).claim("permissions", permissions);
        if (employeeId != null) builder.claim("employee_id", employeeId.toString());
        List<SimpleGrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
        permissions.forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
        return new JwtAuthenticationToken(builder.build(), authorities);
    }

    @Test void onlyAdministrativePermissionsHaveUnrestrictedOwnerScope() {
        for (String role : List.of("OWNER", "ADMIN", "HR_MANAGER", "SUPER_ADMIN")) {
            assertEquals(KpiAccessScope.Kind.ADMIN, KpiAccessScope.from(authentication(role, null)).kind(), role);
        }
        assertEquals(KpiAccessScope.Kind.TEAM, KpiAccessScope.from(authentication("MANAGER", employee)).kind());
        assertEquals(KpiAccessScope.Kind.TEAM, KpiAccessScope.from(authentication("DEPT_MANAGER", employee)).kind());
        assertEquals(KpiAccessScope.Kind.SELF, KpiAccessScope.from(authentication("EMPLOYEE", employee)).kind());
        assertEquals(KpiAccessScope.Kind.SELF, KpiAccessScope.from(authentication("CUSTOM_REVIEWER", employee)).kind());
    }

    @Test void roleNamesAloneNoLongerGrantCompanyWideScope() {
        // A token that says OWNER but carries none of the permissions is SELF.
        assertEquals(KpiAccessScope.Kind.SELF,
                KpiAccessScope.from(authentication("OWNER", employee, List.of())).kind());
        // A manager given hrms.kpi.manage individually sees the whole company.
        assertEquals(KpiAccessScope.Kind.ADMIN,
                KpiAccessScope.from(authentication("DEPT_MANAGER", employee,
                        List.of("attendance.team.read", "hrms.kpi.manage"))).kind());
    }

    @Test void missingEmployeeClaimDoesNotFallBackToCredentialSubject() {
        assertThrows(AccessDeniedException.class, () -> KpiAccessScope.from(authentication("MANAGER", null)));
        assertThrows(AccessDeniedException.class, () -> KpiAccessScope.from(authentication("EMPLOYEE", null)));
        assertThrows(AccessDeniedException.class, () -> KpiAccessScope.from(null));
    }

    @Test void employeePredicateIsBoundToAuthenticatedEmployee() {
        StringBuilder sql = new StringBuilder("WHERE g.tenant_id = ?");
        List<Object> args = new ArrayList<>(List.of(tenant));
        KpiAccessScope.from(authentication("EMPLOYEE", employee)).appendGoalPredicate(sql, args);
        assertTrue(sql.toString().contains("AND g.employee_id = ?"));
        assertEquals(List.of(tenant, employee), args);
    }

    /** A team scope that resolves the manager's team to exactly {@code members}. */
    private PerformanceTeamScope team(UUID... members) {
        PerformanceTeamScope scope = mock(PerformanceTeamScope.class);
        when(scope.teamOf(any())).thenReturn(java.util.Set.of(members));
        return scope;
    }

    @Test void suppliedManagerFilterCannotReplaceManagerObjectScope() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID forgedManager = UUID.randomUUID(), teammate = UUID.randomUUID();
        SecurityContextHolder.getContext().setAuthentication(authentication("MANAGER", employee));
        new KpiService(jdbc, team(teammate)).list(tenant, null, forgedManager, null, null, 0, 25);
        verify(jdbc).queryForObject(contains("g.employee_id IN (?)"), eq(Long.class),
                eq(tenant), eq(teammate), eq(forgedManager));
    }

    @Test void managerWithNoTeamSeesNothing() {
        StringBuilder sql = new StringBuilder("WHERE g.tenant_id = ?");
        List<Object> args = new ArrayList<>(List.of(tenant));
        KpiAccessScope.from(authentication("DEPT_MANAGER", employee)).withTeam(java.util.Set.of()).appendGoalPredicate(sql, args);
        assertTrue(sql.toString().endsWith(" AND FALSE"));
        assertEquals(List.of(tenant), args);
    }

    @Test void teamScopeCoversOnlyTeammatesNeverTheManager() {
        UUID teammate = UUID.randomUUID();
        KpiAccessScope scope = KpiAccessScope.from(authentication("DEPT_MANAGER", employee)).withTeam(java.util.Set.of(teammate));
        assertTrue(scope.covers(teammate));
        assertFalse(scope.covers(employee));
        assertFalse(scope.covers(UUID.randomUUID()));
        assertTrue(KpiAccessScope.from(authentication("ADMIN", null)).covers(UUID.randomUUID()));
    }

    @Test void outOfScopeKpiCannotExposeHistoryOrAcceptProgress() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ResultSet noVisibleRow = mock(ResultSet.class);
        when(noVisibleRow.next()).thenReturn(false);
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(invocation -> ((ResultSetExtractor<?>) invocation.getArgument(1)).extractData(noVisibleRow));
        SecurityContextHolder.getContext().setAuthentication(authentication("MANAGER", employee));
        KpiService service = new KpiService(jdbc, team(UUID.randomUUID()));
        UUID inaccessibleKpi = UUID.randomUUID();
        assertThrows(BusinessRuleException.class, () -> service.progressHistory(tenant, inaccessibleKpi));
        assertThrows(BusinessRuleException.class, () -> service.updateProgress(tenant, inaccessibleKpi,
                new KpiService.ProgressUpdateRequest(BigDecimal.TEN, "Out of scope"), UUID.randomUUID()));
        verify(jdbc, times(2)).query(contains("g.employee_id IN (?)"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), eq(tenant), eq(inaccessibleKpi), any(UUID.class));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
