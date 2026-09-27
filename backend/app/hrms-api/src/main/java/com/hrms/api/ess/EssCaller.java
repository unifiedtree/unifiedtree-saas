package com.hrms.api.ess;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Who is asking, for the self-service Home reads: their workspace, their
 * employee record (null when the login has none) and their permissions, all
 * from the token, plus "today" in IST. Every source reads the caller's own
 * rows only, so identity never comes from a request parameter.
 */
public record EssCaller(UUID tenantId, UUID employeeId, Set<String> perms, Jwt jwt, LocalDate today) {

    public boolean has(String permission) {
        return perms.contains(permission);
    }

    public boolean hasAny(String... permissions) {
        for (String p : permissions) if (perms.contains(p)) return true;
        return false;
    }

    public boolean hasEmployee() {
        return employeeId != null;
    }

    /**
     * The caller behind a request. The employee id comes only from the
     * {@code employee_id} claim: a login without an employee record has no
     * requests, tasks or team of its own.
     */
    public static EssCaller of(Jwt jwt, Authentication auth, UUID tenantId, LocalDate today) {
        return new EssCaller(tenantId, employeeId(jwt), authorities(auth), jwt, today);
    }

    static Set<String> authorities(Authentication auth) {
        if (auth == null) return Set.of();
        return auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).filter(Objects::nonNull)
                .collect(Collectors.toUnmodifiableSet());
    }

    static UUID employeeId(Jwt jwt) {
        if (jwt == null) return null;
        String raw = jwt.getClaimAsString("employee_id");
        if (raw == null || raw.isBlank()) return null;
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }
}
