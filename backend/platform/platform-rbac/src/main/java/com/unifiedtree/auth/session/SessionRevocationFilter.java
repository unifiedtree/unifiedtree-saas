package com.unifiedtree.auth.session;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Refuses requests made with the access token of a session that was signed
 * out (Settings -> Security -> Active sessions). Without this, signing a lost
 * laptop out would only stop its next token refresh, and its current access
 * token would keep working for up to 12 hours.
 *
 * <p>Runs as a plain servlet filter after Spring Security (which has already
 * parsed the Bearer token and bound the tenant). Tokens without a {@code sid}
 * claim (issued before V143.26, or account-portal tokens) are let through
 * unchanged. The sign-in endpoints themselves are never checked.
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 100)
public class SessionRevocationFilter extends OncePerRequestFilter {

    private final SessionService sessions;

    public SessionRevocationFilter(SessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt && !req.getRequestURI().contains("/v1/canonical-auth/")) {
            UUID sid = uuid(jwt.getClaimAsString("sid"));
            UUID tenantId = uuid(jwt.getClaimAsString("tenant_id"));
            if (sid != null && tenantId != null && !sessions.isActive(tenantId, sid)) {
                res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                res.setContentType("application/json");
                res.setCharacterEncoding(StandardCharsets.UTF_8.name());
                res.getWriter().write("{\"status\":401,\"errorCode\":\"SESSION_SIGNED_OUT\","
                        + "\"message\":\"This session was signed out. Please sign in again.\"}");
                return;
            }
        }
        chain.doFilter(req, res);
    }

    private static UUID uuid(String s) {
        if (s == null || s.isBlank()) return null;
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { return null; }
    }
}
