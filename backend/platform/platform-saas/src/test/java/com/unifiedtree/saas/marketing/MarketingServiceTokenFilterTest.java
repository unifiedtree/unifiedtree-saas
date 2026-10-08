package com.unifiedtree.saas.marketing;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

/** The gate in front of /v1/internal/marketing/**: fails closed, constant-time token check, decoded path. */
class MarketingServiceTokenFilterTest {

    static final String TOKEN = "s3rv1ce-t0ken-for-tests-0123456789abcdef";

    record Outcome(int status, boolean passed, String body) {}

    static Outcome call(String configured, String path, String presented) throws Exception {
        MarketingServiceTokenFilter filter = new MarketingServiceTokenFilter(configured);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api" + path);
        req.setContextPath("/api");
        if (presented != null) req.addHeader(MarketingServiceTokenFilter.HEADER, presented);
        MockHttpServletResponse res = new MockHttpServletResponse();
        AtomicBoolean passed = new AtomicBoolean(false);
        FilterChain chain = (rq, rs) -> passed.set(true);
        filter.doFilter(req, res, chain);
        return new Outcome(res.getStatus(), passed.get(), res.getContentAsString());
    }

    @Test
    void theRightTokenPasses() throws Exception {
        Outcome o = call(TOKEN, "/v1/internal/marketing/access", TOKEN);
        assertThat(o.passed()).isTrue();
    }

    @Test
    void aMissingTokenIsRefused() throws Exception {
        Outcome o = call(TOKEN, "/v1/internal/marketing/access", null);
        assertThat(o.passed()).isFalse();
        assertThat(o.status()).isEqualTo(401);
        assertThat(o.body()).contains("INVALID_SERVICE_TOKEN");
        assertThat(o.body()).contains("\"code\":\"SERVICE_TOKEN_REJECTED\"")
                .contains("\"message\":\"A valid service token is required\"");
    }

    @Test
    void aWrongTokenIsRefused() throws Exception {
        Outcome o = call(TOKEN, "/v1/internal/marketing/access", "wrong-token-that-must-not-be-echoed-0123456789");
        assertThat(o.passed()).isFalse();
        assertThat(o.status()).isEqualTo(401);
        assertThat(o.body()).contains("\"code\":\"SERVICE_TOKEN_REJECTED\"").doesNotContain("wrong-token");
    }

    @Test
    void failsClosedWhenNoTokenIsConfigured() throws Exception {
        Outcome o = call("", "/v1/internal/marketing/access", "anything-at-all-anything-at-all-123");
        assertThat(o.passed()).isFalse();
        assertThat(o.status()).isEqualTo(503);
        assertThat(o.body()).contains("SERVICE_TOKEN_NOT_CONFIGURED");
        assertThat(o.body()).contains("\"code\":\"SERVICE_TOKEN_REJECTED\"").doesNotContain("anything-at-all");
    }

    @Test
    void aTooShortConfiguredTokenCountsAsNotConfigured() throws Exception {
        Outcome o = call("short", "/v1/internal/marketing/access", "short");
        assertThat(o.passed()).isFalse();
        assertThat(o.status()).isEqualTo(503);
    }

    @Test
    void anEncodedPathCannotSkipTheCheck() throws Exception {
        // Routing decodes %72 to 'r' — the filter must decide on the same path (regression: this used to pass)
        for (String path : new String[] {"/v1/inte%72nal/marketing/principals", "/v1/%69nternal/marketing/access",
                                         "/v1/internal/%6Darketing/usage", "/v1/internal/marketing;x=1/access"}) {
            Outcome o = call(TOKEN, path, null);
            assertThat(o.passed()).as(path).isFalse();
            assertThat(o.status()).as(path).isEqualTo(401);
        }
    }

    @Test
    void theSecurityChainRuleUsesTheSameTokenCheck() {
        MarketingServiceTokenFilter filter = new MarketingServiceTokenFilter(TOKEN);
        MockHttpServletRequest withToken = new MockHttpServletRequest("GET", "/api/v1/internal/marketing/access");
        withToken.addHeader(MarketingServiceTokenFilter.HEADER, TOKEN);
        MockHttpServletRequest without = new MockHttpServletRequest("GET", "/api/v1/internal/marketing/access");
        assertThat(filter.hasValidToken(withToken)).isTrue();
        assertThat(filter.hasValidToken(without)).isFalse();
        assertThat(new MarketingServiceTokenFilter("").hasValidToken(withToken)).isFalse();
    }

