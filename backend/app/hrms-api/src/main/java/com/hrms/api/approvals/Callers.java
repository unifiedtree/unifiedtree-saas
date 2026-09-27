package com.hrms.api.approvals;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Who is calling, read the way the existing approval controllers read it, so
 * the inbox, Undo and the team endpoints can't disagree with the pages that
 * list and decide requests today.
 */
public final class Callers {

    /** The marker that gives the whole tenant to leave / WFH approvers (ApproverScopeGuard, the leave and WFH queues). */
    public static final String LEAVE_L2 = "hrms.leave.approve.l2";
    /** Company-wide attendance (TeamEmployeeScope, ShiftController.approverScope). */
    public static final String WORKFORCE_ADMIN = "attendance.workforce.admin";

    private Callers() {
    }

    /** The token's employee id, else its subject: exactly LeaveController / WfhController.extractEmployeeId. */
    public static UUID employeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    /** True when Spring Security's authorities (the token's permissions) include {@code authority}. */
    public static boolean hasAuthority(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    /** The token's permissions claim: AttendanceController.hasPermission / ExpenseController.callerHasPermission. */
    public static boolean hasClaim(Jwt jwt, String permission) {
        if (jwt == null) return false;
        List<String> permissions = jwt.getClaimAsStringList("permissions");
        return permissions != null && permissions.contains(permission);
    }

    /**
     * The caller's team by {@link TeamEmployeeScope#resolve}: what ApproverScopeGuard
     * and the correction queue use. Empty when the caller has no employee record
     * (the guard refuses those callers).
     */
    public static Set<UUID> teamIds(TeamEmployeeScope scope, Jwt jwt) {
        try {
            return scope.resolve(jwt, null).stream().map(Employee::getId).collect(Collectors.toSet());
        } catch (IllegalArgumentException noEmployeeRecord) {
            return Set.of();
        }
    }

    /**
     * Whose shift change requests the caller may see and decide: exactly
     * ShiftController.approverScope. Null means everyone in the tenant
     * (attendance.workforce.admin); otherwise the caller's team.
     */
    public static Set<UUID> shiftApproverScope(TeamEmployeeScope scope, Jwt jwt) {
        if (hasClaim(jwt, WORKFORCE_ADMIN)) return null;
        return teamIds(scope, jwt);
    }
}
