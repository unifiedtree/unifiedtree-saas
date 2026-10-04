package com.hrms.api.auth.canonical;

import com.unifiedtree.auth.mfa.MfaChallengeTokens;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * The browser's boot-time refresh on a tab that isn't signed in is the normal
 * signed-out case: 204 with no session, not a 4xx that shows as a failed
 * request in every visitor's console. A token that was presented and is dead
 * still fails.
 */
class CanonicalRefreshNoSessionTest {

    private final UUID tenant = UUID.randomUUID();
    private final AuthService auth = mock(AuthService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final CanonicalAuthController controller = new CanonicalAuthController(
            auth, jdbc, mock(LoginRateLimiter.class), mock(MfaService.class), mock(MfaChallengeTokens.class));

    @AfterEach
    void clear() {
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private MockHttpServletRequest onWorkspaceTab() {
        when(jdbc.queryForObject(any(String.class), eq(UUID.class), eq("demo-hrms"))).thenReturn(tenant);
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/v1/canonical-auth/refresh");
        req.addHeader("X-Tenant-Subdomain", "demo-hrms");
        req.setContentType("application/json");
        req.setContent("{}".getBytes());
        return req;
    }

    @Test
    void noCookieAndNoTokenAnswersNoContent() {
        MockHttpServletResponse res = new MockHttpServletResponse();
        var out = controller.refresh(onWorkspaceTab(), res);
        assertEquals(HttpStatus.NO_CONTENT, out.getStatusCode());
        assertNull(out.getBody());
        verifyNoInteractions(auth);
        assertNull(res.getHeader("Set-Cookie"), "nothing to set or clear");
    }

    @Test
    void anotherWorkspacesCookieIsStillNeverUsed() {
        MockHttpServletRequest req = onWorkspaceTab();
        req.setCookies(new Cookie("ut_rt_" + UUID.randomUUID().toString().replace("-", ""), "someone-elses-token"));
        var out = controller.refresh(req, new MockHttpServletResponse());
        assertEquals(HttpStatus.NO_CONTENT, out.getStatusCode());
        verifyNoInteractions(auth);
    }

    @Test
    void aDeadCookieStillFailsAndIsDropped() {
        MockHttpServletRequest req = onWorkspaceTab();
        req.setCookies(new Cookie("ut_rt_" + tenant.toString().replace("-", ""), "expired-token"));
        when(auth.refresh("expired-token")).thenThrow(new com.hrms.core.exception.BusinessRuleException("Session expired", "REFRESH_EXPIRED"));
        MockHttpServletResponse res = new MockHttpServletResponse();
        assertThrows(com.hrms.core.exception.BusinessRuleException.class, () -> controller.refresh(req, res));
        assertTrue(res.getHeader("Set-Cookie").contains("Max-Age=0"));
    }

    @Test
    void aGoodCookieRestoresTheSession() {
        MockHttpServletRequest req = onWorkspaceTab();
        req.setCookies(new Cookie("ut_rt_" + tenant.toString().replace("-", ""), "good-token"));
        var session = new com.unifiedtree.auth.dto.AuthDtos.LoginResponse("access", "next-refresh", java.time.Instant.now(),
                UUID.randomUUID(), null, tenant, "asha@acme.in", "Asha", "Rao", java.util.List.of(), java.util.List.of());
        when(auth.refresh("good-token")).thenReturn(session);
        MockHttpServletResponse res = new MockHttpServletResponse();
        var out = controller.refresh(req, res);
        assertEquals(HttpStatus.OK, out.getStatusCode());
        assertSame(session, out.getBody());
        assertTrue(res.getHeader("Set-Cookie").contains("next-refresh"));
        assertTrue(res.getHeader("Set-Cookie").contains("Max-Age=604800"), "a browser session's cookie lives 7 days");
    }
}
