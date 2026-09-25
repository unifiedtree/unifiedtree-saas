package com.hrms.api.access;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.security.PermissionOverrides;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;

/**
 * Per-person permission overrides: {@code GET/PUT /v1/workspace/users/{id}/permissions}.
 *
 * <p>The client's case: two department managers, one of whom needs something
 * extra (or less). Instead of a one-off role, an admin gives that one person an
 * extra permission (GRANT) or takes one away (DENY), with a reason and an
 * optional end date. The same rule as everywhere else applies:
 * {@code (roles + employee baseline + GRANTs) − DENYs}.
 *
 * <p>Guard rails ({@link AccessPolicy}): the caller needs
 * {@code rbac.access.manage-overrides}; nobody changes their own access; only
 * an OWNER changes an OWNER; you can only give permissions you hold; only an
 * OWNER gives CRITICAL ones; HIGH/CRITICAL grants must be confirmed. Removing
 * a DENY gives the permission back, so it is checked like a grant. Every
 * change is written to the audit log.
 */
@Service
public class UserPermissionService {

    public static final String MANAGE_OVERRIDES = "rbac.access.manage-overrides";
    public static final String MANAGE_USERS = "workspace.users.manage";
    private static final int MAX_REASON = 500;

    private final JdbcTemplate jdbc;
    private final AccessGuard guard;
    private final AccessAudit audit;

    public UserPermissionService(JdbcTemplate jdbc, AccessGuard guard, AccessAudit audit) {
        this.jdbc = jdbc;
        this.guard = guard;
        this.audit = audit;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record RoleRef(String roleCode, String displayName) {}

    public record OverrideDto(String permissionCode, String displayName, String module,
                              String riskLevel, String warning, String effect, String reason,
                              UUID grantedBy, String grantedByEmail, OffsetDateTime createdAt,
                              OffsetDateTime expiresAt, boolean expired) {}

    /** One permission and where it comes from ("Role: HR Manager", "Every employee", "Extra permission"). */
    public record EffectiveDto(String code, String displayName, String module, String riskLevel,
                               List<String> sources) {}

    public record UserPermissionsView(
            UUID userId, String email, boolean targetIsOwner, List<RoleRef> roles,
            List<OverrideDto> overrides, List<EffectiveDto> effective, List<EffectiveDto> removed,
            boolean canEdit, String editBlockedReason,
            boolean canChangeRoles, String rolesBlockedReason,
            List<String> grantable) {}

    public record OverrideInput(String permissionCode, String effect, String reason, OffsetDateTime expiresAt) {}

    public record PutPermissionsRequest(List<OverrideInput> overrides, Boolean acknowledgeRisk) {}

    private record Catalog(String code, String displayName, String module, String risk, String warning) {}

    private record Existing(String code, String effect, String reason, OffsetDateTime expiresAt) {}

    // ── Read ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public UserPermissionsView view(UUID targetUserId, UUID actorId) {
        String email = requireUser(targetUserId);
        AccessPolicy.Actor actor = guard.actor(actorId);
        boolean targetOwner = guard.isOwner(targetUserId);
        Map<String, Catalog> catalog = catalog();
        Map<String, String> risk = riskOf(catalog);

        // Roles and which permission each gives.
        List<Map<String, Object>> roleRows = jdbc.queryForList("""
                SELECT r.id, r.code, r.display_name
                  FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = ?
                 ORDER BY r.display_name
                """, targetUserId);
        List<RoleRef> roles = new ArrayList<>();
        Map<String, List<String>> sources = new TreeMap<>();
        for (Map<String, Object> r : roleRows) {
            String name = (String) r.get("display_name");
            roles.add(new RoleRef((String) r.get("code"), name));
            for (String code : guard.permissionsOfRole((UUID) r.get("id"))) {
                sources.computeIfAbsent(code, k -> new ArrayList<>()).add("Role: " + name);
            }
        }
        if (guard.employeeId(targetUserId) != null) {
            for (String code : guard.baselinePermissions()) {
                sources.computeIfAbsent(code, k -> new ArrayList<>()).add("Every employee");
            }
        }

        List<OverrideDto> overrides = loadOverrideDtos(targetUserId, catalog);
        Set<String> denied = new HashSet<>();
        for (OverrideDto o : overrides) {
            if (o.expired()) continue;
            if (PermissionOverrides.GRANT.equals(o.effect())) {
                sources.computeIfAbsent(o.permissionCode(), k -> new ArrayList<>()).add("Extra permission (given to this person)");
            } else {
                denied.add(o.permissionCode());
            }
        }

        List<EffectiveDto> effective = new ArrayList<>();
        List<EffectiveDto> removed = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : sources.entrySet()) {
            Catalog c = catalog.get(e.getKey());
            EffectiveDto dto = new EffectiveDto(e.getKey(), c == null ? e.getKey() : c.displayName(),
                    c == null ? "" : c.module(), c == null ? "LOW" : c.risk(), List.copyOf(e.getValue()));
            if (denied.contains(e.getKey())) removed.add(dto); else effective.add(dto);
        }