    @Test
    void otherPathsAreNotTouched() throws Exception {
        Outcome o = call("", "/v1/platform/admin/workspaces", null);
        assertThat(o.passed()).isTrue();
    }

    // ── The security chain's refusals (it refuses before the filter runs) ──

    /** Stands in for Spring's default: a status and a header, no body */
    static final AuthenticationEntryPoint DEFAULT_ENTRY = (rq, rs, e) -> {
        rs.addHeader("WWW-Authenticate", "Bearer");
        rs.setStatus(401);
    };
    static final AccessDeniedHandler DEFAULT_DENIED = (rq, rs, e) -> {
        rs.addHeader("WWW-Authenticate", "Bearer error=\"insufficient_scope\"");
        rs.setStatus(403);
    };

    static MockHttpServletRequest request(String path, String presented) {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api" + path);
        req.setContextPath("/api");
        if (presented != null) req.addHeader(MarketingServiceTokenFilter.HEADER, presented);
        return req;
    }

    @Test
    void theChainsRefusalOfTheInternalApiGetsTheJsonBodyAndKeepsItsStatusAndHeaders() throws Exception {
        AuthenticationEntryPoint entry = new MarketingServiceTokenFilter(TOKEN).entryPoint(DEFAULT_ENTRY);
        for (String path : new String[] {"/v1/internal/marketing/sso/redeem", "/v1/inte%72nal/marketing/access"}) {
            MockHttpServletResponse res = new MockHttpServletResponse();
            entry.commence(request(path, "presented-token-must-not-be-echoed-0123456789"), res,
                    new InsufficientAuthenticationException("Full authentication is required"));
            assertThat(res.getStatus()).as(path).isEqualTo(401);
            assertThat(res.getHeader("WWW-Authenticate")).as(path).isEqualTo("Bearer");
            assertThat(res.getContentType()).as(path).startsWith("application/json");
            assertThat(res.getContentAsString()).as(path)
                    .contains("\"status\":401", "\"errorCode\":\"INVALID_SERVICE_TOKEN\"",
                            "\"message\":\"A valid service token is required\"", "\"code\":\"SERVICE_TOKEN_REJECTED\"")
                    .doesNotContain("presented-token");
        }
    }

    @Test
    void whenNoTokenIsConfiguredTheChainsRefusalIsTheSame() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        new MarketingServiceTokenFilter("").entryPoint(DEFAULT_ENTRY).commence(request("/v1/internal/marketing/access",
                null), res, new InsufficientAuthenticationException("Full authentication is required"));
        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getContentAsString()).contains("\"code\":\"SERVICE_TOKEN_REJECTED\"");
    }

    @Test
    void aSignedInUserWithoutTheServiceTokenGetsTheBodyWithTheUsual403() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        new MarketingServiceTokenFilter(TOKEN).accessDeniedHandler(DEFAULT_DENIED).handle(
                request("/v1/internal/marketing/access", null), res, new AccessDeniedException("Access Denied"));
        assertThat(res.getStatus()).isEqualTo(403);
        assertThat(res.getHeader("WWW-Authenticate")).startsWith("Bearer");
        assertThat(res.getContentAsString()).contains("\"status\":403", "\"code\":\"SERVICE_TOKEN_REJECTED\"");
    }

    @Test
    void theChainsRefusalOfAnyOtherPathIsUnchanged() throws Exception {
        MarketingServiceTokenFilter filter = new MarketingServiceTokenFilter(TOKEN);
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.entryPoint(DEFAULT_ENTRY).commence(request("/v1/hrms/employees", null), res,
                new InsufficientAuthenticationException("Full authentication is required"));
        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getContentAsString()).isEmpty();
        MockHttpServletResponse denied = new MockHttpServletResponse();
        filter.accessDeniedHandler(DEFAULT_DENIED).handle(request("/v1/platform/admin/workspaces", null), denied,
                new AccessDeniedException("Access Denied"));
        assertThat(denied.getStatus()).isEqualTo(403);
        assertThat(denied.getContentAsString()).isEmpty();
    }

    @Test
    void aResponseTheDefaultAlreadySentIsLeftAlone() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        new MarketingServiceTokenFilter(TOKEN).accessDeniedHandler((rq, rs, e) -> rs.sendError(403)).handle(
                request("/v1/internal/marketing/access", null), res, new AccessDeniedException("Access Denied"));
        assertThat(res.getStatus()).isEqualTo(403);
        assertThat(res.getContentAsString()).doesNotContain("SERVICE_TOKEN_REJECTED");
    }
}
