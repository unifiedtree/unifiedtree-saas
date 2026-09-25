package com.hrms.api.access;

import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Loads the facts {@link AccessPolicy} needs (who is acting, whether they or
 * the target are an OWNER, what they hold, how risky each permission is) and
 * clears cached permission sets after a change. Every read runs on the
 * request's connection, so RLS scopes it to the caller's workspace.
 *
 * <p>The actor's permissions are resolved fresh from the database (roles +
 * employee baseline + their own overrides), not from their token, so a
 * permission taken away from an admin a minute ago cannot still be handed on.
 */
@Service
public class AccessGuard {

    private final JdbcTemplate jdbc;
    private final EmployeeBaselinePermissions baseline;
    private final PermissionChecker permissionChecker;

    public AccessGuard(JdbcTemplate jdbc, EmployeeBaselinePermissions baseline, PermissionChecker permissionChecker) {
        this.jdbc = jdbc;
        this.baseline = baseline;
        this.permissionChecker = permissionChecker;
    }

    /** The signed-in person making the change. */
    public AccessPolicy.Actor actor(UUID actorId) {
        UUID id = actorId != null ? actorId : TenantContext.getUserId();
        if (id == null) throw AccessPolicy.refused("No signed-in user.", "NOT_AUTHENTICATED");
        return new AccessPolicy.Actor(id, isOwner(id), Set.copyOf(effectivePermissions(id)));
    }

    /** Whether this person holds the built-in OWNER role in this workspace. */
    public boolean isOwner(UUID userId) {
        Integer n = jdbc.queryForObject("""
                SELECT count(*) FROM rbac.user_roles ur
                  JOIN rbac.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = ? AND r.tenant_id IS NULL AND r.code = 'OWNER'
                """, Integer.class, userId);
        return n != null && n > 0;
    }

    /** Permissions granted by this person's roles (no baseline, no overrides). */
    public List<String> rolePermissions(UUID userId) {
        return jdbc.queryForList("""
                SELECT DISTINCT rp.permission_code
                  FROM rbac.user_roles ur
                  JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                 WHERE ur.user_id = ?
                """, String.class, userId);
    }

    /** The credential's employee id, or null when the login has no employee record. */
    public UUID employeeId(UUID userId) {
        List<UUID> rows = jdbc.queryForList(
                "SELECT employee_id FROM auth.user_credentials WHERE id = ?", UUID.class, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Roles + employee baseline + overrides: exactly what their next sign-in will carry. */
    public List<String> effectivePermissions(UUID userId) {
        return baseline.effectiveFor(rolePermissions(userId), employeeId(userId), userId);
    }

    /** The employee baseline (what every employee holds), for showing where a permission comes from. */
    public Set<String> baselinePermissions() {
        return baseline.baseline();
    }

    /** Risk level of every catalogue permission. */
    public Map<String, String> riskByCode() {
        Map<String, String> out = new HashMap<>();
        jdbc.query("SELECT code, risk_level FROM rbac.permissions",
                rs -> { out.put(rs.getString(1), rs.getString(2)); });
        return out;
    }

    /** Permission codes a role grants. */
    public List<String> permissionsOfRole(UUID roleId) {
        return jdbc.queryForList(
                "SELECT permission_code FROM rbac.role_permissions WHERE role_id = ?", String.class, roleId);
    }

    /** Whether this person holds the role. */
    public boolean holdsRole(UUID userId, UUID roleId) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM rbac.user_roles WHERE user_id = ? AND role_id = ?",
                Integer.class, userId, roleId);
        return n != null && n > 0;
    }

    /** Whether the credential exists in this workspace (RLS hides other workspaces). */
    public boolean userExists(UUID userId) {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM auth.user_credentials WHERE id = ?", Integer.class, userId);
        return n != null && n > 0;
    }

    /**
     * Drop cached permission sets after a change, so the {@code @perm} checks
     * and the next {@code /me} see it straight away (the JWT follows at the
     * person's next sign-in or token refresh).
     */
    public void evict(UUID userId) {
        permissionChecker.evictUser(TenantContext.getTenantId(), userId);
        baseline.invalidate();
    }
}
