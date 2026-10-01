package com.hrms.api.workforce;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.UUID;

/**
 * Who may see what of an employee record on the workforce API. The rule for a
 * single record (redesign BW-97, a privacy change):
 * <ul>
 *   <li>{@code hrms.employee.read}: the full record, exactly as before;</li>
 *   <li>otherwise, the person's direct manager (their {@code reporting_manager_id})
 *       holding {@code hrms.employee.team.manage}: the directory's list view,
 *       without pay, bank or identity fields;</li>
 *   <li>anyone else: refused (403), as before.</li>
 * </ul>
 * Only the direct manager, never the manager's manager.
 */
public final class WorkforceAccess {

    private WorkforceAccess() {}

    static final String EMPLOYEE_READ = "hrms.employee.read";
    static final String TEAM_MANAGE = "hrms.employee.team.manage";
    static final String ATTRITION_READ = "hrms.report.attrition";

    public enum RecordView { FULL, LIST, DENIED }

    /**
     * @param holdsRead        the caller holds hrms.employee.read
     * @param holdsTeamManage  the caller holds hrms.employee.team.manage
     * @param caller           the caller's employee id (null for a login without one)
     * @param targetManager    the requested person's reporting manager (null = none, or not found)
     */
    public static RecordView recordView(boolean holdsRead, boolean holdsTeamManage, UUID caller, UUID targetManager) {
        if (holdsRead) return RecordView.FULL;
        if (holdsTeamManage && caller != null && caller.equals(targetManager)) return RecordView.LIST;
        return RecordView.DENIED;
    }

    /** Whether the signed-in principal's token carries this permission. */
    public static boolean holds(String authority) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || authority == null) return false;
        for (GrantedAuthority a : auth.getAuthorities()) {
            if (authority.equals(a.getAuthority())) return true;
        }
        return false;
    }

    /** The caller's employee id from the token's {@code employee_id} claim; null when there is none. */
    public static UUID employeeId(Jwt jwt) {
        if (jwt == null) return null;
        String raw = jwt.getClaimAsString("employee_id");
        if (raw == null || raw.isBlank()) return null;
        try {
            return UUID.fromString(raw.trim());
        } catch (IllegalArgumentException notAnId) {
            return null;
        }
    }
}
