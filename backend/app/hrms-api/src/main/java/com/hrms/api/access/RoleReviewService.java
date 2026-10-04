package com.hrms.api.access;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * "N new permissions available — Review" on Roles &amp; permissions (V143.69):
 * the count per business-made role, the list for one role, and "Mark as
 * reviewed". Which permissions count is {@link NewPermissions}'s rule.
 *
 * <p>The two dates are new columns ({@code rbac.permissions.added_at},
 * {@code rbac.roles.permissions_reviewed_at}) that production applies by hand,
 * so they are read with JDBC only after a catalogue check: until V143.69 is
 * applied the reads answer "no new permissions" and marking a role answers
 * FEATURE_NOT_READY (the page never offers it then). Every read runs in a
 * transaction, on the request's connection, so RLS scopes it to the workspace;
 * the queries also name the tenant.
 */
@Service
public class RoleReviewService {

    private final JdbcTemplate jdbc;

    public RoleReviewService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** How many permissions are new for one business-made role; only roles with at least one are listed. */
    public record RoleCount(UUID roleId, int newPermissions) {}

    /** A new permission, with its catalogue text and when it was added. */
    public record NewPermission(String code, String displayName, String module, String description,
                                String riskLevel, String warning, Instant addedAt) {}

    /** The workspace's business-made roles that have new permissions, with how many. */
    @Transactional(readOnly = true)
    public List<RoleCount> counts() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null || !ready()) return List.of();
        List<NewPermissions.Catalogued> dated = datedPermissions();
        if (dated.isEmpty()) return List.of();
        List<NewPermissions.RoleDates> roles = jdbc.query("""
                SELECT id, tenant_id, created_at, permissions_reviewed_at
                  FROM rbac.roles
                 WHERE tenant_id = ?
                 ORDER BY code
                """, (rs, i) -> roleDates(rs), tenantId);
        if (roles.isEmpty()) return List.of();
        Map<UUID, Set<String>> held = new HashMap<>();
        jdbc.query("""
                SELECT rp.role_id, rp.permission_code
                  FROM rbac.role_permissions rp
                  JOIN rbac.roles r ON r.id = rp.role_id
                 WHERE r.tenant_id = ?
                """, rs -> {
            held.computeIfAbsent(rs.getObject(1, UUID.class), k -> new HashSet<>()).add(rs.getString(2));
        }, tenantId);
        Set<String> active = activeModuleKeys(tenantId);
        List<RoleCount> out = new ArrayList<>();
        for (NewPermissions.RoleDates role : roles) {
            int n = NewPermissions.forRole(role, dated, held.getOrDefault(role.id(), Set.of()), active).size();
            if (n > 0) out.add(new RoleCount(role.id(), n));
        }
        return out;
    }

    /** The new permissions of one role: empty for a built-in role, or before V143.69 is applied. */
    @Transactional(readOnly = true)
    public List<NewPermission> forRole(UUID roleId) {
        UUID tenantId = TenantContext.requireTenantId();
        if (!ready()) {
            requireVisibleRole(roleId, tenantId);
            return List.of();
        }
        List<NewPermissions.RoleDates> found = jdbc.query("""
                SELECT id, tenant_id, created_at, permissions_reviewed_at
                  FROM rbac.roles
                 WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?)
                """, (rs, i) -> roleDates(rs), roleId, tenantId);
        if (found.isEmpty()) throw new ResourceNotFoundException("Role not found");
        NewPermissions.RoleDates role = found.get(0);
        if (role.tenantId() == null) return List.of();
        Set<String> held = new HashSet<>(jdbc.queryForList(
                "SELECT permission_code FROM rbac.role_permissions WHERE role_id = ?", String.class, roleId));
        return NewPermissions.forRole(role, datedPermissions(), held, activeModuleKeys(tenantId)).stream()
                .map(p -> new NewPermission(p.code(), p.displayName(), p.module(), p.description(),
                        p.riskLevel(), p.warning(), p.addedAt()))
                .toList();
    }

    /**
     * "Mark as reviewed": the role's notice goes until another permission is
     * added. Changes nobody's access. Built-in roles have nothing to review.
     */
    @Transactional
    public Instant markReviewed(UUID roleId) {
        UUID tenantId = TenantContext.requireTenantId();
        if (!ready()) throw new FeatureNotReady();
        UUID owner = requireVisibleRole(roleId, tenantId);
        if (owner == null) {
            throw new HrmsException("Built-in roles get new permissions automatically, so there is nothing to review.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "SYSTEM_ROLE_LOCKED");
        }
        List<Timestamp> at = FeatureNotReady.guard(() -> jdbc.queryForList("""
                UPDATE rbac.roles SET permissions_reviewed_at = now()
                 WHERE id = ? AND tenant_id = ?
                RETURNING permissions_reviewed_at
                """, Timestamp.class, roleId, tenantId));
        if (at.isEmpty()) throw new ResourceNotFoundException("Role not found");
        return at.get(0).toInstant();
    }

    // ── reads ────────────────────────────────────────────────────────────────

    /** Both V143.69 columns are there (a catalogue read; never fails, so safe inside a transaction). */
    boolean ready() {
        Boolean has = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM pg_attribute
                                WHERE attrelid = to_regclass('rbac.permissions')
                                  AND attname = 'added_at' AND NOT attisdropped)
                   AND EXISTS (SELECT 1 FROM pg_attribute
                                WHERE attrelid = to_regclass('rbac.roles')
                                  AND attname = 'permissions_reviewed_at' AND NOT attisdropped)
                """, Boolean.class);
        return Boolean.TRUE.equals(has);
    }

    /** The dated catalogue rows (permissions added since dating began). */
    private List<NewPermissions.Catalogued> datedPermissions() {
        return jdbc.query("""
                SELECT code, display_name, module, description, risk_level, warning, added_at
                  FROM rbac.permissions
                 WHERE added_at IS NOT NULL
                 ORDER BY module, code
                """, (rs, i) -> new NewPermissions.Catalogued(rs.getString(1), rs.getString(2), rs.getString(3),
                rs.getString(4), rs.getString(5), rs.getString(6), instant(rs.getTimestamp(7))));
    }

    /** The workspace's ACTIVE module keys (platform.tenant_modules), read as Users &amp; access reads them. */
    private Set<String> activeModuleKeys(UUID tenantId) {
        return new HashSet<>(jdbc.queryForList(
                "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE'",
                String.class, tenantId));
    }

    /** The role's tenant (null for a built-in role); 404 when this workspace can't see it. */
    private UUID requireVisibleRole(UUID roleId, UUID tenantId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT tenant_id FROM rbac.roles WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?)",
                roleId, tenantId);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Role not found");
        Object t = rows.get(0).get("tenant_id");
        if (t == null) return null;
        return t instanceof UUID u ? u : UUID.fromString(t.toString());
    }

    private static NewPermissions.RoleDates roleDates(ResultSet rs) throws SQLException {
        return new NewPermissions.RoleDates(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                instant(rs.getTimestamp(3)), instant(rs.getTimestamp(4)));
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
