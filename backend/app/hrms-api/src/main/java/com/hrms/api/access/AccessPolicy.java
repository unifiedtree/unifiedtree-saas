package com.hrms.api.access;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The "levels" rules for changing anyone's access (roles, per-person
 * overrides, and what a custom role contains). Pure: no database, so every
 * rule is unit-tested on its own. {@link AccessGuard} loads the facts and
 * calls these.
 *
 * <ol>
 *   <li><b>Nobody changes their own access.</b> Not their roles, not their
 *       overrides, and not a custom role they hold.</li>
 *   <li><b>Only an OWNER changes an OWNER's access.</b></li>
 *   <li><b>You can only give what you hold.</b> Granting a role, a GRANT
 *       override, or adding a permission to a custom role needs every
 *       permission involved in the actor's own effective set.</li>
 *   <li><b>Only an OWNER grants CRITICAL permissions</b> (access control,
 *       billing, the workspace itself) or the OWNER / SUPER_ADMIN roles.</li>
 *   <li><b>Platform permissions and roles are never granted</b> inside a
 *       workspace, and the legacy MANAGER role is not handed out (use
 *       DEPT_MANAGER).</li>
 * </ol>
 * Taking access away (revoking a role, adding a DENY) needs the management
 * permission and rules 1–2 only: it cannot escalate anyone.
 */
public final class AccessPolicy {

    private AccessPolicy() {}

    public static final String OWNER = "OWNER";
    public static final String SUPER_ADMIN = "SUPER_ADMIN";
    public static final String CRITICAL = "CRITICAL";
    public static final String HIGH = "HIGH";

    /** Roles only an OWNER may give or take away. */
    public static final Set<String> OWNER_ONLY_ROLES = Set.of(OWNER, SUPER_ADMIN);
    /** Roles never handed out here: platform operators, and the legacy MANAGER (DEPT_MANAGER replaces it). */
    public static final Set<String> NEVER_ASSIGNABLE_ROLES = Set.of("PLATFORM_SUPER_ADMIN", "MANAGER");

    /** Everything the rules need to know about the person making the change. */
    public record Actor(UUID userId, boolean owner, Set<String> permissions) {
        public boolean holds(String code) { return permissions.contains(code); }
    }

    /** 403 with a reason the UI can show as-is. */
    public static HrmsException refused(String message, String code) {
        return new HrmsException(message, HttpStatus.FORBIDDEN, code);
    }

    /** Rule 1 and 2: may this actor change this person's access at all? */
    public static void requireCanChangeUser(Actor actor, UUID targetUserId, boolean targetIsOwner) {
        if (actor.userId() != null && actor.userId().equals(targetUserId)) {
            throw refused("You can’t change your own access. Ask another admin or the workspace owner.",
                    "CANNOT_EDIT_OWN_ACCESS");
        }
        if (targetIsOwner && !actor.owner()) {
            throw refused("Only the workspace owner can change an owner’s access.", "OWNER_ONLY");
        }
    }

    /**
     * Rules 3–5 for giving someone permissions (through an override, or by
     * adding them to a custom role).
     *
     * @param riskByCode risk level of every catalogue permission
     */
    public static void requireCanGrantPermissions(Actor actor, Collection<String> codes,
                                                  Map<String, String> riskByCode) {
        TreeSet<String> notHeld = new TreeSet<>();
        TreeSet<String> critical = new TreeSet<>();
        for (String code : codes) {
            if (code == null) continue;
            if (isPlatform(code)) {
                throw refused("Platform permissions can’t be given inside a workspace: " + code, "PLATFORM_PERMISSION");
            }
            if (!riskByCode.containsKey(code)) {
                throw new HrmsException("Unknown permission: " + code, HttpStatus.UNPROCESSABLE_ENTITY, "UNKNOWN_PERMISSION");
            }
            if (!actor.holds(code)) notHeld.add(code);
            if (CRITICAL.equals(riskByCode.get(code))) critical.add(code);
        }
        if (!critical.isEmpty() && !actor.owner()) {
            throw refused("Only the workspace owner can give critical permissions: " + String.join(", ", critical) + ".",
                    "CRITICAL_OWNER_ONLY");
        }
        if (!notHeld.isEmpty()) {
            throw refused("You can only give permissions you hold yourself. You don’t have: "
                    + String.join(", ", notHeld) + ".", "PERMISSION_NOT_HELD");
        }
    }

