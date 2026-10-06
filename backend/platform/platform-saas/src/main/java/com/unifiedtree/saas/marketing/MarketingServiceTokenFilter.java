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

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;

/**
 * Guards {@code /v1/internal/**}: the server-to-server API that Marketing Automation
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
 * The security chain lets {@code /v1/internal/**} through without a JWT; this filter
 * (registered after the chain) is the gate.
 */
@Component
public class MarketingServiceTokenFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-UnifiedTree-Service-Token";
    static final String PREFIX = "/v1/internal/";
    static final int MIN_LENGTH = 32;

    private static final Logger log = LoggerFactory.getLogger(MarketingServiceTokenFilter.class);

    private final byte[] expected;

    public MarketingServiceTokenFilter(@Value("${unifiedtree.marketing.service-token:}") String token) {
        String t = token == null ? "" : token.trim();
        this.expected = t.length() >= MIN_LENGTH ? t.getBytes(StandardCharsets.UTF_8) : null;
        if (this.expected == null) {
            log.warn("UNIFIEDTREE_MARKETING_SERVICE_TOKEN is not set (or shorter than {} characters): "
                    + "every /v1/internal/** request will be refused", MIN_LENGTH);
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !path(request).startsWith(PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (expected == null) {
            deny(response, 503, "SERVICE_TOKEN_NOT_CONFIGURED", "Internal API is not configured on this server");
            return;
        }
        String presented = request.getHeader(HEADER);
        if (presented == null || !MessageDigest.isEqual(expected, presented.trim().getBytes(StandardCharsets.UTF_8))) {
            log.warn("Refused internal API call to {} from {}: bad or missing service token", path(request),
                    request.getRemoteAddr());
            deny(response, 401, "INVALID_SERVICE_TOKEN", "A valid service token is required");
            return;
        }
        chain.doFilter(request, response);
    }

    static String path(HttpServletRequest request) {
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
