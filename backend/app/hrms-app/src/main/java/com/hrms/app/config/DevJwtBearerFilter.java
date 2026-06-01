package com.hrms.app.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Dev-only (canonical profile, not canonical-prod) filter that parses a Bearer
 * JWT and sets a {@link JwtAuthenticationToken} in the {@link SecurityContextHolder}
 * so {@code @AuthenticationPrincipal Jwt} works in controllers.
 *
 * <p>If the token is absent or invalid the filter silently continues the chain
 * without authentication. {@code anyRequest().permitAll()} in
 * {@link CanonicalSecurityConfig} guarantees the request is never rejected.
 */
public class DevJwtBearerFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(DevJwtBearerFilter.class);

    private final JwtDecoder decoder;

    public DevJwtBearerFilter(JwtDecoder decoder) {
        this.decoder = decoder;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            try {
                Jwt jwt = decoder.decode(token);
                JwtAuthenticationToken auth = new JwtAuthenticationToken(jwt, extractAuthorities(jwt));
                auth.setAuthenticated(true);
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (RuntimeException ex) {
                log.debug("[DevJwtBearerFilter] Skipping unparseable Bearer token (dev mode): {}", ex.getMessage());
            }
        }
        filterChain.doFilter(request, response);
    }

    private List<GrantedAuthority> extractAuthorities(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        Object roles = jwt.getClaim("roles");
        if (roles instanceof List<?> list) {
            for (Object r : list) {
                if (r != null) authorities.add(new SimpleGrantedAuthority("ROLE_" + r));
            }
        }
        Object perms = jwt.getClaim("permissions");
        if (perms instanceof List<?> list) {
            for (Object p : list) {
                if (p != null) authorities.add(new SimpleGrantedAuthority(p.toString()));
            }
        }
        return authorities;
    }
}
