package com.hrms.api.attendance;

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

/**
 * A face station's sign-in (V143.95, {@code token_type=station}) may only punch:
 * every request it makes outside {@code /v1/attendance/station/} is refused here
 * with 403, before any controller runs. So a station can never read other HRMS
 * data, whatever an endpoint's own checks are (some only ask for a signed-in
 * caller). People's sign-ins pass through untouched.
 *
 * <p>Runs as a plain servlet filter after Spring Security, which has already
 * parsed the Bearer token (like SessionRevocationFilter).
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 90)
public class StationScopeFilter extends OncePerRequestFilter {

    static final String STATION_PREFIX = "/v1/attendance/station/";

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt && FaceStationService.isStationToken(jwt)
                && !allowed(pathOf(req))) {
            res.setStatus(HttpServletResponse.SC_FORBIDDEN);
            res.setContentType("application/json");
            res.setCharacterEncoding(StandardCharsets.UTF_8.name());
            res.getWriter().write("{\"status\":403,\"errorCode\":\"STATION_ONLY_PUNCHES\","
                    + "\"message\":\"A face station can only punch people in and out.\"}");
            return;
        }
        chain.doFilter(req, res);
    }

    /** The request path without the context path. */
    static String pathOf(HttpServletRequest req) {
        String uri = req.getRequestURI() == null ? "" : req.getRequestURI();
        String ctx = req.getContextPath() == null ? "" : req.getContextPath();
        return !ctx.isEmpty() && uri.startsWith(ctx) ? uri.substring(ctx.length()) : uri;
    }

    /** Only the station endpoints, and nothing that tries to step out of them. */
    static boolean allowed(String path) {
        if (path == null || !path.startsWith(STATION_PREFIX)) return false;
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        return !lower.contains("..") && !lower.contains("%2e") && !lower.contains("%2f") && !lower.contains(";")
                && !lower.contains("\\") && !lower.contains("//");
    }
}
