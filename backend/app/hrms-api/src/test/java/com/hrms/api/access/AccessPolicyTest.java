package com.hrms.api.access;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.security.PermissionOverrides;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The "levels" rules (V143.17) that stop anyone giving more access than they
 * have, and the override arithmetic every permission check relies on.
 */
class AccessPolicyTest {

    private static final UUID ADMIN_ID = UUID.randomUUID();
    private static final UUID OWNER_ID = UUID.randomUUID();
    private static final UUID TARGET = UUID.randomUUID();

    private static final Map<String, String> RISK = Map.of(
            "hrms.leave.approve.l1", "MEDIUM",
            "hrms.advance.approve", "MEDIUM",
            "payroll.structure.read", "HIGH",
            "payroll.runs.manage", "HIGH",
            "workspace.users.manage", "CRITICAL",
            "rbac.access.manage-overrides", "CRITICAL",
            "attendance.checkin.self", "LOW",
            "platform.admin", "CRITICAL");

    /** An HR-level admin: holds leave / advance approval and salary read, nothing critical. */
    private static final AccessPolicy.Actor ADMIN = new AccessPolicy.Actor(ADMIN_ID, false,
            Set.of("hrms.leave.approve.l1", "hrms.advance.approve", "payroll.structure.read",
                    "attendance.checkin.self", "rbac.access.manage-overrides"));
    private static final AccessPolicy.Actor OWNER = new AccessPolicy.Actor(OWNER_ID, true, RISK.keySet());

    private static String code(Runnable r) {
        HrmsException e = assertThrows(HrmsException.class, r::run);
        return e.getErrorCode();
    }

    // ── rule 1 and 2: whose access you may touch ──────────────────────────────

    @Test void nobodyChangesTheirOwnAccess() {
        assertEquals("CANNOT_EDIT_OWN_ACCESS", code(() -> AccessPolicy.requireCanChangeUser(ADMIN, ADMIN_ID, false)));
        assertEquals("CANNOT_EDIT_OWN_ACCESS", code(() -> AccessPolicy.requireCanChangeUser(OWNER, OWNER_ID, true)));
    }

    @Test void onlyAnOwnerChangesAnOwner() {
        assertEquals("OWNER_ONLY", code(() -> AccessPolicy.requireCanChangeUser(ADMIN, TARGET, true)));
        assertDoesNotThrow(() -> AccessPolicy.requireCanChangeUser(OWNER, TARGET, true));
        assertDoesNotThrow(() -> AccessPolicy.requireCanChangeUser(ADMIN, TARGET, false));
    }

    @Test void refusalsAreForbiddenWithAReadableMessage() {
        HrmsException e = assertThrows(HrmsException.class, () -> AccessPolicy.requireCanChangeUser(ADMIN, ADMIN_ID, false));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertTrue(e.getMessage().contains("your own access"));
    }

    // ── rule 3 and 4: what you may give ───────────────────────────────────────

    @Test void youCanGiveOnlyWhatYouHold() {
        assertDoesNotThrow(() -> AccessPolicy.requireCanGrantPermissions(ADMIN, List.of("hrms.leave.approve.l1"), RISK));
        HrmsException e = assertThrows(HrmsException.class,
                () -> AccessPolicy.requireCanGrantPermissions(ADMIN, List.of("hrms.leave.approve.l1", "payroll.runs.manage"), RISK));
        assertEquals("PERMISSION_NOT_HELD", e.getErrorCode());
        assertTrue(e.getMessage().contains("payroll.runs.manage"));
    }

    @Test void criticalPermissionsOnlyFromTheOwnerEvenIfYouHoldThem() {
        // The admin holds rbac.access.manage-overrides but still may not hand it on.
        assertEquals("CRITICAL_OWNER_ONLY", code(() ->
                AccessPolicy.requireCanGrantPermissions(ADMIN, List.of("rbac.access.manage-overrides"), RISK)));
        assertDoesNotThrow(() -> AccessPolicy.requireCanGrantPermissions(OWNER, List.of("workspace.users.manage"), RISK));
    }

    @Test void platformAndUnknownPermissionsAreNeverGiven() {
        assertEquals("PLATFORM_PERMISSION", code(() -> AccessPolicy.requireCanGrantPermissions(OWNER, List.of("platform.admin"), RISK)));
        assertEquals("UNKNOWN_PERMISSION", code(() -> AccessPolicy.requireCanGrantPermissions(OWNER, List.of("made.up"), RISK)));
    }

    @Test void rolesFollowTheSameRules() {
        List<String> deptManager = List.of("hrms.leave.approve.l1", "hrms.advance.approve", "attendance.checkin.self");
        assertDoesNotThrow(() -> AccessPolicy.requireCanGrantRole(ADMIN, "DEPT_MANAGER", "Dept Manager", deptManager, RISK));
        // A role with a permission the admin lacks.
        assertEquals("PERMISSION_NOT_HELD", code(() -> AccessPolicy.requireCanGrantRole(ADMIN, "FINANCE_LEAD", "Finance Lead",
                List.of("payroll.runs.manage"), RISK)));
        // A role with a critical permission: owner only.
        assertEquals("CRITICAL_OWNER_ONLY", code(() -> AccessPolicy.requireCanGrantRole(ADMIN, "ADMIN", "Admin",
                List.of("workspace.users.manage"), RISK)));
        assertDoesNotThrow(() -> AccessPolicy.requireCanGrantRole(OWNER, "ADMIN", "Admin", List.of("workspace.users.manage"), RISK));
    }

