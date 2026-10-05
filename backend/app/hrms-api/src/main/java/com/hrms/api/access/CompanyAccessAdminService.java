package com.hrms.api.access;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.company.CompanyAccess;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyAccessView;
import com.unifiedtree.rbac.company.CompanyAccessService.GrantRow;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Giving and taking away a person's access to a company (docs/redesign/COMPANY_ACCESS.md).
 *
 * <p>The same "levels" rules as giving a role ({@link AccessPolicy}): the actor
 * needs a role-management permission right now, never changes their own access,
 * only an OWNER changes an OWNER's, and only roles whose permissions the actor
 * holds can be given (critical ones by the OWNER only). On top of that a grant
 * is for a company other than the person's home company (their roles there are
 * their normal roles) and never one of the whole-business roles OWNER,
 * SUPER_ADMIN, ADMIN. Every change is written to the audit log like a role change.
 */
@Service
public class CompanyAccessAdminService {

    private final CompanyAccessService access;
    private final AccessGuard guard;
    private final AccessAudit audit;
    private final JdbcTemplate jdbc;

    public CompanyAccessAdminService(CompanyAccessService access, AccessGuard guard,
                                     AccessAudit audit, JdbcTemplate jdbc) {
        this.access = access;
        this.guard = guard;
        this.audit = audit;
        this.jdbc = jdbc;
    }

    public record GrantRequest(UUID companyId, String roleCode) {}

    private record RoleRow(UUID id, String code, String name) {}

    private record CompanyRow(UUID id, String name) {}

    /** One person's companies and roles, archived companies included. */
    @Transactional(readOnly = true)
    public CompanyAccessView view(UUID userId) {
        requireUser(userId);
        return access.view(access.profile(userId), true);
    }

    /** Every grant in the workspace, optionally for one company. */
    @Transactional(readOnly = true)
    public List<GrantRow> listGrants(UUID companyId) {
        return access.listGrants(companyId);
    }

