package com.unifiedtree.rbac.company;

import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Binds the company each request runs in and checks the caller may access it
 * (docs/redesign/COMPANY_ACCESS.md).
 *
 * <ol>
 *   <li>The companies a request names: the {@code X-Company-Id} header, every
 *       {@code companyId} query parameter, and a {@code /companies/{id}} or
 *       {@code /company/{id}} path segment.</li>
 *   <li>Each must be one the caller may access, else 403 COMPANY_ACCESS_DENIED
 *       (a malformed header is 400 INVALID_COMPANY_ID). For people who reach
 *       every company the header must still name a company of the workspace;
 *       parameters and paths are not checked for them (as before).</li>
 *   <li>The request runs in the path company, else the parameter's, else the
 *       header's. When that is a company the caller reaches through a grant, the
 *       request's authentication is swapped for one carrying their roles and
 *       permissions THERE, so {@code hasAuthority}, {@code hasRole}, the JWT
 *       claims a controller reads, {@code @perm} and {@code /me} all agree.</li>
 *   <li>A request that names no company is untouched: exactly the behaviour
 *       before company access (old app versions send no header).</li>
 * </ol>
 *
 * <p>A servlet filter after Spring Security's chain, like
 * {@code SessionRevocationFilter}: the JWT is parsed and {@code TenantContext}
 * bound by then. {@code /v1/me/companies} and {@code /v1/canonical-auth/*}
 * ignore a header the caller may not use, so a client holding a stale company
 * can always find its way back. {@code unifiedtree.company-access.enforce=false}
 * turns the checks off (kill switch); the context is then never set.
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 90)
public class CompanyAccessFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(CompanyAccessFilter.class);

    public static final String HEADER = "X-Company-Id";
    public static final String PARAM = "companyId";

    private static final Pattern PATH_COMPANY =
            Pattern.compile("/compan(?:y|ies)/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:/|$)");
    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");

    private final CompanyAccessService access;

    public CompanyAccessFilter(CompanyAccessService access) {
        this.access = access;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        Authentication original = SecurityContextHolder.getContext().getAuthentication();
        try {
            if (access.enforced() && !apply(req, res, original)) return;
            chain.doFilter(req, res);
        } finally {
            CompanyContext.clear();
            Authentication now = SecurityContextHolder.getContext().getAuthentication();
            if (now != original && original != null) SecurityContextHolder.getContext().setAuthentication(original);
        }
    }

    /** Returns false when the request was refused (response already written). */
    boolean apply(HttpServletRequest req, HttpServletResponse res, Authentication auth) throws IOException {
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return true;
        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();
        if (tenantId == null || userId == null || PLATFORM_TENANT_ID.equals(tenantId)) return true;

        boolean recovery = isRecoveryPath(req);
        UUID header = null;
        String raw = req.getHeader(HEADER);
        if (raw != null && !raw.isBlank()) {
            try {
                header = UUID.fromString(raw.trim());
            } catch (IllegalArgumentException e) {
                if (!recovery) {
                    refuse(res, 400, "INVALID_COMPANY_ID", "The X-Company-Id header is not a company id.");
                    return false;
                }
            }
        }
        UUID pathCompany = pathCompany(req);
        Set<UUID> params = paramCompanies(req);
        if (header == null && pathCompany == null && params.isEmpty()) return true;  // names no company: as before

        Profile profile = access.profile(userId);
        if (header != null) {
            boolean ok = profile.allCompanies() ? access.companyExists(header) : profile.canAccess(header);
            if (!ok) {
                if (!recovery) {
                    deny(res, userId, header);
                    return false;
                }
                header = null;
            }
        }
        if (!profile.allCompanies()) {
            if (pathCompany != null && !profile.canAccess(pathCompany)) {
                deny(res, userId, pathCompany);
                return false;
            }
            for (UUID c : params) {
                if (!profile.canAccess(c)) {
                    deny(res, userId, c);
                    return false;
                }
            }
        }

        // The current company is the one the client selected (the header); the
        // permissions follow the company the request is about.
        CompanyContext.setCompanyId(header);
        UUID subject = pathCompany != null ? pathCompany
                : !params.isEmpty() ? params.iterator().next()
                : header;
        CompanyContext.Scope scope = subject == null ? null : access.scope(profile, subject);
        if (scope != null) {
            CompanyContext.setScope(scope);
            SecurityContextHolder.getContext().setAuthentication(scoped(jwt, auth, scope));
        }
        return true;
    }

    /** The same token, carrying the caller's roles and permissions in the scoped company. */
    static JwtAuthenticationToken scoped(Jwt jwt, Authentication original, CompanyContext.Scope scope) {
        List<String> perms = scope.permissions().stream().sorted().toList();
        Jwt companyJwt = Jwt.withTokenValue(jwt.getTokenValue())
                .headers(h -> h.putAll(jwt.getHeaders()))
                .claims(c -> {
                    c.putAll(jwt.getClaims());
                    c.put("roles", scope.roleCodes());
                    c.put("permissions", perms);
                    c.put("company_id", scope.companyId().toString());
                })
                .build();
        List<GrantedAuthority> authorities = new ArrayList<>();
        for (String r : scope.roleCodes()) authorities.add(new SimpleGrantedAuthority("ROLE_" + r));
        for (String p : perms) authorities.add(new SimpleGrantedAuthority(p));
        return new JwtAuthenticationToken(companyJwt, authorities, original.getName());
    }

    private static UUID pathCompany(HttpServletRequest req) {
        Matcher m = PATH_COMPANY.matcher(req.getRequestURI());
        return m.find() ? UUID.fromString(m.group(1)) : null;
    }

    /**
     * Valid UUID values of the companyId query parameter (others are left for
     * Spring to reject). Read from the query string itself, never through
     * getParameter, which would consume a form or multipart body.
     */
    static Set<UUID> paramCompanies(HttpServletRequest req) {
        Set<UUID> out = new LinkedHashSet<>();
        String query = req.getQueryString();
        if (query == null || !query.contains(PARAM)) return out;
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            try {  // a malformed %-escape or a non-UUID value: not ours to judge
                if (!PARAM.equals(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8))) continue;
                String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8).trim();
                if (!value.isEmpty()) out.add(UUID.fromString(value));
            } catch (IllegalArgumentException ignored) { }
        }
        return out;
    }

    private static boolean isRecoveryPath(HttpServletRequest req) {
        String path = req.getRequestURI().substring(req.getContextPath().length());
        return path.startsWith("/v1/me/companies") || path.startsWith("/v1/canonical-auth/");
    }

    private void deny(HttpServletResponse res, UUID userId, UUID companyId) throws IOException {
        log.info("COMPANY_ACCESS_DENIED user={} company={}", userId, companyId);
        refuse(res, 403, "COMPANY_ACCESS_DENIED", "You don't have access to this company.");
    }

    private static void refuse(HttpServletResponse res, int status, String code, String message) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json");
        res.setCharacterEncoding(StandardCharsets.UTF_8.name());
        res.getWriter().write("{\"timestamp\":\"" + Instant.now() + "\",\"status\":" + status
                + ",\"errorCode\":\"" + code + "\",\"message\":\"" + message + "\"}");
    }
}
