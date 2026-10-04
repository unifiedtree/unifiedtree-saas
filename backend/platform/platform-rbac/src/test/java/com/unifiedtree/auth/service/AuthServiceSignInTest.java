package com.unifiedtree.auth.service;

import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.entity.RefreshToken;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.mfa.MfaChallengeTokens;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.repository.RbacRefreshTokenRepository;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.auth.session.SessionDevice;
import com.unifiedtree.auth.session.SignedInEvent;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * A sign-in tells the audit log (SignedInEvent), and a browser session lives
 * as long as the browser's refresh cookie, not the app's 90 days.
 */
class AuthServiceSignInTest {

    private static final String CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
    private static final String APP = "okhttp/4.12.0";

    private final UUID tenant = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UserCredentialsRepository creds = mock(UserCredentialsRepository.class);
    private final RbacRefreshTokenRepository refresh = mock(RbacRefreshTokenRepository.class);
    private final UserRoleRepository userRoles = mock(UserRoleRepository.class);
    private final PasswordService passwords = mock(PasswordService.class);
    private final MfaService mfa = mock(MfaService.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    // Production's 90-day refresh life.
    private final JwtService jwt = new JwtService("0123456789abcdef0123456789abcdef-test-key", "unifiedtree", 720, 90);
    private AuthService auth;

    @BeforeEach
    void setUp() {
        auth = new AuthService(creds, refresh, userRoles, mock(RoleRepository.class), mock(RolePermissionRepository.class),
                passwords, jwt, mock(JdbcTemplate.class), mock(EmployeeBaselinePermissions.class), mfa, new MfaChallengeTokens(jwt));
        auth.setEvents(events);
        UserCredentials c = new UserCredentials();
        c.setId(userId);
        c.setTenantId(tenant);
        c.setEmail("asha@acme.in");
        c.setPasswordHash("hash");
        when(creds.findByEmailForSession("asha@acme.in")).thenReturn(Optional.of(c));
        when(passwords.matches("right", "hash")).thenReturn(true);
        when(userRoles.findAllByUserId(userId)).thenReturn(List.of());
        when(mfa.requirementFor(any(), any(), any())).thenReturn(MfaService.Requirement.NONE);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
        RequestContextHolder.resetRequestAttributes();
    }

    private void from(String userAgent) {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("User-Agent", userAgent);
        req.addHeader("X-Forwarded-For", "203.0.113.7, 10.0.0.1");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));
    }

    private RefreshToken savedToken() {
        ArgumentCaptor<RefreshToken> rt = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refresh).save(rt.capture());
        return rt.getValue();
    }

    @Test
    void aPasswordSignInPublishesWhoSignedInAndFromWhere() {
        from(CHROME);
        auth.login(new LoginRequest(tenant, "asha@acme.in", "right"));

        ArgumentCaptor<Object> e = ArgumentCaptor.forClass(Object.class);
        verify(events).publishEvent(e.capture());
        SignedInEvent signedIn = assertInstanceOf(SignedInEvent.class, e.getValue());
        assertEquals(tenant, signedIn.tenantId());
        assertEquals(userId, signedIn.userId());
        assertEquals("asha@acme.in", signedIn.email());
        assertEquals("203.0.113.7", signedIn.ipAddress());
        assertEquals(CHROME, signedIn.userAgent());
        assertEquals(savedToken().getSessionId(), signedIn.sessionId());
    }

    @Test
    void aWrongPasswordPublishesNothing() {
        from(CHROME);
        assertThrows(RuntimeException.class, () -> auth.login(new LoginRequest(tenant, "asha@acme.in", "wrong")));
        verifyNoInteractions(events);
    }

    @Test
    void aBrowserSessionLastsAsLongAsItsCookie() {
        from(CHROME);
        auth.login(new LoginRequest(tenant, "asha@acme.in", "right"));
        RefreshToken rt = savedToken();
        assertEquals(SessionDevice.BROWSER_SESSION_TTL, Duration.between(rt.getIssuedAt(), rt.getExpiresAt()));
    }

    @Test
    void theAppKeepsTheFullSessionLife() {
        from(APP);
        auth.login(new LoginRequest(tenant, "asha@acme.in", "right"));
        RefreshToken rt = savedToken();
        assertEquals(Duration.ofDays(90), Duration.between(rt.getIssuedAt(), rt.getExpiresAt()));
    }

    @Test
    void theBrowserCapNeverLengthensAShorterLife() {
        assertEquals(Duration.ofDays(3), AuthService.sessionTtl(Duration.ofDays(3), CHROME));
        assertEquals(Duration.ofDays(7), AuthService.sessionTtl(Duration.ofDays(90), CHROME));
        assertEquals(Duration.ofDays(90), AuthService.sessionTtl(Duration.ofDays(90), APP));
        assertEquals(Duration.ofDays(90), AuthService.sessionTtl(Duration.ofDays(90), null));
    }

    @Test
    void aRefreshContinuesTheSessionAndIsNotASignIn() {
        from(CHROME);
        RefreshToken old = new RefreshToken();
        old.setUserId(userId);
        old.setSessionId(UUID.randomUUID());
        old.setIssuedAt(OffsetDateTime.now().minusHours(1));
        old.setExpiresAt(OffsetDateTime.now().plusDays(1));
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class)).thenReturn(List.of(tenant));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class))).thenReturn(false);
        auth = new AuthService(creds, refresh, userRoles, mock(RoleRepository.class), mock(RolePermissionRepository.class),
                passwords, jwt, jdbc, mock(EmployeeBaselinePermissions.class), mfa, new MfaChallengeTokens(jwt));
        auth.setEvents(events);
        when(refresh.findByTokenHash(any())).thenReturn(Optional.of(old));
        UserCredentials c = new UserCredentials();
        c.setId(userId);
        c.setTenantId(tenant);
        c.setEmail("asha@acme.in");
        when(creds.findByIdForSession(userId)).thenReturn(Optional.of(c));

        auth.refresh("some-refresh-token");

        verify(refresh).save(any(RefreshToken.class));
        verifyNoInteractions(events);
    }
}
