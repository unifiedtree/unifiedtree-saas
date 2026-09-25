package com.hrms.api.access;

import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.service.RbacService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Roles & permissions (/v1/rbac): custom roles (create, duplicate, rename,
 * change permissions, delete) and giving roles to people, with the same
 * levels as Users &amp; access ({@link AccessPolicy}) and an audit row for
 * every change. Built-in roles stay read-only (RbacService refuses them).
 */
@Service
public class RoleAdminService {

    private static final Pattern CODE = Pattern.compile("^[A-Z][A-Z0-9_]{1,49}$");

    private final RbacService rbac;
    private final RoleRepository roleRepo;
    private final UserRoleRepository userRoleRepo;
    private final WorkspaceAccessService workspaceAccess;
    private final AccessGuard guard;
    private final AccessAudit audit;
    private final JdbcTemplate jdbc;

    public RoleAdminService(RbacService rbac, RoleRepository roleRepo, UserRoleRepository userRoleRepo,
                            WorkspaceAccessService workspaceAccess, AccessGuard guard, AccessAudit audit,
                            JdbcTemplate jdbc) {
        this.rbac = rbac;
        this.roleRepo = roleRepo;
        this.userRoleRepo = userRoleRepo;
        this.workspaceAccess = workspaceAccess;
        this.guard = guard;
        this.audit = audit;
        this.jdbc = jdbc;
    }

    /** A catalogue row with its plain-English description, risk level and warning. */
    public record PermissionDto(String code, String displayName, String module, String description,
                                String riskLevel, String warning) {}

    @Transactional(readOnly = true)
    public List<PermissionDto> catalogue() {
        return jdbc.query("""
                SELECT code, display_name, module, description, risk_level, warning
                  FROM rbac.permissions ORDER BY code
                """, (rs, i) -> new PermissionDto(rs.getString(1), rs.getString(2), rs.getString(3),
                rs.getString(4), rs.getString(5), rs.getString(6)));
    }

    // ── custom roles ─────────────────────────────────────────────────────────

    /** New custom role, empty or copied from {@code cloneFromRoleId}. */
    @Transactional
    public Role create(String code, String displayName, String description, UUID cloneFromRoleId, UUID actorId) {
        AccessPolicy.Actor actor = guard.actor(actorId);
        String cleanCode = validateCode(code);
        String name = validateName(displayName);
        Role source = null;
        List<String> copied = List.of();
        if (cloneFromRoleId != null) {
            source = roleRepo.findById(cloneFromRoleId).orElseThrow(() ->
                    new ResourceNotFoundException("The role to copy was not found"));
            copied = guard.permissionsOfRole(source.getId());
            // Copying a role hands its permissions to whoever gets the copy, so the
            // same rule applies as giving them: you can only copy what you hold.
            AccessPolicy.requireCanGrantPermissions(actor, copied, guard.riskByCode());
        }
        Role role = rbac.createCustomRole(cleanCode, name, blankToNull(description), cloneFromRoleId);
        Map<String, Object> diff = new LinkedHashMap<>();
        diff.put("code", cleanCode);
        diff.put("name", name);
        if (source != null) {
            diff.put("copiedFrom", source.getCode());
            diff.put("permissions", new TreeSet<>(copied));
        }
        audit.record(actor.userId(), "CREATE", "ROLE", role.getId(),
                source == null ? "Created the custom role " + name
                        : "Duplicated the " + source.getDisplayName() + " role as " + name + " (" + copied.size() + " permissions)",
                diff);
        return role;
    }

    /** "Duplicate role": copy any visible role (built-in or custom) into a new custom role. */
    @Transactional
    public Role duplicate(UUID sourceRoleId, String displayName, String code, String description, UUID actorId) {
        String name = validateName(displayName);
        String derived = code == null || code.isBlank() ? codeFrom(name) : code;
        return create(derived, name, description, sourceRoleId, actorId);
    }

    @Transactional
    public Role update(UUID roleId, String displayName, String description, UUID actorId) {
        Role before = roleRepo.findById(roleId).orElseThrow(() -> new ResourceNotFoundException("Role not found"));
        String oldName = before.getDisplayName();
        String oldDescription = before.getDescription();
        Role role = rbac.updateCustomRole(roleId, validateName(displayName), blankToNull(description));
        Map<String, Object> diff = new LinkedHashMap<>();
        diff.put("name", Map.of("before", String.valueOf(oldName), "after", role.getDisplayName()));
        diff.put("description", Map.of("before", String.valueOf(oldDescription), "after", String.valueOf(role.getDescription())));
        audit.record(guard.actor(actorId).userId(), "UPDATE", "ROLE", roleId,
                "Renamed or re-described the role " + role.getDisplayName(), diff);
        return role;
    }

    @Transactional
    public void delete(UUID roleId, UUID actorId) {
        AccessPolicy.Actor actor = guard.actor(actorId);
        Role role = roleRepo.findById(roleId).orElseThrow(() -> new ResourceNotFoundException("Role not found"));
        AccessPolicy.requireNotOwnRole(guard.holdsRole(actor.userId(), roleId), role.getDisplayName());
        int holders = userRoleRepo.findAllByRoleId(roleId).size();
        List<String> perms = guard.permissionsOfRole(roleId);
        rbac.deleteCustomRole(roleId);
        Map<String, Object> diff = new LinkedHashMap<>();
        diff.put("code", role.getCode());
        diff.put("name", role.getDisplayName());
        diff.put("peopleWhoHeldIt", holders);
        diff.put("permissions", new TreeSet<>(perms));
        audit.record(actor.userId(), "DELETE", "ROLE", roleId,
                "Deleted the role " + role.getDisplayName() + " (held by " + holders + (holders == 1 ? " person)" : " people)"), diff);
    }

