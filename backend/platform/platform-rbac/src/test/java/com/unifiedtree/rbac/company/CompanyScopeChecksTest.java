package com.unifiedtree.rbac.company;

import com.unifiedtree.auth.dto.AuthDtos.MeResponse;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.mfa.MfaChallengeTokens;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.repository.RbacRefreshTokenRepository;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.rbac.service.PersonalPagesService;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * In a company reached through a grant, the {@code @perm} bean and
 * {@code /v1/canonical-auth/me} use the company's roles and permissions (the
 * same set the request's JWT authorities carry); without it, both are exactly
 * as before.
 */
class CompanyScopeChecksTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID companyB = UUID.randomUUID();
    private final UUID managerRole = UUID.randomUUID();
    private final UUID employeeRole = UUID.randomUUID();
    private final UserRoleRepository userRoles = mock(UserRoleRepository.class);
    private final RolePermissionRepository rolePerms = mock(RolePermissionRepository.class);
    private final EmployeeBaselinePermissions baseline = mock(EmployeeBaselinePermissions.class);
    private final CompanyContext.Scope scope = new CompanyContext.Scope(companyB, Set.of(employeeRole),
            List.of("EMPLOYEE"), Set.of("leave.request.self"));

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(userId);
        when(userRoles.findAllByUserId(userId)).thenReturn(List.of(new UserRole(tenant, userId, managerRole)));
        when(rolePerms.findPermissionCodesByRoleIds(any())).thenReturn(List.of("attendance.team.read"));
        when(baseline.effectiveFor(anyCollection(), any(), any())).thenAnswer(inv -> List.copyOf(inv.<java.util.Collection<String>>getArgument(0)));
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        CompanyContext.clear();
    }

    @Test
    void permBeanUsesTheCompanysPermissions() {
        PermissionChecker perm = new PermissionChecker(userRoles, rolePerms, baseline, mock(JdbcTemplate.class));
        assertTrue(perm.check("attendance.team.read"), "home company: the person's own roles");
        CompanyContext.setScope(scope);
        assertFalse(perm.check("attendance.team.read"));
        assertTrue(perm.check("leave.request.self"));
        assertTrue(perm.hasAny("x", "leave.request.self"));
        CompanyContext.clear();
        assertTrue(perm.check("attendance.team.read"), "and back to the home set once the request ends");
    }

    @Test
    void meReportsTheCompanysRolesAndPermissions() {
        UserCredentialsRepository creds = mock(UserCredentialsRepository.class);
        RoleRepository roleRepo = mock(RoleRepository.class);
        PersonalPagesService personalPages = mock(PersonalPagesService.class);
        JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 90);
        AuthService auth = new AuthService(creds, mock(RbacRefreshTokenRepository.class), userRoles, roleRepo,
                rolePerms, mock(PasswordService.class), jwt, mock(JdbcTemplate.class), baseline,
                mock(MfaService.class), new MfaChallengeTokens(jwt));
        auth.setPersonalPages(personalPages);
        UserCredentials c = new UserCredentials();
        c.setId(userId);
        c.setTenantId(tenant);
        c.setEmail("mgr@acme.in");
        when(creds.findById(userId)).thenReturn(Optional.of(c));
        Role manager = new Role();
        manager.setId(managerRole);
        manager.setCode("DEPT_MANAGER");
        when(roleRepo.findAllById(any())).thenReturn(List.of(manager));
        when(personalPages.forRoles(eq(tenant), any())).thenReturn(true);

        MeResponse home = auth.currentUser();
        assertEquals(List.of("DEPT_MANAGER"), home.roles());
        assertEquals(List.of("attendance.team.read"), home.permissions());

        CompanyContext.setScope(scope);
        MeResponse inB = auth.currentUser();
        assertEquals(List.of("EMPLOYEE"), inB.roles());
        assertEquals(List.of("leave.request.self"), inB.permissions());
        verify(personalPages).forRoles(tenant, List.of(employeeRole));
    }
}
