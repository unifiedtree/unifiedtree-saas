package com.unifiedtree.saas.marketing;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UrlPathHelper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;

/**
 * Guards {@code /v1/internal/marketing/**}: the server-to-server API that Marketing Automation
 * (Node) calls for platform decisions — redeem an SSO ticket, check a company's
 * access and entitlement, record identity mappings, audit and usage.
 *
 * <p>The caller presents a shared service token in {@value #HEADER}. Not in
 * {@code Authorization: Bearer}: the JWT resource server would try to parse it as a
 * user token and refuse the request before this filter runs.
 *
 * <p>Fails closed: if {@code unifiedtree.marketing.service-token}
 * ({@code UNIFIEDTREE_MARKETING_SERVICE_TOKEN}) is unset or shorter than 32
 * characters, every internal request is refused with 503. Compared in constant time.
 *
 * <p>Two layers, both on the DECODED path (the one Spring Security and Spring MVC route on):
 * the security chain requires {@link #hasValidToken} for {@code /v1/internal/marketing/**},
 * and this filter (registered after the chain) answers the precise 401/503. Deciding on the
 * raw request URI alone let {@code /v1/inte%72nal/...} skip the check while still routing to
 * the controller.
 */
@Component
public class MarketingServiceTokenFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-UnifiedTree-Service-Token";
    static final String PREFIX = "/v1/internal/marketing/";
    static final int MIN_LENGTH = 32;

    private static final Logger log = LoggerFactory.getLogger(MarketingServiceTokenFilter.class);
    /** Decodes %-escapes and drops ;path-parameters, like request routing does */
    private static final UrlPathHelper PATHS = new UrlPathHelper();

    private final byte[] expected;

    public MarketingServiceTokenFilter(@Value("${unifiedtree.marketing.service-token:}") String token) {
        String t = token == null ? "" : token.trim();
        this.expected = t.length() >= MIN_LENGTH ? t.getBytes(StandardCharsets.UTF_8) : null;
        if (this.expected == null) {
            log.warn("UNIFIEDTREE_MARKETING_SERVICE_TOKEN is not set (or shorter than {} characters): "
                    + "every /v1/internal/marketing/** request will be refused", MIN_LENGTH);
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // Internal when either the decoded or the raw path is under the prefix
        return !path(request).startsWith(PREFIX) && !rawPath(request).startsWith(PREFIX);
    }

    /** Whether the request carries the configured service token. Also the security chain's rule for the prefix. */
    public boolean hasValidToken(HttpServletRequest request) {
        if (expected == null) return false;
        String presented = request.getHeader(HEADER);
        return presented != null && MessageDigest.isEqual(expected, presented.trim().getBytes(StandardCharsets.UTF_8));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (expected == null) {
            deny(response, 503, "SERVICE_TOKEN_NOT_CONFIGURED", "Internal API is not configured on this server");
            return;
        }
        if (!hasValidToken(request)) {
            log.warn("Refused internal API call to {} from {}: bad or missing service token", path(request),
                    request.getRemoteAddr());
            deny(response, 401, "INVALID_SERVICE_TOKEN", "A valid service token is required");
            return;
        }
        chain.doFilter(request, response);
    }

    /** The decoded path within the application (context path removed): what routing and the security chain see */
    static String path(HttpServletRequest request) {
        return PATHS.getPathWithinApplication(request);
    }

    static String rawPath(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        return ctx != null && !ctx.isEmpty() && uri.startsWith(ctx) ? uri.substring(ctx.length()) : uri;
    }

    private static void deny(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"timestamp\":\"" + Instant.now() + "\",\"status\":" + status
                + ",\"errorCode\":\"" + code + "\",\"message\":\"" + message + "\"}");
    }
}