    @Transactional
    public CompanyAccessView grant(UUID userId, GrantRequest req, UUID actorId) {
        if (req == null || req.companyId() == null) {
            throw new HrmsException("Choose a company.", HttpStatus.UNPROCESSABLE_ENTITY, "COMPANY_REQUIRED");
        }
        if (req.roleCode() == null || req.roleCode().isBlank()) {
            throw new HrmsException("Choose a role.", HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_REQUIRED");
        }
        requireReady();
        String email = requireUser(userId);
        CompanyRow company = requireCompany(req.companyId());
        RoleRow role = requireRole(req.roleCode().trim());

        AccessPolicy.Actor actor = requireManager(actorId);
        AccessPolicy.requireCanChangeUser(actor, userId, guard.isOwner(userId));
        requireActorReaches(actor, company);
        if (CompanyAccess.NOT_GRANTABLE_PER_COMPANY.contains(role.code())) {
            throw new HrmsException("The " + role.name() + " role covers every company. Give it from the person's roles instead.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_IS_WORKSPACE_WIDE");
        }
        AccessPolicy.requireCanGrantRole(actor, role.code(), role.name(),
                guard.permissionsOfRole(role.id()), guard.riskByCode());
        requireModuleActive(role.id());

        CompanyAccess.Profile target = access.profile(userId);
        if (company.id().equals(target.homeCompanyId())) {
            throw new HrmsException(company.name() + " is this person's main company. Change their roles instead.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "HOME_COMPANY");
        }

        if (access.grant(userId, company.id(), role.id(), actor.userId())) {
            audit.record(actor.userId(), AccessAudit.PERMISSION_CHANGE, "USER", userId,
                    "Gave " + email + " the " + role.name() + " role in " + company.name(),
                    Map.of("user", email, "company", company.name(), "companyId", company.id().toString(),
                            "roleGiven", role.code()));
        }
        guard.evict(userId);
        return access.view(access.profile(userId), true);
    }

    @Transactional
    public CompanyAccessView revoke(UUID userId, UUID companyId, String roleCode, UUID actorId) {
        requireReady();
        String email = requireUser(userId);
        CompanyRow company = requireCompany(companyId);
        RoleRow role = roleCode == null || roleCode.isBlank() ? null : requireRole(roleCode.trim());

        // Taking access away cannot escalate anyone: the management permission
        // and "never your own / an owner's only by an owner" are enough.
        AccessPolicy.Actor actor = requireManager(actorId);
        AccessPolicy.requireCanChangeUser(actor, userId, guard.isOwner(userId));
        requireActorReaches(actor, company);

        int removed = access.revoke(userId, company.id(), role == null ? null : role.id());
        if (removed > 0) {
            String what = role == null ? "access to " + company.name() : "the " + role.name() + " role in " + company.name();
            audit.record(actor.userId(), AccessAudit.PERMISSION_CHANGE, "USER", userId,
                    "Took away " + what + " from " + email,
                    Map.of("user", email, "company", company.name(), "companyId", company.id().toString(),
                            "roleRemoved", role == null ? "ALL" : role.code()));
        }
        guard.evict(userId);
        return access.view(access.profile(userId), true);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** As WorkspaceAccessService.requireManager: workspace.users.manage or rbac.role.write, held right now. */
    private AccessPolicy.Actor requireManager(UUID actorId) {
        AccessPolicy.Actor actor = guard.actor(actorId);
        if (!actor.holds(UserPermissionService.MANAGE_USERS) && !actor.holds("rbac.role.write")) {
            throw AccessPolicy.refused("You need the “Manage workspace users” permission to change access.",
                    "PERMISSION_REQUIRED");
        }
        return actor;
    }

    /** You only hand out (or take away) access to a company you can access yourself. */
    private void requireActorReaches(AccessPolicy.Actor actor, CompanyRow company) {
        if (!access.profile(actor.userId()).canAccess(company.id())) {
            throw AccessPolicy.refused("You can only change access to companies you can access yourself.",
                    "COMPANY_ACCESS_DENIED");
        }
    }

    private void requireReady() {
        if (!access.tableReady()) {
            throw new HrmsException("Company access can't be changed yet. Please try again later.",
                    HttpStatus.SERVICE_UNAVAILABLE, "FEATURE_NOT_READY");
        }
    }

    /** The person's email; 404 when the login is not in this workspace (RLS hides other workspaces). */
    private String requireUser(UUID userId) {
        List<String> rows = jdbc.queryForList("SELECT email FROM auth.user_credentials WHERE id = ?", String.class, userId);
        if (rows.isEmpty()) throw new HrmsException("User not found", HttpStatus.NOT_FOUND, "USER_NOT_FOUND");
        return rows.get(0) == null ? userId.toString() : rows.get(0);
    }

    private CompanyRow requireCompany(UUID companyId) {
        List<CompanyRow> rows = jdbc.query("SELECT id, name FROM org.companies WHERE id = ?",
                (rs, i) -> new CompanyRow((UUID) rs.getObject(1), rs.getString(2)), companyId);
        if (rows.isEmpty()) throw new HrmsException("Company not found", HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND");
        return rows.get(0);
    }

    /** A built-in role, or one of this workspace's own roles (RLS), by code. */
    private RoleRow requireRole(String code) {
        List<RoleRow> rows = jdbc.query("""
                SELECT id, code, display_name FROM rbac.roles WHERE code = ?
                 ORDER BY (tenant_id IS NULL)  -- the workspace's own role first, as roleRepo.findByCode resolves it
                """, (rs, i) -> new RoleRow((UUID) rs.getObject(1), rs.getString(2), rs.getString(3)), code);
        if (rows.isEmpty()) throw new HrmsException("Unknown role: " + code, HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_NOT_FOUND");
        RoleRow role = rows.get(0);
        if (AccessPolicy.NEVER_ASSIGNABLE_ROLES.contains(role.code())) {
            throw new HrmsException("Role not assignable here", HttpStatus.UNPROCESSABLE_ENTITY, "ROLE_NOT_ASSIGNABLE");
        }
        return role;
    }

    /** Same module gate as giving the role: its gated modules must be active for the workspace. */
    private void requireModuleActive(UUID roleId) {
        List<String> permModules = jdbc.queryForList("""
                SELECT DISTINCT p.module
                  FROM rbac.role_permissions rp
                  JOIN rbac.permissions p ON p.code = rp.permission_code
                 WHERE rp.role_id = ?
                """, String.class, roleId);
        Set<String> gated = new LinkedHashSet<>();
        for (String m : permModules) {
            String key = WorkspaceAccessService.PERM_MODULE_TO_GATED_KEY.get(m);
            if (key != null) gated.add(key);
        }
        if (gated.isEmpty()) return;
        Set<String> active = new LinkedHashSet<>(jdbc.queryForList(
                "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE'",
                String.class, TenantContext.requireTenantId()));
        if (!active.containsAll(gated)) {
            throw new HrmsException("This role's module is not active for your workspace.",
                    HttpStatus.UNPROCESSABLE_ENTITY, "MODULE_NOT_ACTIVE");
        }
    }
}
