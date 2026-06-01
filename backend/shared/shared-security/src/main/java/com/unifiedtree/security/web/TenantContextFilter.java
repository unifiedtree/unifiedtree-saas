package com.unifiedtree.security.web;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Reads tenant identity from the authenticated principal and binds it to the
 * current thread for the duration of the request.
 *
 * <p>Resolution order:
 * <ol>
 *   <li>JWT claim {@code tenant_id} from a signed Bearer token (production).</li>
 *   <li>{@code X-Tenant-ID} HTTP header (DEV/SMOKE ONLY -- gated by
 *       {@code unifiedtree.security.allow-tenant-header} property,
 *       default false). Refused in production because anyone can set it.</li>
 *   <li>Otherwise unset -- RLS returns zero rows (fail-closed).</li>
 * </ol>
 */
@Component
@Order(50)
public class TenantContextFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(TenantContextFilter.class);

    private static final String TENANT_HEADER = "X-Tenant-ID";
    private static final String TENANT_CLAIM  = "tenant_id";
    private static final String USER_CLAIM    = "sub";

    /** Set to {@code true} only in the {@code canonical} smoke-test profile. */
    private final boolean allowTenantHeader;

    public TenantContextFilter(
            @Value("${unifiedtree.security.allow-tenant-header:false}") boolean allowTenantHeader) {
        this.allowTenantHeader = allowTenantHeader;
        if (allowTenantHeader) {
            log.warn("X-Tenant-ID header fallback is ENABLED. This must be false in production.");
        }
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req,
                                    HttpServletResponse res,
                                    FilterChain chain)
            throws ServletException, IOException {
        UUID tenantId = resolveTenantId(req);
        UUID userId   = resolveUserId();
        if (log.isDebugEnabled()) {
            log.debug("[TenantFilter] {} {} -> tenant={} user={}",
                      req.getMethod(), req.getRequestURI(), tenantId, userId);
        }
        try {
            if (tenantId != null) {
                TenantContext.setTenantId(tenantId);
                // BaseEntity.@PrePersist reads the legacy hrms-core ThreadLocal;
                // mirror so the JPA insert path sees the same tenant.
                com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
            }
            if (userId != null) TenantContext.setUserId(userId);
            chain.doFilter(req, res);
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    private UUID resolveTenantId(HttpServletRequest req) {
        // 1. Signed JWT claim is the only trusted source in production.
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
            String claim = jwt.getClaimAsString(TENANT_CLAIM);
            if (claim != null && !claim.isBlank()) {
                try { return UUID.fromString(claim); } catch (IllegalArgumentException ignored) { }
            }
        }
        // 2. Dev/smoke fallback -- explicit opt-in via property.
        if (allowTenantHeader) {
            String header = req.getHeader(TENANT_HEADER);
            if (header != null && !header.isBlank()) {
                try { return UUID.fromString(header); } catch (IllegalArgumentException ignored) { }
            }
        }
        return null;
    }

    private UUID resolveUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
            String sub = jwt.getClaimAsString(USER_CLAIM);
            if (sub != null && !sub.isBlank()) {
                try { return UUID.fromString(sub); } catch (IllegalArgumentException ignored) { }
            }
        }
        return null;
    }
}
