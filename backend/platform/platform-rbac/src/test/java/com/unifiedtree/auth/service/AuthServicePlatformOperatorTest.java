package com.unifiedtree.auth.service;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.entity.RefreshToken;
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
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * F1 (9 Oct 2026): UnifiedTree's platform operators live in the platform tenant and sign in at
 * /v1/platform/auth/login only. Every workspace way in refuses them like a login that does not exist:
 * password sign-in (platform tenant named, or routed there by email), the two-factor step, refresh,
 * phone / Google / account hand-over (issueWorkspaceSession) and invite activation. A login that holds
 * PLATFORM_SUPER_ADMIN anywhere is refused the same way. Business sign-in is unchanged.
 */
class AuthServicePlatformOperatorTest {

    static final UUID PLATFORM = TenantContext.PLATFORM_TENANT_ID;

    private final UUID business = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID employeeRole = UUID.randomUUID();
    private final UUID platformRole = UUID.fromString("00000000-0000-0000-0000-000000000006");
    private final UserCredentialsRepository creds = mock(UserCredentialsRepository.class);
    private final RbacRefreshTokenRepository refreshRepo = mock(RbacRefreshTokenRepository.class);
    private final UserRoleRepository userRoles = mock(UserRoleRepository.class);
    private final RoleRepository roleRepo = mock(RoleRepository.class);
    private final PasswordService passwords = mock(PasswordService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final MfaService mfa = mock(MfaService.class);
    private final MfaChallengeTokens challenges = mock(MfaChallengeTokens.class);
    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 7);
    private AuthService auth;
    private UserCredentials login;

    @BeforeEach
    void setUp() {
        EmployeeBaselinePermissions baseline = mock(EmployeeBaselinePermissions.class);
        when(baseline.effectiveFor(any(), any(), any())).thenReturn(List.of("hrms.employee.read"));
        auth = new AuthService(creds, refreshRepo, userRoles, roleRepo, mock(RolePermissionRepository.class),
                passwords, jwt, jdbc, baseline, mfa, challenges);
        login = new UserCredentials();
        login.setId(userId);
        login.setTenantId(business);
        login.setEmail("ops@unifiedtree.test");
        login.setPasswordHash("hash");
        login.setActive(true);
        when(creds.findByEmailForSession("ops@unifiedtree.test")).thenReturn(Optional.of(login));
        when(creds.findByIdForSession(userId)).thenReturn(Optional.of(login));
        when(passwords.matches("right", "hash")).thenReturn(true);
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
        holds(employeeRole, "EMPLOYEE");
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private void holds(UUID roleId, String code) {
        Role r = new Role();
        r.setId(roleId);
        r.setCode(code);
        when(userRoles.findAllByUserId(userId)).thenReturn(List.of(new UserRole(business, userId, roleId)));
        when(roleRepo.findAllById(any())).thenReturn(List.of(r));
    }

    private static void refusedAs(String code, org.junit.jupiter.api.function.Executable call) {
        BusinessRuleException e = assertThrows(BusinessRuleException.class, call);
        assertEquals(code, e.getErrorCode());
    }

    /** No session was started: nothing saved, no refresh token, no two-factor challenge. */
    private void noSession() {
        verify(refreshRepo, never()).save(any());
        verify(creds, never()).save(any());
        verifyNoInteractions(challenges);
    }

    // ── password sign-in ──────────────────────────────────────────────────────

    @Test
    void thePlatformTenantNamedInTheBodyAnswersLikeAnUnknownEmail() {
        BusinessRuleException unknown = assertThrows(BusinessRuleException.class,
                () -> auth.login(new LoginRequest(business, "nobody@acme.test", "right", null)));
        BusinessRuleException operator = assertThrows(BusinessRuleException.class,
                () -> auth.login(new LoginRequest(PLATFORM, "ops@unifiedtree.test", "right", null)));
        assertEquals(unknown.getErrorCode(), operator.getErrorCode());
        assertEquals(unknown.getMessage(), operator.getMessage());
        assertEquals(unknown.getStatus(), operator.getStatus());
        assertEquals("INVALID_CREDENTIALS", operator.getErrorCode());
        verify(creds, never()).findByEmailForSession("ops@unifiedtree.test");
        noSession();
    }

    @Test
    void thePlatformTenantBoundByEmailRoutingIsRefusedToo() {
        // The controller binds the routed tenant and sends no tenantId (email-only sign-in).
        TenantContext.setTenantId(PLATFORM);
        refusedAs("INVALID_CREDENTIALS", () -> auth.login(new LoginRequest(null, "ops@unifiedtree.test", "right", null)));
        verify(creds, never()).findByEmailForSession(anyString());
        noSession();
    }

    @Test
    void theWebClientGetsNoTwoFactorChallengeEither() {
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.VERIFY);
        refusedAs("INVALID_CREDENTIALS",
                () -> auth.loginWithMfa(new LoginRequest(PLATFORM, "ops@unifiedtree.test", "right", true), true));
        noSession();
    }