        String editBlocked = blockedReason(actor, targetUserId, targetOwner, MANAGE_OVERRIDES,
                "You need the “Give or remove individual permissions” permission to change this.");
        String rolesBlocked = blockedReason(actor, targetUserId, targetOwner, MANAGE_USERS,
                "You need the “Manage workspace users” permission to change roles.");

        List<String> grantable = new ArrayList<>();
        for (Catalog c : catalog.values()) {
            if (AccessPolicy.isPlatform(c.code()) || !actor.holds(c.code())) continue;
            if (AccessPolicy.CRITICAL.equals(c.risk()) && !actor.owner()) continue;
            grantable.add(c.code());
        }
        grantable.sort(Comparator.naturalOrder());

        return new UserPermissionsView(targetUserId, email, targetOwner, roles, overrides, effective, removed,
                editBlocked == null, editBlocked, rolesBlocked == null, rolesBlocked, grantable);
    }

    // ── Write ───────────────────────────────────────────────────────────────

    @Transactional
    public UserPermissionsView replace(UUID targetUserId, UUID actorId, PutPermissionsRequest req) {
        String email = requireUser(targetUserId);
        AccessPolicy.Actor actor = guard.actor(actorId);
        if (!actor.holds(MANAGE_OVERRIDES)) {
            throw AccessPolicy.refused("You need the “Give or remove individual permissions” permission to change this.",
                    "PERMISSION_REQUIRED");
        }
        AccessPolicy.requireCanChangeUser(actor, targetUserId, guard.isOwner(targetUserId));

        Map<String, Catalog> catalog = catalog();
        Map<String, String> risk = riskOf(catalog);
        Map<String, OverrideInput> wanted = validate(req == null ? null : req.overrides(), catalog);
        Map<String, Existing> existing = loadExisting(targetUserId);

        // What changes, and which of those changes give access (checked like a grant).
        List<String> added = new ArrayList<>(), changed = new ArrayList<>(), removedCodes = new ArrayList<>();
        Set<String> givesAccess = new TreeSet<>();
        for (OverrideInput in : wanted.values()) {
            Existing old = existing.get(in.permissionCode());
            if (old == null) {
                added.add(in.permissionCode());
                if (PermissionOverrides.GRANT.equals(in.effect())) givesAccess.add(in.permissionCode());
            } else if (differs(old, in)) {
                changed.add(in.permissionCode());
                if (PermissionOverrides.GRANT.equals(in.effect()) || PermissionOverrides.DENY.equals(old.effect())) {
                    givesAccess.add(in.permissionCode());
                }
            }
        }
        for (Existing old : existing.values()) {
            if (!wanted.containsKey(old.code())) {
                removedCodes.add(old.code());
                if (PermissionOverrides.DENY.equals(old.effect())) givesAccess.add(old.code());
            }
        }
        if (added.isEmpty() && changed.isEmpty() && removedCodes.isEmpty()) {
            return view(targetUserId, actorId);
        }
        for (String code : concat(added, changed)) requireFutureExpiry(wanted.get(code));
        AccessPolicy.requireCanGrantPermissions(actor, givesAccess, risk);
        AccessPolicy.requireRiskAcknowledged(givesAccess, risk, req != null && Boolean.TRUE.equals(req.acknowledgeRisk()));

        UUID tenantId = TenantContext.requireTenantId();
        for (String code : removedCodes) {
            jdbc.update("DELETE FROM rbac.user_permission_overrides WHERE user_id = ? AND permission_code = ?",
                    targetUserId, code);
        }
        for (String code : concat(added, changed)) {
            OverrideInput in = wanted.get(code);
            jdbc.update("""
                    INSERT INTO rbac.user_permission_overrides
                        (tenant_id, user_id, permission_code, effect, reason, granted_by, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, now(), ?)
                    ON CONFLICT (tenant_id, user_id, permission_code) DO UPDATE
                       SET effect = EXCLUDED.effect, reason = EXCLUDED.reason, granted_by = EXCLUDED.granted_by,
                           created_at = now(), expires_at = EXCLUDED.expires_at
                    """, tenantId, targetUserId, code, in.effect(), in.reason(), actor.userId(), in.expiresAt());
        }

        Map<String, Object> diff = new LinkedHashMap<>();
        diff.put("user", email);
        diff.put("added", describe(added, wanted, null));
        diff.put("changed", describeChanged(changed, wanted, existing));
        diff.put("removed", describe(removedCodes, null, existing));
        audit.record(actor.userId(), AccessAudit.PERMISSION_CHANGE, "USER", targetUserId,
                summary(email, added, changed, removedCodes, wanted, existing), diff);
        guard.evict(targetUserId);
        return view(targetUserId, actorId);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private String blockedReason(AccessPolicy.Actor actor, UUID target, boolean targetOwner,
                                 String needed, String missingMessage) {
        if (!actor.holds(needed)) return missingMessage;
        try {
            AccessPolicy.requireCanChangeUser(actor, target, targetOwner);
            return null;
        } catch (HrmsException e) {
            return e.getMessage();
        }
    }

    private String requireUser(UUID userId) {
        List<String> rows = jdbc.queryForList("SELECT email FROM auth.user_credentials WHERE id = ?", String.class, userId);
        if (rows.isEmpty()) throw new HrmsException("User not found", HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
        return rows.get(0);
    }

    private Map<String, Catalog> catalog() {
        Map<String, Catalog> out = new LinkedHashMap<>();
        jdbc.query("SELECT code, display_name, module, risk_level, warning FROM rbac.permissions ORDER BY module, code",
                rs -> { out.put(rs.getString(1), new Catalog(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5))); });
        return out;
    }

    private static Map<String, String> riskOf(Map<String, Catalog> catalog) {
        Map<String, String> out = new HashMap<>();
        catalog.forEach((k, v) -> out.put(k, v.risk()));
        return out;
    }

    private Map<String, OverrideInput> validate(List<OverrideInput> inputs, Map<String, Catalog> catalog) {
        Map<String, OverrideInput> out = new LinkedHashMap<>();
        if (inputs == null) return out;
        for (OverrideInput in : inputs) {
            if (in == null || in.permissionCode() == null || in.permissionCode().isBlank()) {
                throw invalid("Each change needs a permission.", "PERMISSION_REQUIRED");
            }
            String code = in.permissionCode().trim();
            if (!catalog.containsKey(code)) throw invalid("Unknown permission: " + code, "UNKNOWN_PERMISSION");
            if (AccessPolicy.isPlatform(code)) {
                throw AccessPolicy.refused("Platform permissions can’t be given inside a workspace: " + code, "PLATFORM_PERMISSION");
            }
            if (out.containsKey(code)) throw invalid(code + " is listed twice.", "DUPLICATE_PERMISSION");
            String effect = in.effect() == null ? "" : in.effect().trim().toUpperCase();
            if (!PermissionOverrides.GRANT.equals(effect) && !PermissionOverrides.DENY.equals(effect)) {
                throw invalid("Choose whether to give or remove " + code + ".", "INVALID_EFFECT");
            }
            String reason = in.reason() == null ? "" : in.reason().trim();
            if (reason.isEmpty()) throw invalid("Please give a reason for " + code + ".", "REASON_REQUIRED");
            if (reason.length() > MAX_REASON) throw invalid("Keep the reason under " + MAX_REASON + " characters.", "REASON_TOO_LONG");
            out.put(code, new OverrideInput(code, effect, reason, in.expiresAt()));
        }
        return out;
    }

    /** Expiry is checked only on rows that change: an untouched, already-expired row stays as it is. */
    private static void requireFutureExpiry(OverrideInput in) {
        if (in.expiresAt() != null && !in.expiresAt().isAfter(OffsetDateTime.now())) {
            throw invalid("The end date for " + in.permissionCode() + " must be in the future.", "EXPIRY_IN_PAST");
        }
    }

    private static HrmsException invalid(String message, String code) {
        return new HrmsException(message, HttpStatus.UNPROCESSABLE_ENTITY, code);
    }

    private static boolean differs(Existing old, OverrideInput in) {
        return !old.effect().equals(in.effect()) || !old.reason().equals(in.reason())
                || !sameInstant(old.expiresAt(), in.expiresAt());
    }

    private static boolean sameInstant(OffsetDateTime a, OffsetDateTime b) {
        if (a == null || b == null) return a == b;
        return a.toInstant().equals(b.toInstant());
    }

    private Map<String, Existing> loadExisting(UUID userId) {
        Map<String, Existing> out = new LinkedHashMap<>();
        jdbc.query("SELECT permission_code, effect, reason, expires_at FROM rbac.user_permission_overrides WHERE user_id = ?",
                rs -> { out.put(rs.getString(1), new Existing(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getObject(4, OffsetDateTime.class))); }, userId);
        return out;
    }

    private List<OverrideDto> loadOverrideDtos(UUID userId, Map<String, Catalog> catalog) {
        OffsetDateTime now = OffsetDateTime.now();
        return jdbc.query("""
                SELECT o.permission_code, o.effect, o.reason, o.granted_by, g.email, o.created_at, o.expires_at
                  FROM rbac.user_permission_overrides o
                  LEFT JOIN auth.user_credentials g ON g.id = o.granted_by
                 WHERE o.user_id = ?
                 ORDER BY o.effect, o.permission_code
                """, (rs, i) -> {
                    String code = rs.getString(1);
                    Catalog c = catalog.get(code);
                    OffsetDateTime exp = rs.getObject(7, OffsetDateTime.class);
                    return new OverrideDto(code, c == null ? code : c.displayName(), c == null ? "" : c.module(),
                            c == null ? "LOW" : c.risk(), c == null ? null : c.warning(),
                            rs.getString(2), rs.getString(3), rs.getObject(4, UUID.class), rs.getString(5),
                            rs.getObject(6, OffsetDateTime.class), exp, exp != null && !exp.isAfter(now));
                }, userId);
    }

    private static List<String> concat(List<String> a, List<String> b) {
        List<String> out = new ArrayList<>(a);
        out.addAll(b);
        return out;
    }

    private static List<Map<String, Object>> describe(List<String> codes, Map<String, OverrideInput> wanted,
                                                      Map<String, Existing> existing) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String code : codes) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("permission", code);
            if (wanted != null) {
                OverrideInput in = wanted.get(code);
                m.put("effect", in.effect());
                m.put("reason", in.reason());
                m.put("expiresAt", Objects.toString(in.expiresAt(), null));
            } else if (existing != null) {
                Existing ex = existing.get(code);
                m.put("effect", ex.effect());
                m.put("reason", ex.reason());
            }
            out.add(m);
        }
        return out;
    }

    private static List<Map<String, Object>> describeChanged(List<String> codes, Map<String, OverrideInput> wanted,
                                                             Map<String, Existing> existing) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String code : codes) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("permission", code);
            m.put("before", existing.get(code).effect() + (existing.get(code).expiresAt() == null ? "" : " until " + existing.get(code).expiresAt()));
            OverrideInput in = wanted.get(code);
            m.put("after", in.effect() + (in.expiresAt() == null ? "" : " until " + in.expiresAt()));
            m.put("reason", in.reason());
            out.add(m);
        }
        return out;
    }

    private static String summary(String email, List<String> added, List<String> changed, List<String> removed,
                                  Map<String, OverrideInput> wanted, Map<String, Existing> existing) {
        List<String> parts = new ArrayList<>();
        for (String c : added) parts.add((PermissionOverrides.GRANT.equals(wanted.get(c).effect()) ? "gave " : "removed ") + c);
        for (String c : changed) parts.add("changed " + c + " to " + (PermissionOverrides.GRANT.equals(wanted.get(c).effect()) ? "give" : "remove"));
        for (String c : removed) parts.add("cleared the " + (PermissionOverrides.GRANT.equals(existing.get(c).effect()) ? "extra " : "removed ") + c);
        return "Individual permissions for " + email + ": " + String.join("; ", parts);
    }
}
