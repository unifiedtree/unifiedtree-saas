package com.unifiedtree.saas.trial;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Look up the workspace-admin users of a tenant. Used by the trial lifecycle
 * job to fan out "trial ending" / "trial expired" notifications to everyone
 * who can actually act on them.
 *
 * <p>The returned UUIDs are {@code auth.user_credentials.employee_id} — that
 * matches the convention used elsewhere for {@code notif.notifications.user_id}
 * (see {@code DomainEventListener}), so notifications appear in the right
 * user's inbox on the mobile client without any extra plumbing.
 *
 * <p>Signup grants BOTH {@code SUPER_ADMIN} and {@code OWNER} to the workspace
 * admin, so we look up either. {@code DISTINCT} covers the overlap.
 */
@Component
public class TenantAdminLookup {

    private static final Logger log = LoggerFactory.getLogger(TenantAdminLookup.class);

    // Same UUIDs SaasWriter grants at signup.
    private static final UUID SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OWNER_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000010");

    private final JdbcTemplate jdbc;

    public TenantAdminLookup(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Employee IDs (the id notifications key off) + email addresses of every
     * active admin.
     *
     * <p>An empty return means "the query ran and found no admins" — that
     * happens legitimately for a bare-bones test tenant. A query error is
     * rethrown so ops sees an ERROR-level stack in the log AND the caller can
     * distinguish "no admins exist" from "admin lookup crashed" (previously
     * both surfaced as an empty list and a benign WARN — the halt-notification
     * pipeline broke silently for weeks in that state per the verify finding).
     * Callers wrap the whole notification loop in their own try/catch so a
     * rethrow here doesn't break unrelated tenants in a sweep.
     */
    public List<AdminUser> findAdminUsers(UUID tenantId) {
        if (tenantId == null) return List.of();
        try {
            // No display_name column on auth.user_credentials — the employee
            // table owns names. Email address alone is fine for the mail-to
            // header; the toName field in EmailMessage is nullable.
            return jdbc.query("""
                    SELECT DISTINCT uc.employee_id, uc.email
                      FROM rbac.user_roles ur
                      JOIN auth.user_credentials uc ON uc.id = ur.user_id
                     WHERE ur.tenant_id = ?
                       AND ur.role_id IN (?, ?)
                       AND uc.employee_id IS NOT NULL
                       AND uc.is_active = TRUE
                     ORDER BY uc.email
                    """,
                    (rs, n) -> new AdminUser(
                            rs.getObject("employee_id", UUID.class),
                            rs.getString("email"),
                            null),
                    tenantId, SUPER_ADMIN_ROLE_ID, OWNER_ROLE_ID);
        } catch (RuntimeException ex) {
            log.error("admin lookup FAILED for tenant={} — notifications will not be sent. "
                      + "Common causes: RLS tenant not bound on this thread, ut_app permission "
                      + "regression on rbac/auth, or DB connectivity.",
                    tenantId, ex);
            throw ex;
        }
    }

    public record AdminUser(UUID employeeId, String email, String displayName) {}
}