    @Test void ownerAndSuperAdminRolesOnlyFromAnOwner() {
        assertEquals("OWNER_ONLY", code(() -> AccessPolicy.requireCanGrantRole(ADMIN, "SUPER_ADMIN", "Super Admin", List.of(), RISK)));
        assertEquals("OWNER_ONLY", code(() -> AccessPolicy.requireCanRevokeRole(ADMIN, "OWNER", "Owner")));
        assertDoesNotThrow(() -> AccessPolicy.requireCanGrantRole(OWNER, "SUPER_ADMIN", "Super Admin", List.of(), RISK));
        assertDoesNotThrow(() -> AccessPolicy.requireCanRevokeRole(ADMIN, "DEPT_MANAGER", "Dept Manager"));
    }

    @Test void platformAndLegacyRolesAreNeverGiven() {
        assertEquals("ROLE_NOT_ASSIGNABLE", code(() -> AccessPolicy.requireCanGrantRole(OWNER, "PLATFORM_SUPER_ADMIN", "Platform", List.of(), RISK)));
        assertEquals("ROLE_NOT_ASSIGNABLE", code(() -> AccessPolicy.requireCanGrantRole(OWNER, "MANAGER", "Manager", List.of(), RISK)));
        assertEquals("ROLE_NOT_ASSIGNABLE", code(() -> AccessPolicy.requireCanGrantRole(OWNER, "CUSTOM", "Custom", List.of("platform.admin"), RISK)));
    }

    @Test void blockedReasonLabelsTheDrawerSwitch() {
        assertNull(AccessPolicy.grantBlockedReason(OWNER, "ADMIN", "Admin", List.of("workspace.users.manage"), RISK));
        assertTrue(AccessPolicy.grantBlockedReason(ADMIN, "ADMIN", "Admin", List.of("workspace.users.manage"), RISK)
                .contains("Only the workspace owner"));
    }

    @Test void customRoleYouHoldIsYourOwnAccess() {
        assertEquals("CANNOT_EDIT_OWN_ACCESS", code(() -> AccessPolicy.requireNotOwnRole(true, "Senior manager")));
        assertDoesNotThrow(() -> AccessPolicy.requireNotOwnRole(false, "Senior manager"));
    }

    // ── warnings ─────────────────────────────────────────────────────────────

    @Test void highAndCriticalGrantsNeedTheWarningConfirmed() {
        assertEquals("RISK_NOT_ACKNOWLEDGED", code(() ->
                AccessPolicy.requireRiskAcknowledged(List.of("payroll.structure.read"), RISK, false)));
        assertDoesNotThrow(() -> AccessPolicy.requireRiskAcknowledged(List.of("payroll.structure.read"), RISK, true));
        assertDoesNotThrow(() -> AccessPolicy.requireRiskAcknowledged(List.of("hrms.leave.approve.l1"), RISK, false));
    }

    @Test void highestRiskOfARole() {
        assertEquals("CRITICAL", AccessPolicy.highestRisk(List.of("hrms.leave.approve.l1", "workspace.users.manage"), RISK));
        assertEquals("HIGH", AccessPolicy.highestRisk(List.of("payroll.structure.read", "attendance.checkin.self"), RISK));
        assertEquals("LOW", AccessPolicy.highestRisk(List.of(), RISK));
    }

    // ── effective = (roles + baseline + GRANT) − DENY ────────────────────────

    @Test void overridesAddGrantsAndDenyAlwaysWins() {
        List<String> roles = List.of("attendance.checkin.self", "hrms.advance.approve", "hrms.leave.approve.l1");
        List<PermissionOverrides.Override> overrides = List.of(
                new PermissionOverrides.Override("payroll.structure.read", "GRANT", null),
                new PermissionOverrides.Override("hrms.advance.approve", "DENY", OffsetDateTime.now().plusDays(3)),
                // A permission both granted and denied (two rows can't exist, but the rule must still hold).
                new PermissionOverrides.Override("hrms.leave.approve.l1", "DENY", null),
                new PermissionOverrides.Override("hrms.leave.approve.l1", "GRANT", null));
        assertEquals(List.of("attendance.checkin.self", "payroll.structure.read"),
                PermissionOverrides.apply(roles, overrides));
    }

    @Test void noOverridesLeavesTheSetSortedAndUnique() {
        assertEquals(List.of("a", "b"), PermissionOverrides.apply(List.of("b", "a", "b"), List.of()));
        assertEquals(List.of("a"), PermissionOverrides.apply(List.of("a"), null));
    }

    @Test void duplicateRoleCodeComesFromTheName() {
        assertEquals("SENIOR_MANAGER", RoleAdminService.codeFrom("Senior manager"));
        assertEquals("ROLE_2ND_LINE", RoleAdminService.codeFrom("2nd line"));
        assertEquals("HR_OPS_WEST", RoleAdminService.codeFrom("  HR ops (west) "));
    }
}
