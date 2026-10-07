package com.unifiedtree.saas.marketing;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

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
    }

    @Test
    void aWrongTokenIsRefused() throws Exception {
        Outcome o = call(TOKEN, "/v1/internal/marketing/access", TOKEN + "x");
        assertThat(o.passed()).isFalse();
        assertThat(o.status()).isEqualTo(401);
    }

    @Test
    void failsClosedWhenNoTokenIsConfigured() throws Exception {
        Outcome o = call("", "/v1/internal/marketing/access", "anything-at-all-anything-at-all-123");
        assertThat(o.passed()).isFalse();
        assertThat(o.status()).isEqualTo(503);
        assertThat(o.body()).contains("SERVICE_TOKEN_NOT_CONFIGURED");
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
}
