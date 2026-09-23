package com.hrms.api.performance;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Object scope is derived from the authenticated principal, never from query parameters. */
record KpiAccessScope(Kind kind, UUID employeeId) {
    enum Kind { ADMIN, DIRECT_REPORTS, SELF }
    private static final Set<String> ADMIN_ROLES = Set.of("OWNER", "ADMIN", "COMPANY_ADMIN", "HR_MANAGER", "SUPER_ADMIN");

    static KpiAccessScope from(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated() || !(authentication.getPrincipal() instanceof Jwt jwt)) {
            throw new AccessDeniedException("Authenticated employee context is required");
        }
        List<String> roles = new ArrayList<>();
        List<String> claims = jwt.getClaimAsStringList("roles");
        if (claims != null) roles.addAll(claims);
        authentication.getAuthorities().stream().map(a -> a.getAuthority())
                .filter(a -> a.startsWith("ROLE_")).forEach(roles::add);
        roles = roles.stream().map(role -> role.startsWith("ROLE_") ? role.substring(5) : role).toList();
        if (roles.stream().anyMatch(ADMIN_ROLES::contains)) return new KpiAccessScope(Kind.ADMIN, null);
        UUID employeeId;
        try { employeeId = UUID.fromString(jwt.getClaimAsString("employee_id")); }
        catch (RuntimeException error) { throw new AccessDeniedException("Employee context is required"); }
        return new KpiAccessScope(roles.stream().anyMatch(role -> role.equals("MANAGER") || role.equals("DEPT_MANAGER"))
                ? Kind.DIRECT_REPORTS : Kind.SELF, employeeId);
    }

    void appendGoalPredicate(StringBuilder sql, List<Object> args) {
        if (kind == Kind.SELF) {
            sql.append(" AND g.employee_id = ?");
            args.add(employeeId);
        } else if (kind == Kind.DIRECT_REPORTS) {
            sql.append(" AND g.employee_id IN (SELECT scoped.id FROM hrms.employees scoped WHERE scoped.tenant_id = g.tenant_id AND scoped.reporting_manager_id = ? AND scoped.is_active = TRUE)");
            args.add(employeeId);
        }
    }
}
