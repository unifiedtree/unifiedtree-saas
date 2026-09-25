package com.hrms.api.employee;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Whose record a caller may read on the per-employee endpoints behind the
 * employee workspace (leave balances and requests, expense claims). Decided on
 * 2026-09-25 with the client:
 * <ul>
 *   <li>holders of the "anyone" permission (HR / admin, e.g.
 *       {@code hrms.leave.employee.read}) read any employee in the tenant;</li>
 *   <li>everyone reads themselves;</li>
 *   <li>holders of the "team" permission (the department manager's approval
 *       permission) read their team: the department(s) they head, or their
 *       direct reports if they head none, exactly like the My team page
 *       ({@link TeamEmployeeScope});</li>
 *   <li>anyone else is refused (403).</li>
 * </ul>
 * Scope comes from the authenticated principal only, never from request
 * parameters. RLS keeps every read inside the caller's tenant.
 */
@Component
public class EmployeeRecordAccess {

    private final TeamEmployeeScope teamScope;

    public EmployeeRecordAccess(TeamEmployeeScope teamScope) {
        this.teamScope = teamScope;
    }

    /**
     * Throws {@link AccessDeniedException} unless the caller may read
     * {@code targetEmployeeId}'s record.
     *
     * @param anyonePermission permission that opens every employee
     * @param teamPermission   permission that opens the caller's team (null: no team reach)
     */
    public void assertCanView(UUID targetEmployeeId, Jwt jwt, Authentication auth,
                              String anyonePermission, String teamPermission) {
        if (targetEmployeeId == null) throw new AccessDeniedException("Employee is required");
        if (hasAuthority(auth, anyonePermission)) return;
        UUID self = callerEmployeeId(jwt);
        if (self != null && self.equals(targetEmployeeId)) return;
        if (teamPermission != null && hasAuthority(auth, teamPermission) && self != null) {
            Set<UUID> team;
            try {
                team = teamScope.resolve(jwt, null).stream().map(Employee::getId).collect(Collectors.toSet());
            } catch (IllegalArgumentException noEmployeeRecord) {
                throw new AccessDeniedException("Your login is not linked to an employee record.");
            }
            if (team.contains(targetEmployeeId)) return;
            throw new AccessDeniedException("This person is not in your team.");
        }
        throw new AccessDeniedException("You can only see your own record.");
    }

    static UUID callerEmployeeId(Jwt jwt) {
        if (jwt == null) return null;
        String raw = jwt.getClaimAsString("employee_id");
        if (raw == null || raw.isBlank()) return null;
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException malformed) {
            return null;
        }
    }

    static boolean hasAuthority(Authentication auth, String authority) {
        return authority != null && auth != null
                && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }
}
