package com.unifiedtree.auth.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
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
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** The two-factor gate of a password sign-in: nobody gets a session without the code. */
class AuthServiceMfaGateTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UserCredentialsRepository creds = mock(UserCredentialsRepository.class);
    private final RbacRefreshTokenRepository refresh = mock(RbacRefreshTokenRepository.class);
    private final UserRoleRepository userRoles = mock(UserRoleRepository.class);
    private final RoleRepository roles = mock(RoleRepository.class);
    private final PasswordService passwords = mock(PasswordService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 7);
    private final MfaChallengeTokens challenges = new MfaChallengeTokens(jwt);
    private AuthService auth;

    @BeforeEach
    void setUp() {
        auth = new AuthService(creds, refresh, userRoles, roles, mock(RolePermissionRepository.class), passwords, jwt,
                mock(JdbcTemplate.class), mock(EmployeeBaselinePermissions.class), mfa, challenges);
        UserCredentials c = new UserCredentials();
        c.setId(userId);
        c.setTenantId(tenant);
        c.setEmail("fin@acme.in");
        c.setPasswordHash("hash");
        when(creds.findByEmailForSession("fin@acme.in")).thenReturn(Optional.of(c));
        when(passwords.matches("right", "hash")).thenReturn(true);
        UUID roleId = UUID.randomUUID();
        when(userRoles.findAllByUserId(userId)).thenReturn(List.of(new UserRole(tenant, userId, roleId)));
        Role r = new Role();
        r.setId(roleId);
        r.setCode("FINANCE_LEAD");
        when(roles.findAllById(any())).thenReturn(List.of(r));
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private LoginRequest req(String password) {
        return new LoginRequest(tenant, "fin@acme.in", password);
    }

    @Test
    void wrongPasswordNeverReachesTheTwoFactorStep() {
        assertThrows(BusinessRuleException.class, () -> auth.loginWithMfa(req("wrong"), true));
        verify(mfa, never()).requirementFor(any(), any(), any());
    }

    @Test
    void clientsThatCantAskForACodeAreRefusedWithGuidance() {
        when(mfa.requirementFor(eq(tenant), eq(userId), any())).thenReturn(MfaService.Requirement.VERIFY);
        HrmsException e = assertThrows(HrmsException.class, () -> auth.login(req("right")));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("MFA_REQUIRED", e.getErrorCode());
        assertTrue(e.getMessage().contains("mobile number"));

        when(mfa.requirementFor(eq(tenant), eq(userId), any())).thenReturn(MfaService.Requirement.SETUP);
        HrmsException s = assertThrows(HrmsException.class, () -> auth.loginWithMfa(req("right"), false));
        assertEquals("MFA_SETUP_REQUIRED", s.getErrorCode());
        verify(refresh, never()).save(any());
    }

    @Test
    void theWebGetsAChallengeAndNoSession() {
        when(mfa.requirementFor(eq(tenant), eq(userId), any())).thenReturn(MfaService.Requirement.VERIFY);
        AuthService.LoginOutcome o = auth.loginWithMfa(req("right"), true);
        assertTrue(o.needsMfa());
        assertNull(o.session());
        assertEquals(MfaChallengeTokens.Purpose.VERIFY, o.mfaPurpose());
        MfaChallengeTokens.Challenge c = challenges.parse(o.mfaToken());
        assertEquals(userId, c.userId());
        assertEquals(tenant, c.tenantId());
        verify(refresh, never()).save(any());
        verify(mfa).requirementFor(eq(tenant), eq(userId), argThat(l -> l.contains("FINANCE_LEAD")));
    }

    @Test
    void workspaceRuleLeadsToSetUp() {
        when(mfa.requirementFor(eq(tenant), eq(userId), any())).thenReturn(MfaService.Requirement.SETUP);
        AuthService.LoginOutcome o = auth.loginWithMfa(req("right"), true);
        assertEquals(MfaChallengeTokens.Purpose.SETUP, o.mfaPurpose());
        assertEquals(MfaChallengeTokens.Purpose.SETUP, challenges.parse(o.mfaToken()).purpose());
    }
}
