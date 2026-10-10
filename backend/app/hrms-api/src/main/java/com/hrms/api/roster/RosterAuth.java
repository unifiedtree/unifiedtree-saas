package com.hrms.api.roster;

import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * The permission codes and token reads shift planning uses (design §1.5), in one place. The
 * permission test is the token's {@code permissions} claim, the same set {@code hasAuthority}
 * checks (and the one {@code CompanyAccessFilter} swaps for a company reached through a grant).
 */
final class RosterAuth {

    private RosterAuth() {}

    static final String PLAN = "attendance.roster.plan";
    static final String PUBLISH = "attendance.roster.publish";
    /** The existing "company-wide" test for attendance (AttendanceController.isAdmin). */
    static final String WORKFORCE_ADMIN = "attendance.workforce.admin";
    static final String POLICY_MANAGE = "attendance.policy.manage";

    /** India time: every "today" in the planner, publish and schedule (design N7). */
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    static boolean has(Jwt jwt, String permission) {
        if (jwt == null) return false;
        List<String> permissions = jwt.getClaimAsStringList("permissions");
        return permissions != null && permissions.contains(permission);
    }

    /** The signed-in user (the token's subject), or null when it isn't a UUID. */
    static UUID userId(Jwt jwt) {
        if (jwt == null) return null;
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The caller's employee record (the {@code employee_id} claim), or null for a login without one. */
    static UUID employeeId(Jwt jwt) {
        if (jwt == null) return null;
        String e = jwt.getClaimAsString("employee_id");
        if (e == null || e.isBlank()) return null;
        try {
            return UUID.fromString(e);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    static LocalDate today(Clock clock) {
        return LocalDate.now(clock.withZone(IST));
    }
}
