package com.unifiedtree.auth.service;

import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.dto.AuthDtos.MeResponse;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.mfa.MfaChallengeTokens;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.repository.RbacRefreshTokenRepository;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.service.PersonalPagesService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * The sign-in answer and /v1/canonical-auth/me carry "personalPages", worked
 * out by PersonalPagesService for the roles the person holds (V143.90). Without
 * the service the field is null, so the clients keep their own role rule.
 */
class AuthServicePersonalPagesTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID employeeRole = UUID.randomUUID();
    private final UUID adminRole = UUID.randomUUID();
    private final UserCredentialsRepository creds = mock(UserCredentialsRepository.class);
    private final UserRoleRepository userRoles = mock(UserRoleRepository.class);
    private final RoleRepository roleRepo = mock(RoleRepository.class);
    private final PasswordService passwords = mock(PasswordService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final PersonalPagesService personalPages = mock(PersonalPagesService.class);
    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 90);
    private AuthService auth;

    @BeforeEach
    void setUp() {
        auth = new AuthService(creds, mock(RbacRefreshTokenRepository.class), userRoles, roleRepo,
                mock(RolePermissionRepository.class), passwords, jwt, mock(JdbcTemplate.class),
                mock(EmployeeBaselinePermissions.class), mfa, new MfaChallengeTokens(jwt));
        UserCredentials c = new UserCredentials();
        c.setId(userId);
        c.setTenantId(tenant);
        c.setEmail("admin@acme.in");
        c.setPasswordHash("hash");
        when(creds.findByEmailForSession("admin@acme.in")).thenReturn(Optional.of(c));
        when(creds.findById(userId)).thenReturn(Optional.of(c));
        when(passwords.matches("right", "hash")).thenReturn(true);
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        // An admin who is also an employee (EMPLOYEE + ADMIN).
        when(userRoles.findAllByUserId(userId)).thenReturn(List.of(
                new UserRole(tenant, userId, employeeRole), new UserRole(tenant, userId, adminRole)));
        when(roleRepo.findAllById(any())).thenReturn(List.of(role(employeeRole, "EMPLOYEE"), role(adminRole, "ADMIN")));
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private static Role role(UUID id, String code) {
        Role r = new Role();
        r.setId(id);
        r.setCode(code);
        return r;
    }

    @Test
    void theSignInAnswerCarriesTheRuleForThePersonsRoles() {
        auth.setPersonalPages(personalPages);
        when(personalPages.forRoles(eq(tenant), eq(List.of(employeeRole, adminRole)))).thenReturn(false);
        LoginResponse out = auth.login(new LoginRequest(tenant, "admin@acme.in", "right"));
        assertEquals(Boolean.FALSE, out.personalPages());
        assertEquals(List.of("ADMIN", "EMPLOYEE"), out.roles());
    }

    @Test
    void anOwnerWhoTurnedThemOnForTheRoleShowsInTheSignInAnswer() {
        auth.setPersonalPages(personalPages);
        when(personalPages.forRoles(eq(tenant), any())).thenReturn(true);
        assertEquals(Boolean.TRUE, auth.login(new LoginRequest(tenant, "admin@acme.in", "right")).personalPages());
    }

    @Test
    void meCarriesTheSameAnswer() {
        auth.setPersonalPages(personalPages);
        when(personalPages.forRoles(eq(tenant), eq(List.of(employeeRole, adminRole)))).thenReturn(true);
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(userId);
        MeResponse me = auth.currentUser();
        assertEquals(Boolean.TRUE, me.personalPages());
        verify(personalPages).forRoles(tenant, List.of(employeeRole, adminRole));
    }

    @Test
    void withoutTheServiceTheFieldIsLeftOutSoClientsKeepTheirRoleRule() {
        assertNull(auth.login(new LoginRequest(tenant, "admin@acme.in", "right")).personalPages());
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(userId);
        assertNull(auth.currentUser().personalPages());
    }
}
