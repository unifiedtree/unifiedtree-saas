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

    private JwtAuthenticationToken authentication(String role, UUID employeeId) {
        var builder = Jwt.withTokenValue("local-test").header("alg", "none")
                .subject(UUID.randomUUID().toString()).claim("roles", List.of(role));
        if (employeeId != null) builder.claim("employee_id", employeeId.toString());
        return new JwtAuthenticationToken(builder.build(), List.of(new SimpleGrantedAuthority("ROLE_" + role)));
    }

    @Test void onlyAdministrativeRolesHaveUnrestrictedOwnerScope() {
        for (String role : List.of("OWNER", "ADMIN", "COMPANY_ADMIN", "HR_MANAGER", "SUPER_ADMIN")) {
            assertEquals(KpiAccessScope.Kind.ADMIN, KpiAccessScope.from(authentication(role, null)).kind(), role);
        }
        assertEquals(KpiAccessScope.Kind.DIRECT_REPORTS, KpiAccessScope.from(authentication("MANAGER", employee)).kind());
        assertEquals(KpiAccessScope.Kind.DIRECT_REPORTS, KpiAccessScope.from(authentication("DEPT_MANAGER", employee)).kind());
        assertEquals(KpiAccessScope.Kind.SELF, KpiAccessScope.from(authentication("EMPLOYEE", employee)).kind());
        assertEquals(KpiAccessScope.Kind.SELF, KpiAccessScope.from(authentication("CUSTOM_REVIEWER", employee)).kind());
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

    @Test void suppliedManagerFilterCannotReplaceManagerObjectScope() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID forgedManager = UUID.randomUUID();
        SecurityContextHolder.getContext().setAuthentication(authentication("MANAGER", employee));
        new KpiService(jdbc).list(tenant, null, forgedManager, null, null, 0, 25);
        verify(jdbc).queryForObject(contains("scoped.reporting_manager_id = ?"), eq(Long.class),
                eq(tenant), eq(employee), eq(forgedManager));
    }

    @Test void outOfScopeKpiCannotExposeHistoryOrAcceptProgress() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ResultSet noVisibleRow = mock(ResultSet.class);
        when(noVisibleRow.next()).thenReturn(false);
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(invocation -> ((ResultSetExtractor<?>) invocation.getArgument(1)).extractData(noVisibleRow));
        SecurityContextHolder.getContext().setAuthentication(authentication("MANAGER", employee));
        KpiService service = new KpiService(jdbc);
        UUID inaccessibleKpi = UUID.randomUUID();
        assertThrows(BusinessRuleException.class, () -> service.progressHistory(tenant, inaccessibleKpi));
        assertThrows(BusinessRuleException.class, () -> service.updateProgress(tenant, inaccessibleKpi,
                new KpiService.ProgressUpdateRequest(BigDecimal.TEN, "Out of scope"), UUID.randomUUID()));
        verify(jdbc, times(2)).query(contains("scoped.reporting_manager_id = ?"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), eq(tenant), eq(inaccessibleKpi), eq(employee));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
