package com.unifiedtree.auth.session;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class SessionRevocationFilterTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID sid = UUID.randomUUID();

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private void signIn(boolean withSid) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "HS256").subject(UUID.randomUUID().toString())
                .claim("tenant_id", tenant.toString()).issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60));
        if (withSid) b.claim("sid", sid.toString());
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(b.build()));
    }

    private MockHttpServletResponse run(SessionService sessions, String uri, MockFilterChain chain) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", uri);
        req.setRequestURI(uri);
        MockHttpServletResponse res = new MockHttpServletResponse();
        new SessionRevocationFilter(sessions).doFilter(req, res, chain);
        return res;
    }

    @Test
    void refusesASignedOutSession() throws Exception {
        SessionService sessions = mock(SessionService.class);
        when(sessions.isActive(tenant, sid)).thenReturn(false);
        signIn(true);
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse res = run(sessions, "/api/v1/hrms/employees", chain);
        assertEquals(401, res.getStatus());
        assertTrue(res.getContentAsString().contains("SESSION_SIGNED_OUT"));
        assertNull(chain.getRequest(), "the request must not reach the controller");
    }

    @Test
    void letsALiveSessionThrough() throws Exception {
        SessionService sessions = mock(SessionService.class);
        when(sessions.isActive(tenant, sid)).thenReturn(true);
        signIn(true);
        MockFilterChain chain = new MockFilterChain();
        assertEquals(200, run(sessions, "/api/v1/canonical-auth/me", chain).getStatus());
        assertNotNull(chain.getRequest());
    }

    @Test
    void neverChecksSignInRefreshOrSignOut() throws Exception {
        SessionService sessions = mock(SessionService.class);
        signIn(true);
        for (String uri : new String[]{"/api/v1/canonical-auth/login", "/api/v1/canonical-auth/login/mfa", "/api/v1/canonical-auth/refresh", "/api/v1/canonical-auth/logout"}) {
            MockFilterChain chain = new MockFilterChain();
            run(sessions, uri, chain);
            assertNotNull(chain.getRequest(), uri);
        }
        verify(sessions, never()).isActive(any(), any());
        assertTrue(SessionRevocationFilter.isSignInPath("/api/v1/canonical-auth/login/mfa/setup"));
        assertFalse(SessionRevocationFilter.isSignInPath("/api/v1/canonical-auth/me"));
    }

    @Test
    void tokensWithoutASessionIdAreUnchanged() throws Exception {
        SessionService sessions = mock(SessionService.class);
        signIn(false);
        MockFilterChain chain = new MockFilterChain();
        run(sessions, "/api/v1/hrms/employees", chain);
        assertNotNull(chain.getRequest());
        verify(sessions, never()).isActive(any(), any());
    }
}
