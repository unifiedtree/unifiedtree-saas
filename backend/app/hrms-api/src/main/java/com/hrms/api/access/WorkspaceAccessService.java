package com.hrms.api.access;

import com.hrms.api.invitation.InvitationService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateWorkforceEmployeeRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * Workspace Users & Access (Prompt 10). Lists every user in the tenant with
 * their roles grouped by module, manages role grants, and invites new users —
 * reusing the Prompt 9 {@link InvitationService} for the invite/email path.
 *
 * <p>Module model: a role's "module" is derived from the modules its
 * permissions belong to ({@code rbac.permissions.module}). Module access is
 * tenant-level ({@code platform.tenant_modules}). Assigning a role whose gated
 * module is not active is rejected with MODULE_NOT_ACTIVE.
 */
@Service
public class WorkspaceAccessService {

    // perm.module -> tenant_modules.module_key. Modules NOT here are core/always-on.
    private static final Map<String, String> PERM_MODULE_TO_GATED_KEY = Map.of(
        "hrms", "hrms",
        "attendance", "attendance",
        "leave", "leave",
        "crm", "crm",
        "accounts", "accounts"
    );
    // Priority for picking a role's single display module.
    private static final List<String> MODULE_PRIORITY =
        List.of("hrms", "crm", "accounts", "attendance", "leave");

    // Who may give which role is decided by AccessPolicy (the "levels" rules:
    // only what you hold, CRITICAL and OWNER / SUPER_ADMIN only by an OWNER,
    // never your own access). Platform roles and the legacy MANAGER role are
    // never offered.

    private final UserCredentialsRepository credRepo;
    private final UserRoleRepository userRoleRepo;
    private final RoleRepository roleRepo;
    private final InvitationService invitationService;
    private final WorkforceEmployeeService workforceService;
    private final JdbcTemplate jdbc;
    private final AccessGuard guard;
    private final AccessAudit audit;