    /**
     * Replace a custom role's permissions. Adding permissions counts as giving
     * them to everyone who holds the role, so the actor must hold each one,
     * CRITICAL ones need the owner, and HIGH / CRITICAL need {@code acknowledgeRisk}.
     */
    @Transactional
    public List<String> setPermissions(UUID roleId, Collection<String> codes, boolean acknowledgeRisk, UUID actorId) {
        AccessPolicy.Actor actor = guard.actor(actorId);
        Role role = roleRepo.findById(roleId).orElseThrow(() -> new ResourceNotFoundException("Role not found"));
        if (role.isSystemRole() || role.getTenantId() == null) {
            throw new HrmsException("Built-in roles can’t be changed. Duplicate it to make a version you can edit.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "SYSTEM_ROLE_LOCKED");
        }
        AccessPolicy.requireNotOwnRole(guard.holdsRole(actor.userId(), roleId), role.getDisplayName());
        Set<String> wanted = new LinkedHashSet<>();
        if (codes != null) for (String c : codes) if (c != null && !c.isBlank()) wanted.add(c.trim());
        Set<String> current = new TreeSet<>(guard.permissionsOfRole(roleId));
        Set<String> added = new TreeSet<>(wanted);
        added.removeAll(current);
        Set<String> removed = new TreeSet<>(current);
        removed.removeAll(wanted);
        Map<String, String> risk = guard.riskByCode();
        AccessPolicy.requireCanGrantPermissions(actor, added, risk);
        AccessPolicy.requireRiskAcknowledged(added, risk, acknowledgeRisk);
        rbac.setRolePermissions(roleId, new ArrayList<>(wanted));
        if (!added.isEmpty() || !removed.isEmpty()) {
            Map<String, Object> diff = new LinkedHashMap<>();
            diff.put("role", role.getCode());
            diff.put("added", added);
            diff.put("removed", removed);
            audit.record(actor.userId(), AccessAudit.PERMISSION_CHANGE, "ROLE", roleId,
                    "Changed the " + role.getDisplayName() + " role: " + added.size() + " added, " + removed.size() + " removed",
                    diff);
        }
        return new ArrayList<>(new TreeSet<>(wanted));
    }

    // ── giving roles to people (Roles & permissions → Who has which role) ────

    @Transactional
    public void grant(UUID userId, UUID roleId, UUID actorId) {
        Role role = roleRepo.findById(roleId).orElseThrow(() -> new ResourceNotFoundException("Role not found"));
        workspaceAccess.assignRole(TenantContext.requireTenantId(), userId, role.getCode(), actorId);
    }

    @Transactional
    public void revoke(UUID userId, UUID roleId, UUID actorId) {
        Role role = roleRepo.findById(roleId).orElseThrow(() -> new ResourceNotFoundException("Role not found"));
        workspaceAccess.revokeRole(TenantContext.requireTenantId(), userId, role.getCode(), actorId);
    }

    /** A person's roles and the permissions they end up with (roles + employee baseline + overrides). */
    @Transactional(readOnly = true)
    public RbacService.UserRolesView userRoles(UUID userId) {
        RbacService.UserRolesView base = rbac.getUserRoles(userId);
        List<String> effective = new ArrayList<>(new TreeSet<>(guard.effectivePermissions(userId)));
        return new RbacService.UserRolesView(userId, base.roles(), effective);
    }

    // ── validation ───────────────────────────────────────────────────────────

    private String validateCode(String code) {
        String c = code == null ? "" : code.trim().toUpperCase().replaceAll("[^A-Z0-9_]+", "_");
        if (!CODE.matcher(c).matches()) {
            throw new HrmsException("The role code must start with a letter and use only A–Z, 0–9 and _ (2 to 50 characters).",
                    HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_ROLE_CODE");
        }
        Integer builtIn = jdbc.queryForObject(
                "SELECT count(*) FROM rbac.roles WHERE tenant_id IS NULL AND code = ?", Integer.class, c);
        if (builtIn != null && builtIn > 0) {
            throw new HrmsException("That code belongs to a built-in role. Choose another code.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_CODE_DUPLICATE");
        }
        if (roleRepo.existsByTenantIdAndCode(TenantContext.requireTenantId(), c)) {
            throw new HrmsException("A role with the code " + c + " already exists in this workspace.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_CODE_DUPLICATE");
        }
        return c;
    }

    private static String validateName(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) throw new HrmsException("Give the role a name.", HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_NAME_REQUIRED");
        if (n.length() > 100) throw new HrmsException("Keep the role name under 100 characters.", HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_NAME_TOO_LONG");
        return n;
    }

    /** "Senior manager" → "SENIOR_MANAGER". */
    static String codeFrom(String name) {
        String c = name.trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (c.isEmpty() || !Character.isLetter(c.charAt(0))) c = "ROLE_" + c;
        return c.length() > 50 ? c.substring(0, 50) : c;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
