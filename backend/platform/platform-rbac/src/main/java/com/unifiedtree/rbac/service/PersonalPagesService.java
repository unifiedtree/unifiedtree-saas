package com.unifiedtree.rbac.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Personal pages per role (V143.90): whether the people holding a role see My
 * work and every "My …" view (My leave, My claims, My reviews, My goals, …),
 * the "for yourself" quick actions, and the same screens in the phone app.
 *
 * <p>The rule, the same everywhere it is read:
 * <ul>
 *   <li>a role's setting is the workspace's override when the owner set one,
 *       else OFF for {@link #OFF_BY_DEFAULT} (the roles that run the
 *       workspace) and ON for every other role, built-in or made by the
 *       business;</li>
 *   <li>a person sees the personal pages unless they hold at least one role
 *       whose setting is OFF (no roles at all: shown).</li>
 * </ul>
 * With no overrides that is exactly the role rule the web and the app applied
 * before this existed (their {@code adminRole}), so nothing changes until an
 * owner changes a role.
 *
 * <p>It decides what the menus show, never what the server allows: each
 * endpoint keeps checking its own permission.
 *
 * <p>The override table is applied to production by hand, later, so every read
 * first checks the table is there and readable (a catalogue read that cannot
 * fail, so it is safe inside the sign-in transaction); until then there are
 * no overrides and the default rule answers. Reads run on the request's
 * connection, so RLS scopes them to the workspace; the queries also name it.
 */
@Service
public class PersonalPagesService {

    /** OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN: off unless the owner turns them on (the web's ADMIN_ROLES). */
    public static final Set<String> OFF_BY_DEFAULT = Set.of("OWNER", "SUPER_ADMIN", "COMPANY_ADMIN", "ADMIN");

    private final JdbcTemplate jdbc;

    public PersonalPagesService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** One role's setting in a workspace: the role, and the override the owner set (null = none). */
    public record RoleSetting(UUID roleId, String code, Boolean override) {
        /** The override when there is one, else the role's default. */
        public boolean enabled() {
            return override != null ? override : defaultFor(code);
        }

        public boolean overridden() {
            return override != null;
        }
    }

    /** A role's default: off for {@link #OFF_BY_DEFAULT}, on for every other role. */
    public static boolean defaultFor(String roleCode) {
        return roleCode == null || !OFF_BY_DEFAULT.contains(roleCode);
    }

    /** Shown unless at least one of these roles is off. */
    public static boolean shown(Collection<RoleSetting> held) {
        return held == null || held.stream().allMatch(RoleSetting::enabled);
    }

    /** Whether a person holding these roles sees the personal pages in this workspace. */
    public boolean forRoles(UUID tenantId, Collection<UUID> roleIds) {
        if (roleIds == null || roleIds.isEmpty()) return true;
        return shown(settingsOf(tenantId, roleIds));
    }

    /** The settings of these roles (roles this workspace can't see are left out). */
    public List<RoleSetting> settingsOf(UUID tenantId, Collection<UUID> roleIds) {
        if (roleIds == null || roleIds.isEmpty()) return List.of();
        List<UUID> ids = new ArrayList<>(new LinkedHashSet<>(roleIds));
        String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>(ids);
        args.add(tenantId);
        List<RoleSetting> roles = jdbc.query(
                "SELECT id, code FROM rbac.roles WHERE id IN (" + marks + ") AND (tenant_id IS NULL OR tenant_id = ?)",
                (rs, i) -> new RoleSetting(rs.getObject(1, UUID.class), rs.getString(2), null),
                args.toArray());
        if (roles.isEmpty()) return roles;
        Map<UUID, Boolean> overrides = overrides(tenantId);
        if (overrides.isEmpty()) return roles;
        return roles.stream().map(r -> new RoleSetting(r.roleId(), r.code(), overrides.get(r.roleId()))).toList();
    }

    /** The overrides the workspace set, by role id. Empty before V143.90 is applied. */
    public Map<UUID, Boolean> overrides(UUID tenantId) {
        if (tenantId == null || !ready()) return Map.of();
        Map<UUID, Boolean> out = new HashMap<>();
        jdbc.query("SELECT role_id, enabled FROM rbac.role_personal_pages WHERE tenant_id = ?",
                rs -> { out.put(rs.getObject(1, UUID.class), rs.getBoolean(2)); }, tenantId);
        return out;
    }

    /**
     * The V143.90 table is there and this connection may read it. A catalogue
     * read that never fails, so it is safe inside a transaction: a missing
     * table or grant must not abort a sign-in.
     */
    public boolean ready() {
        Boolean ok = jdbc.queryForObject("""
                SELECT CASE WHEN to_regclass('rbac.role_personal_pages') IS NULL THEN false
                            ELSE has_table_privilege(to_regclass('rbac.role_personal_pages'), 'SELECT') END
                """, Boolean.class);
        return Boolean.TRUE.equals(ok);
    }
}