    public WorkspaceAccessService(UserCredentialsRepository credRepo,
                                  UserRoleRepository userRoleRepo,
                                  RoleRepository roleRepo,
                                  InvitationService invitationService,
                                  WorkforceEmployeeService workforceService,
                                  JdbcTemplate jdbc,
                                  AccessGuard guard,
                                  AccessAudit audit) {
        this.credRepo = credRepo;
        this.userRoleRepo = userRoleRepo;
        this.roleRepo = roleRepo;
        this.invitationService = invitationService;
        this.workforceService = workforceService;
        this.jdbc = jdbc;
        this.guard = guard;
        this.audit = audit;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record RoleDto(String roleCode, String displayName, String module) {}

    public record WorkspaceUserDto(
        UUID userId, String email, UUID employeeId,
        String firstName, String lastName, String status,
        OffsetDateTime lastLoginAt, List<RoleDto> roles,
        // Latest invitation email delivery state: PENDING | SENT | FAILED | null (never invited)
        String invitationSendStatus, String lastSendError) {}

    /**
     * A role the Manage access drawer lists. {@code canGrant} / {@code grantBlockedReason}
     * say whether the signed-in admin may give it (AccessPolicy), and
     * {@code riskLevel} is the highest risk among its permissions, so the UI
     * can ask for confirmation before giving a HIGH / CRITICAL role.
     */
    public record AssignableRoleDto(
        String roleCode, String displayName, String module, boolean moduleActive,
        String description, boolean systemRole, String riskLevel,
        boolean canGrant, String grantBlockedReason, int permissionCount) {}

    public record InviteRequest(
        String email, String firstName, String lastName,
        List<String> roleCodes, Boolean createEmployee, UUID companyId) {}

    // ── Read ────────────────────────────────────────────────────────────────

    @Transactional
    public List<WorkspaceUserDto> listWorkspaceUsers(UUID tenantId) {
        bindTenant(tenantId);

        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT uc.id, uc.email, uc.employee_id, uc.is_active, uc.invited_at,
                   uc.password_hash, uc.last_login_at,
                   e.first_name, e.last_name,
                   it.send_status, it.last_send_error
              FROM auth.user_credentials uc
              LEFT JOIN hrms.employees e ON e.id = uc.employee_id
              LEFT JOIN LATERAL (
                  SELECT t.send_status, t.last_send_error
                    FROM auth.invitation_tokens t
                   WHERE t.user_id = uc.id AND t.purpose = 'INVITATION'
                   ORDER BY t.created_at DESC
                   LIMIT 1
              ) it ON TRUE
             ORDER BY uc.email
            """);

        Map<UUID, RoleDto> roleCache = roleDtoCache();

        List<WorkspaceUserDto> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            UUID userId = (UUID) r.get("id");
            List<RoleDto> roles = userRoleRepo.findAllByUserId(userId).stream()
                .map(ur -> roleCache.get(ur.getRoleId()))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(RoleDto::displayName))
                .toList();

            String status = deriveStatus(
                (Boolean) r.get("is_active"),
                r.get("invited_at"),
                (String) r.get("password_hash"));

            out.add(new WorkspaceUserDto(
                userId, (String) r.get("email"), (UUID) r.get("employee_id"),
                (String) r.get("first_name"), (String) r.get("last_name"),
                status, toOdt(r.get("last_login_at")), roles,
                (String) r.get("send_status"), (String) r.get("last_send_error")));
        }
        return out;
    }

    @Transactional
    public List<AssignableRoleDto> listAssignableRoles(UUID tenantId, UUID actorId) {
        bindTenant(tenantId);
        Set<String> active = activeModuleKeys(tenantId);
        AccessPolicy.Actor actor = guard.actor(actorId);
        Map<String, String> risk = guard.riskByCode();
        List<AssignableRoleDto> out = new ArrayList<>();
        for (Role role : roleRepo.findAllByOrderByCodeAsc()) {
            if (AccessPolicy.NEVER_ASSIGNABLE_ROLES.contains(role.getCode())) continue;
            List<String> perms = guard.permissionsOfRole(role.getId());
            if (perms.stream().anyMatch(AccessPolicy::isPlatform)) continue;
            Set<String> gated = gatedModulesForRole(role.getId());
            String module = primaryModule(gated);
            boolean moduleActive = gated.isEmpty() || active.containsAll(gated);
            String blocked = AccessPolicy.grantBlockedReason(actor, role.getCode(), role.getDisplayName(), perms, risk);
            out.add(new AssignableRoleDto(role.getCode(), role.getDisplayName(), module, moduleActive,
                role.getDescription(), role.isSystemRole(), AccessPolicy.highestRisk(perms, risk),
                blocked == null, blocked, perms.size()));
        }
        return out;
    }

    // ── Mutations ───────────────────────────────────────────────────────────

    @Transactional
    public void assignRole(UUID tenantId, UUID userId, String roleCode, UUID actorId) {
        bindTenant(tenantId);
        Role role = resolveAssignableRole(roleCode);
        gateModuleActive(tenantId, role);

        UserCredentials target = credRepo.findById(userId)
            .orElseThrow(() -> new BusinessRuleException("User not found", "USER_NOT_FOUND"));

        boolean already = userRoleRepo.findAllByUserId(userId).stream()
            .anyMatch(ur -> ur.getRoleId().equals(role.getId()));
        if (already) return;

        // Levels: never your own access, an OWNER's access only by an OWNER,
        // only roles whose permissions you hold, CRITICAL / OWNER roles only by an OWNER.
        AccessPolicy.Actor actor = requireManager(actorId);
        AccessPolicy.requireCanChangeUser(actor, userId, guard.isOwner(userId));
        AccessPolicy.requireCanGrantRole(actor, role.getCode(), role.getDisplayName(),
            guard.permissionsOfRole(role.getId()), guard.riskByCode());

        grant(tenantId, userId, role.getId(), actorId);
        audit.record(actor.userId(), AccessAudit.PERMISSION_CHANGE, "USER", userId,
            "Gave the " + role.getDisplayName() + " role to " + target.getEmail(),
            Map.of("user", target.getEmail(), "roleGiven", role.getCode()));
        guard.evict(userId);
    }

    @Transactional
    public void revokeRole(UUID tenantId, UUID userId, String roleCode, UUID actorId) {
        bindTenant(tenantId);
        Role role = roleRepo.findByCode(roleCode)
            .orElseThrow(() -> new BusinessRuleException("Unknown role", "ROLE_NOT_FOUND"));
        boolean held = userRoleRepo.findAllByUserId(userId).stream()
            .anyMatch(ur -> ur.getRoleId().equals(role.getId()));
        if (!held) return;

        // Nobody removes their own roles (which also stops an admin locking
        // themselves out), and OWNER / SUPER_ADMIN, or an OWNER's roles, are
        // changed only by an OWNER. Removing someone's last role IS allowed:
        // they fall to No-Access.
        AccessPolicy.Actor actor = requireManager(actorId);
        AccessPolicy.requireCanChangeUser(actor, userId, guard.isOwner(userId));
        AccessPolicy.requireCanRevokeRole(actor, role.getCode(), role.getDisplayName());

        userRoleRepo.deleteById(new UserRole.PK(tenantId, userId, role.getId()));
        String email = credRepo.findById(userId).map(UserCredentials::getEmail).orElse(userId.toString());
        audit.record(actor.userId(), AccessAudit.PERMISSION_CHANGE, "USER", userId,
            "Took the " + role.getDisplayName() + " role away from " + email,
            Map.of("user", email, "roleRemoved", role.getCode()));
        guard.evict(userId);
    }

    /**
     * The acting admin, who must hold a role-management permission right now
     * (not just in their token): workspace.users.manage (Users &amp; access) or
     * rbac.role.write (Roles &amp; permissions → Who has which role).
     */
    private AccessPolicy.Actor requireManager(UUID actorId) {
        AccessPolicy.Actor actor = guard.actor(actorId);
        if (!actor.holds(UserPermissionService.MANAGE_USERS) && !actor.holds("rbac.role.write")) {
            throw AccessPolicy.refused("You need the “Manage workspace users” permission to change roles.",
                "PERMISSION_REQUIRED");
        }
        return actor;
    }

    @Transactional
    public InvitationService.InvitationResult inviteUser(UUID tenantId, UUID actorId, InviteRequest req) {
        bindTenant(tenantId);
        if (req.email() == null || req.email().isBlank()) {
            throw new BusinessRuleException("Email is required", "EMAIL_REQUIRED");
        }
        boolean createEmp = req.createEmployee() == null || req.createEmployee();

        // Resolve + module-gate all requested roles up front (fail fast), and
        // apply the same levels as assignRole: you may only invite someone into
        // roles you could give them.
        List<String> roleCodes = req.roleCodes() == null ? List.of() : req.roleCodes();
        List<Role> roles = new ArrayList<>();
        AccessPolicy.Actor actor = roleCodes.isEmpty() ? null : guard.actor(actorId);
        Map<String, String> risk = roleCodes.isEmpty() ? Map.of() : guard.riskByCode();
        for (String code : roleCodes) {
            Role role = resolveAssignableRole(code);
            gateModuleActive(tenantId, role);
            if (!"EMPLOYEE".equals(role.getCode())) {
                AccessPolicy.requireCanGrantRole(actor, role.getCode(), role.getDisplayName(),
                    guard.permissionsOfRole(role.getId()), risk);
            }
            roles.add(role);
        }
        if (!roles.isEmpty()) {
            audit.record(actorId, AccessAudit.PERMISSION_CHANGE, "USER", null,
                "Invited " + req.email() + " with the roles " + roles.stream().map(Role::getDisplayName).toList(),
                Map.of("user", req.email(), "rolesGiven", roles.stream().map(Role::getCode).toList()));
        }

        if (createEmp) {
            if (req.companyId() == null) {
                throw new BusinessRuleException("A company is required to create an employee", "COMPANY_REQUIRED");
            }
            String first = (req.firstName() == null || req.firstName().isBlank())
                ? req.email().split("@")[0] : req.firstName();
            // Everything past name/email is unset for a workspace-invite-created
            // employee — server-side defaults fill in weeklyOffDays (Sat+Sun),
            // employmentType (FULL_TIME) and roleCode (EMPLOYEE).
            //
            // This used to be a positional call with ~36 trailing nulls and it
            // broke on EVERY field addition to the record (2026-08-15 statutory
            // fields, then 2026-09-08 bankBranchName/designation). Use the
            // factory that lives next to the component list instead, so a new
            // field is a one-line change there and never touches this file.
            CreateWorkforceEmployeeRequest cr = CreateWorkforceEmployeeRequest.minimal(
                req.companyId(), first, req.lastName(), req.email());
            WorkforceEmployeeResponse emp = workforceService.create(cr);

            InvitationService.InvitationResult result =
                invitationService.sendInvitation(emp.id(), tenantId, actorId);

            bindTenant(tenantId); // re-bind after invitation flow
            UUID userId = credRepo.findByEmailIgnoreCase(req.email()).orElseThrow().getId();
            for (Role role : roles) {
                if (!"EMPLOYEE".equals(role.getCode())) grantIfAbsent(tenantId, userId, role.getId(), actorId);
            }
            return result;
        } else {
            UserCredentials creds = credRepo.findByEmailIgnoreCase(req.email()).orElseGet(() -> {
                UserCredentials c = new UserCredentials();
                // Do NOT setId — @GeneratedValue (same fix as InvitationService).
                c.setTenantId(tenantId);
                c.setEmail(req.email());
                c.setActive(false);
                return credRepo.save(c);
            });
            for (Role role : roles) grantIfAbsent(tenantId, creds.getId(), role.getId(), actorId);
            return invitationService.sendInviteToCredential(creds.getId(), tenantId, actorId);
        }
    }

    /**
     * Re-send the invitation email to an existing, not-yet-activated workspace
     * user — used when the original invite was lost or deleted. Invalidates the
     * previous token and issues a fresh one. Routes to the employee-backed flow
     * when the credential has an hrms.employees record, otherwise the
     * credential-only flow. Refuses users who have already set a password.
     */
    @Transactional
    public InvitationService.InvitationResult resendInvite(UUID tenantId, UUID userId, UUID actorId) {
        bindTenant(tenantId);
        UserCredentials creds = credRepo.findById(userId)
            .orElseThrow(() -> new BusinessRuleException("User not found", "USER_NOT_FOUND"));
        if (creds.isActive()) {
            throw new BusinessRuleException(
                "This user has already activated their account.", "ALREADY_ACTIVE");
        }
        if (creds.getEmployeeId() != null) {
            return invitationService.resendInvitation(creds.getEmployeeId(), tenantId, actorId);
        }
        return invitationService.sendInviteToCredential(userId, tenantId, actorId);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void bindTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }

    private Role resolveAssignableRole(String roleCode) {
        Role role = roleRepo.findByCode(roleCode)
            .orElseThrow(() -> new BusinessRuleException("Unknown role: " + roleCode, "ROLE_NOT_FOUND"));
        if (AccessPolicy.NEVER_ASSIGNABLE_ROLES.contains(role.getCode())) {
            throw new BusinessRuleException("Role not assignable here", "ROLE_NOT_ASSIGNABLE");
        }
        return role;
    }

    private void gateModuleActive(UUID tenantId, Role role) {
        Set<String> gated = gatedModulesForRole(role.getId());
        if (!gated.isEmpty() && !activeModuleKeys(tenantId).containsAll(gated)) {
            throw new BusinessRuleException(
                "This role's module is not active for your workspace.", "MODULE_NOT_ACTIVE");
        }
    }

    private void grant(UUID tenantId, UUID userId, UUID roleId, UUID actorId) {
        UserRole ur = new UserRole();
        ur.setTenantId(tenantId);
        ur.setUserId(userId);
        ur.setRoleId(roleId);
        ur.setGrantedAt(OffsetDateTime.now());
        ur.setGrantedBy(actorId);
        userRoleRepo.save(ur);
    }

    private void grantIfAbsent(UUID tenantId, UUID userId, UUID roleId, UUID actorId) {
        boolean already = userRoleRepo.findAllByUserId(userId).stream()
            .anyMatch(ur -> ur.getRoleId().equals(roleId));
        if (!already) grant(tenantId, userId, roleId, actorId);
    }

    /** roleId -> {roleCode, displayName, primaryModule} for every visible role. */
    private Map<UUID, RoleDto> roleDtoCache() {
        Map<UUID, RoleDto> cache = new HashMap<>();
        for (Role role : roleRepo.findAllByOrderByCodeAsc()) {
            String module = primaryModule(gatedModulesForRole(role.getId()));
            cache.put(role.getId(), new RoleDto(role.getCode(), role.getDisplayName(), module));
        }
        return cache;
    }

    /** Distinct gated tenant-module keys this role's permissions require. */
    private Set<String> gatedModulesForRole(UUID roleId) {
        List<String> permModules = jdbc.queryForList("""
            SELECT DISTINCT p.module
              FROM rbac.role_permissions rp
              JOIN rbac.permissions p ON p.code = rp.permission_code
             WHERE rp.role_id = ?
            """, String.class, roleId);
        Set<String> gated = new LinkedHashSet<>();
        for (String m : permModules) {
            String key = PERM_MODULE_TO_GATED_KEY.get(m);
            if (key != null) gated.add(key);
        }
        return gated;
    }

    private static String primaryModule(Set<String> gated) {
        if (gated.isEmpty()) return "core";
        for (String m : MODULE_PRIORITY) if (gated.contains(m)) return m;
        return gated.iterator().next();
    }

    private Set<String> activeModuleKeys(UUID tenantId) {
        return new HashSet<>(jdbc.queryForList(
            "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE'",
            String.class, tenantId));
    }

    private static String deriveStatus(Boolean active, Object invitedAt, String passwordHash) {
        boolean isActive = Boolean.TRUE.equals(active);
        if (isActive) return "ACTIVE";
        if (invitedAt != null && (passwordHash == null || passwordHash.isBlank())) return "INVITED";
        return "INACTIVE";
    }

    private static OffsetDateTime toOdt(Object o) {
        if (o == null) return null;
        if (o instanceof OffsetDateTime odt) return odt;
        if (o instanceof java.sql.Timestamp ts) return ts.toInstant().atOffset(java.time.ZoneOffset.UTC);
        if (o instanceof java.time.Instant i) return i.atOffset(java.time.ZoneOffset.UTC);
        return null;
    }
}