    /** Rules 3–5 for giving someone a role with the given permissions. */
    public static void requireCanGrantRole(Actor actor, String roleCode, String roleName,
                                           Collection<String> rolePermissions, Map<String, String> riskByCode) {
        String label = roleName == null || roleName.isBlank() ? roleCode : roleName;
        if (NEVER_ASSIGNABLE_ROLES.contains(roleCode)) {
            throw refused("The " + label + " role can’t be given here.", "ROLE_NOT_ASSIGNABLE");
        }
        if (OWNER_ONLY_ROLES.contains(roleCode) && !actor.owner()) {
            throw refused("Only the workspace owner can give the " + label + " role.", "OWNER_ONLY");
        }
        TreeSet<String> notHeld = new TreeSet<>();
        TreeSet<String> critical = new TreeSet<>();
        for (String code : rolePermissions) {
            if (isPlatform(code)) {
                throw refused("The " + label + " role includes platform permissions and can’t be given here.", "ROLE_NOT_ASSIGNABLE");
            }
            if (!actor.holds(code)) notHeld.add(code);
            if (CRITICAL.equals(riskByCode.get(code))) critical.add(code);
        }
        if (!critical.isEmpty() && !actor.owner()) {
            throw refused("Only the workspace owner can give the " + label + " role, because it includes critical permissions ("
                    + String.join(", ", critical) + ").", "CRITICAL_OWNER_ONLY");
        }
        if (!notHeld.isEmpty()) {
            throw refused("You can only give a role whose permissions you hold yourself. " + label
                    + " includes " + notHeld.size() + " you don’t have: " + String.join(", ", first(notHeld, 8)) + ".",
                    "PERMISSION_NOT_HELD");
        }
    }

    /** Rule 2 for taking a role away: OWNER / SUPER_ADMIN only by an OWNER. */
    public static void requireCanRevokeRole(Actor actor, String roleCode, String roleName) {
        if (OWNER_ONLY_ROLES.contains(roleCode) && !actor.owner()) {
            String label = roleName == null || roleName.isBlank() ? roleCode : roleName;
            throw refused("Only the workspace owner can take away the " + label + " role.", "OWNER_ONLY");
        }
    }

    /** Rule 1 for custom roles: editing or deleting a role you hold changes your own access. */
    public static void requireNotOwnRole(boolean actorHoldsRole, String roleName) {
        if (actorHoldsRole) {
            throw refused("You hold the " + roleName + " role, so changing it would change your own access. "
                    + "Ask another admin or the workspace owner.", "CANNOT_EDIT_OWN_ACCESS");
        }
    }

    /** HIGH and CRITICAL grants need the caller to confirm they read the warning. */
    public static void requireRiskAcknowledged(Collection<String> grantedCodes, Map<String, String> riskByCode,
                                               boolean acknowledged) {
        if (acknowledged) return;
        TreeSet<String> risky = new TreeSet<>();
        for (String code : grantedCodes) {
            String risk = riskByCode.get(code);
            if (HIGH.equals(risk) || CRITICAL.equals(risk)) risky.add(code);
        }
        if (!risky.isEmpty()) {
            throw new HrmsException("Please confirm you want to give these high-risk permissions: "
                    + String.join(", ", risky) + ".", HttpStatus.UNPROCESSABLE_ENTITY, "RISK_NOT_ACKNOWLEDGED");
        }
    }

    public static boolean isPlatform(String code) {
        return code != null && code.startsWith("platform.");
    }

    /**
     * Why this actor could not give a role, or {@code null} when they can.
     * Used to label the switches in the Manage access drawer.
     */
    public static String grantBlockedReason(Actor actor, String roleCode, String roleName,
                                            Collection<String> rolePermissions, Map<String, String> riskByCode) {
        try {
            requireCanGrantRole(actor, roleCode, roleName, rolePermissions, riskByCode);
            return null;
        } catch (HrmsException e) {
            return e.getMessage();
        }
    }

    /** The highest risk level among some permissions (LOW when none). */
    public static String highestRisk(Collection<String> codes, Map<String, String> riskByCode) {
        int best = 0;
        for (String c : codes) best = Math.max(best, rank(riskByCode.get(c)));
        return List.of("LOW", "MEDIUM", "HIGH", "CRITICAL").get(best);
    }

    static int rank(String risk) {
        if (risk == null) return 0;
        return switch (risk) {
            case "MEDIUM" -> 1;
            case HIGH -> 2;
            case CRITICAL -> 3;
            default -> 0;
        };
    }

    private static List<String> first(TreeSet<String> set, int n) {
        return set.stream().limit(n).toList();
    }
}
