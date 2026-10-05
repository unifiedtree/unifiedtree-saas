package com.hrms.api.access;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.service.PersonalPagesService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Roles &amp; permissions › Personal pages (V143.90): each role's switch for
 * My work and the other "My …" pages, built-in roles included. The rule is
 * {@link PersonalPagesService}'s; this lists every role with its effective
 * value and changes one.
 *
 * <p>Only the workspace OWNER changes a setting (read fresh from the database,
 * not from their token); anyone who may open Roles &amp; permissions may read
 * them. A setting is stored only when it differs from the role's default, so
 * switching a role back to its default removes its row. Every change writes an
 * audit row in the same transaction. Writes name the workspace and RLS keeps
 * them in it; a role another workspace made is "not found".
 */
@Service
public class RolePersonalPagesService {

    private final PersonalPagesService rule;
    private final AccessGuard guard;
    private final AccessAudit audit;
    private final JdbcTemplate jdbc;

    public RolePersonalPagesService(PersonalPagesService rule, AccessGuard guard, AccessAudit audit, JdbcTemplate jdbc) {
        this.rule = rule;
        this.guard = guard;
        this.audit = audit;
        this.jdbc = jdbc;
    }

    /** One role's setting: what it is now, whether the owner changed it, and the role's default. */
    public record RoleSetting(UUID roleId, String code, String displayName, boolean systemRole,
                              boolean enabled, boolean overridden, boolean defaultEnabled) {}

    /** Every role's setting, whether the caller may change them, and whether saving works yet (V143.90 applied). */
    public record Settings(boolean canEdit, boolean ready, List<RoleSetting> roles) {}

    @Transactional(readOnly = true)
    public Settings list(UUID actorId) {
        UUID tenantId = TenantContext.requireTenantId();
        Map<UUID, Boolean> overrides = rule.overrides(tenantId);
        List<RoleSetting> roles = jdbc.query("""
                SELECT id, code, display_name, is_system
                  FROM rbac.roles
                 WHERE (tenant_id IS NULL OR tenant_id = ?)
                   AND code NOT LIKE 'PLATFORM\\_%'
                 ORDER BY code
                """, (rs, i) -> setting(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                rs.getBoolean(4), overrides.get(rs.getObject(1, UUID.class))), tenantId);
        return new Settings(isOwner(actorId), rule.ready(), roles);
    }

    /** Turn personal pages on or off for the people holding this role. Owner only. */
    @Transactional
    public RoleSetting set(UUID roleId, Boolean enabled, UUID actorId) {
        UUID tenantId = TenantContext.requireTenantId();
        if (enabled == null) {
            throw new HrmsException("Say whether personal pages are on or off.", HttpStatus.BAD_REQUEST, "ENABLED_REQUIRED");
        }
        UUID actor = actorId != null ? actorId : TenantContext.getUserId();
        if (!isOwner(actor)) {
            throw AccessPolicy.refused("Only the workspace owner can change who sees personal pages.", "OWNER_ONLY");
        }
        List<Map<String, Object>> found = jdbc.queryForList("""
                SELECT code, display_name, is_system FROM rbac.roles
                 WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?) AND code NOT LIKE 'PLATFORM\\_%'
                """, roleId, tenantId);
        if (found.isEmpty()) throw new ResourceNotFoundException("Role not found");
        String code = (String) found.get(0).get("code");
        String name = (String) found.get(0).get("display_name");
        boolean system = Boolean.TRUE.equals(found.get(0).get("is_system"));
        if (!rule.ready()) throw new FeatureNotReady();

        Boolean before = rule.overrides(tenantId).get(roleId);
        boolean wasOn = before != null ? before : PersonalPagesService.defaultFor(code);
        boolean on = enabled;
        if (on == PersonalPagesService.defaultFor(code)) {
            jdbc.update("DELETE FROM rbac.role_personal_pages WHERE tenant_id = ? AND role_id = ?", tenantId, roleId);
        } else {
            jdbc.update("""
                    INSERT INTO rbac.role_personal_pages (tenant_id, role_id, enabled, updated_by, updated_at)
                    VALUES (?, ?, ?, ?, now())
                    ON CONFLICT (tenant_id, role_id)
                    DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
                    """, tenantId, roleId, on, actor);
        }
        if (wasOn != on) {
            Map<String, Object> diff = new LinkedHashMap<>();
            diff.put("personalPages", Map.of("before", wasOn, "after", on));
            audit.record(actor, "UPDATE", "ROLE", roleId,
                    "Turned personal pages " + (on ? "on" : "off") + " for the " + name + " role", diff);
        }
        return setting(roleId, code, name, system, on == PersonalPagesService.defaultFor(code) ? null : on);
    }

    private boolean isOwner(UUID actorId) {
        return actorId != null && guard.isOwner(actorId);
    }

    private static RoleSetting setting(UUID id, String code, String name, boolean system, Boolean override) {
        boolean def = PersonalPagesService.defaultFor(code);
        return new RoleSetting(id, code, name, system, override != null ? override : def, override != null, def);
    }
}
