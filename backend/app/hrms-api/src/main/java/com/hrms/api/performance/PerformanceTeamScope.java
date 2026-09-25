package com.hrms.api.performance;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Whose performance data (reviews, cycle progress, KPIs, the rating
 * directory) the caller may see. Decided 2026-09-25 with the client:
 * <ul>
 *   <li>Admin / HR ({@link KpiAccessScope#ADMIN_PERMISSIONS}): the whole company.</li>
 *   <li>Managers ({@link KpiAccessScope#TEAM_PERMISSION}): <b>their team</b>, defined exactly like the My team
 *       page ({@link TeamEmployeeScope}): everyone in the department(s) they head,
 *       or their direct reports if they head none. Never themselves; their own
 *       reviews and goals are on the self-service endpoints.</li>
 *   <li>Anyone else: only themselves.</li>
 * </ul>
 * Scope comes from the authenticated principal only, never from request parameters.
 */
@Service
public class PerformanceTeamScope {

    private final TeamEmployeeScope teamScope;

    public PerformanceTeamScope(TeamEmployeeScope teamScope) {
        this.teamScope = teamScope;
    }

    /** {@code null} when the caller sees the whole company; otherwise the employee ids they may see. */
    public Set<UUID> visibleEmployeeIds() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        KpiAccessScope scope = KpiAccessScope.from(auth);
        return switch (scope.kind()) {
            case ADMIN -> null;
            case SELF -> Set.of(scope.employeeId());
            case TEAM -> teamOf((Jwt) auth.getPrincipal());
        };
    }

    Set<UUID> teamOf(Jwt jwt) {
        try {
            List<Employee> team = teamScope.resolve(jwt, null);
            return team.stream().map(Employee::getId).collect(Collectors.toUnmodifiableSet());
        } catch (IllegalArgumentException missingEmployee) {
            throw new AccessDeniedException("Employee context is required");
        }
    }

    /** Appends {@code AND <column> IN (...)} for a restricted scope; an empty scope matches nothing. */
    public static void appendIn(StringBuilder sql, List<Object> args, String column, Set<UUID> ids) {
        if (ids == null) return;
        if (ids.isEmpty()) { sql.append(" AND FALSE"); return; }
        sql.append(" AND ").append(column).append(" IN (")
           .append(ids.stream().map(id -> "?").collect(Collectors.joining(","))).append(')');
        args.addAll(ids);
    }
}
