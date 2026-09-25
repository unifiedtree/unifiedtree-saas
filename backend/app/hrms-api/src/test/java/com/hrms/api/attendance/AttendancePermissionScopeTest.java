package com.hrms.api.attendance;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * V143.17: company-wide vs team attendance scope comes from permissions in
 * the token, never from role names, so Roles &amp; permissions and per-person
 * overrides decide it.
 */
class AttendancePermissionScopeTest {

    private static Jwt token(List<String> roles, List<String> permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("roles", roles).claim("permissions", permissions).build();
    }

    @Test void builtInRolesKeepTheirScope() {
        // HR / admin / owner roles hold attendance.workforce.admin → the whole company.
        Jwt hr = token(List.of("HR_MANAGER"), List.of("attendance.workforce.admin", "attendance.team.read"));
        assertTrue(AttendanceController.isAdmin(hr));
        assertTrue(AttendanceController.isManagerOrAdmin(hr));
        // A department manager sees a team only.
        Jwt manager = token(List.of("DEPT_MANAGER"), List.of("attendance.team.read"));
        assertFalse(AttendanceController.isAdmin(manager));
        assertTrue(AttendanceController.isManagerOrAdmin(manager));
        // A plain employee sees neither.
        Jwt employee = token(List.of("EMPLOYEE"), List.of("attendance.checkin.self"));
        assertFalse(AttendanceController.isAdmin(employee));
        assertFalse(AttendanceController.isManagerOrAdmin(employee));
    }

    @Test void aRoleNameAloneGrantsNothing() {
        // An OWNER whose token lacks the permission (e.g. removed for this person) is not company-wide.
        Jwt ownerWithoutPermission = token(List.of("OWNER", "SUPER_ADMIN"), List.of());
        assertFalse(AttendanceController.isAdmin(ownerWithoutPermission));
        assertFalse(AttendanceController.isManagerOrAdmin(ownerWithoutPermission));
    }

    @Test void anExtraPermissionWidensTheScope() {
        // One manager given attendance.workforce.admin individually sees the whole company.
        Jwt seniorManager = token(List.of("DEPT_MANAGER"), List.of("attendance.team.read", "attendance.workforce.admin"));
        assertTrue(AttendanceController.isAdmin(seniorManager));
    }

    @Test void missingClaimsAreSafe() {
        Jwt bare = Jwt.withTokenValue("t").header("alg", "none").subject("x").claim("x", "y").build();
        assertFalse(AttendanceController.isAdmin(bare));
        assertFalse(AttendanceController.hasPermission(null, "attendance.team.read"));
    }
}