    @Test
    void aLoginHoldingThePlatformRoleIsRefusedInABusinessToo() {
        holds(platformRole, "PLATFORM_SUPER_ADMIN");
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.SETUP);
        refusedAs("INVALID_CREDENTIALS",
                () -> auth.loginWithMfa(new LoginRequest(business, "ops@unifiedtree.test", "right", true), true));
        noSession();
    }

    @Test
    void theTwoFactorStepRefusesThePlatformTenant() {
        refusedAs("INVALID_CREDENTIALS", () -> auth.completeMfaLogin(PLATFORM, userId));
        verify(creds, never()).findByIdForSession(any());
        noSession();
    }

    @Test
    void theTwoFactorStepRefusesAPlatformRoleHolder() {
        holds(platformRole, "PLATFORM_SUPER_ADMIN");
        refusedAs("INVALID_CREDENTIALS", () -> auth.completeMfaLogin(business, userId));
        noSession();
    }

    // ── refresh ───────────────────────────────────────────────────────────────

    @Test
    void aPlatformTenantRefreshTokenIsAnsweredLikeAnUnknownOne() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("refresh_token_tenant"), eq(UUID.class), anyString())).thenReturn(PLATFORM);
        refusedAs("REFRESH_NOT_FOUND", () -> auth.refresh("a-platform-refresh-token"));
        verifyNoInteractions(refreshRepo);   // not read, not rotated
        noSession();
    }

    @Test
    void withoutTheLookupFunctionTheScanSkipsThePlatformTenant() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(false);
        when(jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class)).thenReturn(List.of(PLATFORM));
        refusedAs("REFRESH_NOT_FOUND", () -> auth.refresh("a-platform-refresh-token"));
        verify(jdbc, never()).queryForObject(contains("set_config"), eq(String.class), eq(PLATFORM.toString()));
        verifyNoInteractions(refreshRepo);
    }

    @Test
    void aRefreshForAPlatformRoleHolderIsRefusedWithNoNewSession() {
        holds(platformRole, "PLATFORM_SUPER_ADMIN");
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("refresh_token_tenant"), eq(UUID.class), anyString())).thenReturn(business);
        RefreshToken rt = new RefreshToken();
        rt.setUserId(userId);
        rt.setExpiresAt(OffsetDateTime.now().plusDays(1));
        when(refreshRepo.findByTokenHash(anyString())).thenReturn(Optional.of(rt));
        refusedAs("INVALID_CREDENTIALS", () -> auth.refresh("a-refresh-token"));
        verify(refreshRepo, never()).save(any());
        verify(creds, never()).save(any());
    }

    // ── phone, Google, account hand-over, invite activation ──────────────────

    @Test
    void phoneGoogleAndAccountHandOverRefuseThePlatformTenant() {
        refusedAs("WORKSPACE_USER_NOT_FOUND", () -> auth.issueWorkspaceSession(PLATFORM, userId));
        verify(creds, never()).findByIdForSession(any());
        noSession();
    }

    @Test
    void phoneGoogleAndAccountHandOverRefuseAPlatformRoleHolder() {
        holds(platformRole, "PLATFORM_SUPER_ADMIN");
        refusedAs("INVALID_CREDENTIALS", () -> auth.issueWorkspaceSession(business, userId));
        noSession();
    }

    @Test
    void inviteActivationRefusesThePlatformTenant() {
        refusedAs("USER_NOT_FOUND", () -> auth.issueSessionForActivatedUser(userId, PLATFORM));
        verify(creds, never()).findByIdForSession(any());
        noSession();
    }

    // ── email routing ─────────────────────────────────────────────────────────

    @Test
    void emailRoutingNeverNamesThePlatformTenant() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("login_tenant_for_email"), eq(UUID.class), eq("ops@unifiedtree.test")))
                .thenReturn(PLATFORM);
        when(jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class))
                .thenReturn(List.of(PLATFORM));
        assertNull(auth.resolveLoginTenant("ops@unifiedtree.test"));
        verify(jdbc, never()).queryForObject(contains("set_config"), eq(String.class), eq(PLATFORM.toString()));
    }

    @Test
    void anOperatorAddressThatIsAlsoABusinessLoginStillReachesThatBusiness() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("login_tenant_for_email"), eq(UUID.class), eq("ops@unifiedtree.test")))
                .thenReturn(PLATFORM);
        when(jdbc.queryForList("SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class))
                .thenReturn(List.of(PLATFORM, business));
        Map<String, Object> one = new java.util.HashMap<>();
        one.put("c", 1L);
        one.put("ep", null);
        when(jdbc.queryForMap(contains("FROM auth.user_credentials"), eq("ops@unifiedtree.test"))).thenReturn(one);
        assertEquals(business, auth.resolveLoginTenant("ops@unifiedtree.test"));
        verify(jdbc).queryForObject(contains("set_config"), eq(String.class), eq(business.toString()));
        verify(jdbc, never()).queryForObject(contains("set_config"), eq(String.class), eq(PLATFORM.toString()));
    }

    @Test
    void emailRoutingToABusinessIsUnchanged() {
        when(jdbc.queryForObject(contains("to_regprocedure"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("login_tenant_for_email"), eq(UUID.class), eq("ravi@acme.test")))
                .thenReturn(business);
        assertEquals(business, auth.resolveLoginTenant("ravi@acme.test"));
        verify(jdbc, never()).queryForList(contains("platform.tenants"), eq(UUID.class));
    }

    // ── business sign-in is unchanged ─────────────────────────────────────────

    @Test
    void aBusinessLoginStillGetsAWorkspaceSessionWithNoPlatformTokenType() {
        LoginResponse out = auth.login(new LoginRequest(business, "ops@unifiedtree.test", "right", null));
        assertNotNull(out.accessToken());
        assertNotNull(out.refreshToken());
        assertEquals(business, out.tenantId());
        Claims c = jwt.parseAndValidate(out.accessToken());
        assertEquals(business.toString(), c.get("tenant_id"));
        assertNull(c.get("token_type"), "a workspace token never carries token_type=platform");
        verify(refreshRepo).save(any());
        verify(creds).save(login);
    }

    @Test
    void aBusinessHandOverStillGetsAWorkspaceSession() {
        LoginResponse out = auth.issueWorkspaceSession(business, userId);
        assertEquals(business, out.tenantId());
        assertEquals(List.of("EMPLOYEE"), out.roles());
    }

    @Test
    void theRuleItself() {
        assertTrue(WorkspaceSignInRule.isPlatformOperator(PLATFORM, List.of()));
        assertTrue(WorkspaceSignInRule.isPlatformOperator(PLATFORM, null));
        assertTrue(WorkspaceSignInRule.isPlatformOperator(business, List.of("EMPLOYEE", "PLATFORM_SUPER_ADMIN")));
        assertFalse(WorkspaceSignInRule.isPlatformOperator(business, List.of("OWNER", "SUPER_ADMIN", "EMPLOYEE")));
        assertFalse(WorkspaceSignInRule.isPlatformOperator(business, null));
        assertFalse(WorkspaceSignInRule.isPlatformOperator(null, List.of()));
    }
}
