package com.hrms.api.attendance;

import com.hrms.employee.entity.Employee;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * "Can this approver decide a request from that employee?" — the check the
 * decide endpoints were missing. Found on 2026-09-24: leave, WFH and correction
 * decisions only checked the permission, so a department manager could reject
 * any employee's request across the company (finance's leave, another team's
 * WFH, and so on).
 *
 * <p>Rule: an HR / admin marker (leave.approve.l2) lets the whole tenant
 * through. Anyone else must be the requester's approver by the team-scope rule
 * TeamEmployeeScope already implements (department head → whole department;
 * else reporting manager). The self-approval guard stays in each service.
 */
@Component
public class ApproverScopeGuard {

    private static final String HR_MARKER = "hrms.leave.approve.l2";

    private final TeamEmployeeScope teamScope;

    public ApproverScopeGuard(TeamEmployeeScope teamScope) {
        this.teamScope = teamScope;
    }

    /**
     * Throws {@link AccessDeniedException} unless {@code jwt}'s employee may
     * decide requests from {@code requesterEmployeeId}. A null requester (e.g.
     * a request whose fixture we can't load) is refused for non-HR/admin
     * callers — better to 403 than silently allow.
     */
    public void assertCanDecideFor(UUID requesterEmployeeId, Jwt jwt, Authentication auth) {
        if (hasAuthority(auth, HR_MARKER)) return;
        if (requesterEmployeeId == null) throw refuse();
        Set<UUID> team;
        try {
            team = teamScope.resolve(jwt, null).stream().map(Employee::getId).collect(Collectors.toSet());
        } catch (IllegalArgumentException noEmployeeRecord) {
            throw refuse();
        }
        if (!team.contains(requesterEmployeeId)) throw refuse();
    }

    private static boolean hasAuthority(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    private static AccessDeniedException refuse() {
        return new AccessDeniedException("This request is not from your team.");
    }
}
