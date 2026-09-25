package com.hrms.api.performance;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Object scope is derived from the authenticated principal, never from query parameters.
 * {@code TEAM} (managers) carries the resolved team ids; see {@link PerformanceTeamScope}
 * for how a team is defined (same as the My team page since 2026-09-25; it was
 * direct reports only before).
 */
record KpiAccessScope(Kind kind, UUID employeeId, Set<UUID> teamIds) {
    enum Kind { ADMIN, TEAM, SELF }
    static final Set<String> ADMIN_ROLES = Set.of("OWNER", "ADMIN", "COMPANY_ADMIN", "HR_MANAGER", "SUPER_ADMIN");

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
        if (roles.stream().anyMatch(ADMIN_ROLES::contains)) return new KpiAccessScope(Kind.ADMIN, null, null);
        UUID employeeId;
        try { employeeId = UUID.fromString(jwt.getClaimAsString("employee_id")); }
        catch (RuntimeException error) { throw new AccessDeniedException("Employee context is required"); }
        return new KpiAccessScope(roles.stream().anyMatch(role -> role.equals("MANAGER") || role.equals("DEPT_MANAGER"))
                ? Kind.TEAM : Kind.SELF, employeeId, null);
    }

    KpiAccessScope withTeam(Set<UUID> ids) {
        return new KpiAccessScope(kind, employeeId, ids == null ? Set.of() : Set.copyOf(ids));
    }

    void appendGoalPredicate(StringBuilder sql, List<Object> args) {
        if (kind == Kind.SELF) {
            sql.append(" AND g.employee_id = ?");
            args.add(employeeId);
        } else if (kind == Kind.TEAM) {
            if (teamIds == null) throw new IllegalStateException("Team scope must be resolved before use");
            PerformanceTeamScope.appendIn(sql, args, "g.employee_id", teamIds);
        }
    }

    /** Whether an owner falls inside this scope. */
    boolean covers(UUID ownerId) {
        return switch (kind) {
            case ADMIN -> true;
            case SELF -> ownerId.equals(employeeId);
            case TEAM -> teamIds != null && teamIds.contains(ownerId);
        };
    }
}
