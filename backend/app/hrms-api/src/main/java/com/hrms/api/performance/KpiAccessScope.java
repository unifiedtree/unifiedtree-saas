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
    /**
     * Company-wide performance: running review cycles or managing KPIs. Held by
     * exactly the roles that used to pass by name (OWNER, ADMIN, HR_MANAGER,
     * SUPER_ADMIN), and now also by anyone given one of them individually.
     */
    static final Set<String> ADMIN_PERMISSIONS = Set.of("hrms.performance.write", "hrms.kpi.manage");
    /**
     * Company-wide reviews, ratings, cycle progress and the performance directory:
     * running review cycles only. hrms.kpi.manage covers KPIs and goals, not other
     * people's ratings and reviews; the built-in DEPT_MANAGER held it by mistake
     * (V090, revoked by V143.87) and so saw everyone's performance page. Same rule
     * as the web, which shows "your team" to anyone without hrms.performance.write.
     */
    static final Set<String> REVIEW_ADMIN_PERMISSIONS = Set.of("hrms.performance.write");
    /** A team: the My team page permission (DEPT_MANAGER, MANAGER and the admins). */
    static final String TEAM_PERMISSION = "attendance.team.read";

    /** The scope for KPIs and goals. */
    static KpiAccessScope from(Authentication authentication) {
        return from(authentication, ADMIN_PERMISSIONS);
    }

    /** The scope for reviews, ratings, cycle progress and the performance directory. */
    static KpiAccessScope forReviews(Authentication authentication) {
        return from(authentication, REVIEW_ADMIN_PERMISSIONS);
    }

    private static KpiAccessScope from(Authentication authentication, Set<String> companyWide) {
        if (authentication == null || !authentication.isAuthenticated() || !(authentication.getPrincipal() instanceof Jwt jwt)) {
            throw new AccessDeniedException("Authenticated employee context is required");
        }
        // Permissions, not role names (V143.17): the Roles & permissions screen
        // and per-person overrides now decide who sees the whole company.
        List<String> held = new ArrayList<>();
        authentication.getAuthorities().forEach(a -> held.add(a.getAuthority()));
        if (held.stream().anyMatch(companyWide::contains)) return new KpiAccessScope(Kind.ADMIN, null, null);
        UUID employeeId;
        try { employeeId = UUID.fromString(jwt.getClaimAsString("employee_id")); }
        catch (RuntimeException error) { throw new AccessDeniedException("Employee context is required"); }
        return new KpiAccessScope(held.contains(TEAM_PERMISSION) ? Kind.TEAM : Kind.SELF, employeeId, null);
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
