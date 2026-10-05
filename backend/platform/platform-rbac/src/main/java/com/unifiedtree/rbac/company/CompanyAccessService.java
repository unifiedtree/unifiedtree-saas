package com.unifiedtree.rbac.company;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.unifiedtree.rbac.company.CompanyAccess.Grant;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.security.PermissionCacheEvictEvent;
import com.unifiedtree.rbac.security.PermissionOverrides;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Company access (docs/redesign/COMPANY_ACCESS.md): which companies a person
 * may work in, and their roles and permissions in each.
 *
 * <p>Reads run on the request's connection, so row-level security keeps them
 * inside the caller's workspace. A person's {@link Profile} is cached for 30
 * seconds per workspace and person (like {@code PermissionChecker}'s cache),
 * and dropped at once when their grants or roles change on this server.
 *
 * <p>Until migration V143.93 is applied the grants table does not exist: every
 * read then answers "no grants" (never an error), and {@link #tableReady()} is
 * false so saving a grant can answer FEATURE_NOT_READY.
 */
@Service
public class CompanyAccessService {

    private static final Logger log = LoggerFactory.getLogger(CompanyAccessService.class);

    private final JdbcTemplate jdbc;
    private final RolePermissionRepository rolePermissions;
    private final EmployeeBaselinePermissions baseline;
    private final PermissionOverrides overrides;

    private final Cache<String, Profile> profiles = Caffeine.newBuilder()
            .expireAfterWrite(30, TimeUnit.SECONDS).maximumSize(10_000).build();
    private final Cache<String, CompanyContext.Scope> scopes = Caffeine.newBuilder()
            .expireAfterWrite(30, TimeUnit.SECONDS).maximumSize(10_000).build();
    private final Cache<String, Boolean> companies = Caffeine.newBuilder()
            .expireAfterWrite(60, TimeUnit.SECONDS).maximumSize(10_000).build();

    private volatile boolean tablePresent;
    /** Kill switch: false = no company checks and no list narrowing (the behaviour before company access). */
    private final boolean enforce;

    public CompanyAccessService(JdbcTemplate jdbc,
                                RolePermissionRepository rolePermissions,
                                EmployeeBaselinePermissions baseline,
                                PermissionOverrides overrides,
                                @Value("${unifiedtree.company-access.enforce:true}") boolean enforce) {
        this.jdbc = jdbc;
        this.rolePermissions = rolePermissions;
        this.baseline = baseline;
        this.overrides = overrides;
        this.enforce = enforce;
        if (!enforce) log.warn("Company access checks are OFF (unifiedtree.company-access.enforce=false)");
    }

    /** Whether company access is checked (see the kill switch on the constructor). */
    public boolean enforced() {
        return enforce;
    }

    // ── Views ───────────────────────────────────────────────────────────────

    /**
     * One role in one company. {@code source}: ROLES = the person's normal roles,
     * GRANT = a company grant (then {@code grantedBy} / {@code grantedAt} are set).
     */
    public record RoleEntry(String code, String name, String source, UUID grantedBy, OffsetDateTime grantedAt) {}

    /** One company the person may access. {@code access}: WORKSPACE | HOME | GRANT. */
    public record CompanyEntry(UUID companyId, String name, String logoUrl, boolean active,
                               boolean home, String access, List<RoleEntry> roles) {}

    /** A person's companies, home first then by name. */
    public record CompanyAccessView(UUID userId, UUID homeCompanyId, boolean allCompanies,
                                    List<CompanyEntry> companies) {}

    /** One grant row, for the workspace-wide listing (Roles &amp; Access, billing). */
    public record GrantRow(UUID userId, String email, String employeeName, UUID homeCompanyId,
                           UUID companyId, String companyName, String roleCode, String roleName,
                           UUID grantedBy, OffsetDateTime grantedAt) {}

    // ── Profile ─────────────────────────────────────────────────────────────

    /** The signed-in person's profile in the current workspace. */
    public Profile currentProfile() {
        UUID userId = TenantContext.getUserId();
        if (userId == null) throw new IllegalStateException("No signed-in user");
        return profile(userId);
    }

    /** One person's profile in the current workspace (cached 30 s). */
    public Profile profile(UUID userId) {
        UUID tenantId = TenantContext.requireTenantId();
        return profiles.get(key(tenantId, userId), k -> load(userId));
    }

    private Profile load(UUID userId) {
        List<Map<String, Object>> cred = jdbc.queryForList("""
                SELECT uc.employee_id, e.company_id
                  FROM auth.user_credentials uc
                  LEFT JOIN hrms.employees e ON e.id = uc.employee_id
                 WHERE uc.id = ?
                """, userId);
        if (cred.isEmpty()) return new Profile(userId, false, null, null, List.of(), List.of());
        UUID employeeId = (UUID) cred.get(0).get("employee_id");
        UUID home = (UUID) cred.get(0).get("company_id");

        List<RoleRef> roles = jdbc.query("""
                SELECT r.id, r.code, r.display_name, r.tenant_id IS NULL
                  FROM rbac.user_roles ur
                  JOIN rbac.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = ?
                 ORDER BY r.display_name
                """, (rs, i) -> new RoleRef((UUID) rs.getObject(1), rs.getString(2), rs.getString(3), rs.getBoolean(4)),
                userId);

        return new Profile(userId, true, employeeId, home, roles, loadGrants(userId));
    }

    private List<Grant> loadGrants(UUID userId) {
        if (!tableReady()) return List.of();
        try {
            return jdbc.query("""
                    SELECT a.company_id, r.id, r.code, r.display_name, r.tenant_id IS NULL, a.granted_by, a.granted_at
                      FROM rbac.user_company_access a
                      JOIN rbac.roles r ON r.id = a.role_id
                     WHERE a.user_id = ?
                     ORDER BY a.granted_at, r.display_name
                    """, (rs, i) -> new Grant((UUID) rs.getObject(1),
                            new RoleRef((UUID) rs.getObject(2), rs.getString(3), rs.getString(4), rs.getBoolean(5)),
                            (UUID) rs.getObject(6), rs.getObject(7, OffsetDateTime.class)),
                    userId);
        } catch (RuntimeException e) {
            log.warn("COMPANY_ACCESS_READ_FAIL user={} — no grants applied", userId, e);
            return List.of();
        }
    }

    /** Whether a company with this id exists in the current workspace (archived ones too). */
    public boolean companyExists(UUID companyId) {
        if (companyId == null) return false;
        UUID tenantId = TenantContext.requireTenantId();
        return companies.get(key(tenantId, companyId), k -> {
            Integer n = jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id = ?", Integer.class, companyId);
            return n != null && n > 0;
        });
    }

    /**
     * The person's roles and permissions in a company they reach through a grant,
     * or {@code null} when the session's own apply (home company, all-companies
     * people, or a company they can't access — callers check access first).
     *
     * <p>Permissions = the granted roles' permissions + the employee self-service
     * baseline (their own pages keep working in any company) − their DENY
     * overrides. Their GRANT overrides stay with their home company.
     */
    public CompanyContext.Scope scope(Profile profile, UUID companyId) {
        if (!profile.needsScope(companyId)) return null;
        UUID tenantId = TenantContext.requireTenantId();
        return scopes.get(key(tenantId, profile.userId()) + ":" + companyId, k -> {
            List<RoleRef> granted = profile.grantedRoles(companyId);
            Set<UUID> roleIds = new HashSet<>();
            List<String> codes = new ArrayList<>();
            for (RoleRef r : granted) { roleIds.add(r.id()); codes.add(r.code()); }
            List<String> rolePerms = roleIds.isEmpty() ? List.of() : rolePermissions.findPermissionCodesByRoleIds(roleIds);
            List<String> base = baseline.effectiveFor(rolePerms, profile.employeeId());
            List<PermissionOverrides.Override> denies = overrides == null ? List.of()
                    : overrides.activeFor(profile.userId()).stream().filter(PermissionOverrides.Override::isDeny).toList();
            List<String> effective = PermissionOverrides.apply(base, denies);
            return new CompanyContext.Scope(companyId, Set.copyOf(roleIds),
                    codes.stream().sorted().toList(), Set.copyOf(effective));
        });
    }

    /**
     * The current company: the one the client selected with X-Company-Id
     * (already checked by the filter), else the signed-in person's home company
     * (null when they have no employee record).
     */
    public UUID currentCompanyId() {
        UUID explicit = CompanyContext.getCompanyId();
        return explicit != null ? explicit : currentProfile().homeCompanyId();
    }

    /**
     * Companies the signed-in person may access, or {@code null} when that is
     * every company — and also {@code null} (no narrowing, as before) when there
     * is no signed-in workspace user or the login is not one of this workspace's.
     */
    public Set<UUID> accessibleCompanyIds() {
        if (!enforce || TenantContext.getTenantId() == null || TenantContext.getUserId() == null) return null;
        Profile p = currentProfile();
        return p.known() ? p.accessibleCompanyIds() : null;
    }

    /** {@code GET /v1/me/companies}: the signed-in person's active companies. */
    public CompanyAccessView myCompanies() {
        return view(currentProfile(), false);
    }

    /**
     * A person's companies with their roles in each.
     *
     * @param includeInactive also list archived companies they hold access to (admin view)
     */
    public CompanyAccessView view(Profile p, boolean includeInactive) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, name, logo_url, is_active FROM org.companies ORDER BY lower(name), id");
        List<RoleEntry> ownRoles = p.roles().stream()
                .map(r -> new RoleEntry(r.code(), r.name(), "ROLES", null, null)).toList();
        boolean all = p.allCompanies();

        List<CompanyEntry> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            UUID id = (UUID) row.get("id");
            boolean active = Boolean.TRUE.equals(row.get("is_active"));
            boolean home = id.equals(p.homeCompanyId());
            if (!all && !p.canAccess(id)) continue;
            if (!active && !includeInactive) continue;

            List<RoleEntry> roles = new ArrayList<>();
            String access;
            if (all) {
                access = CompanyAccess.VIA_WORKSPACE;
                roles.addAll(ownRoles);
            } else {
                access = home ? CompanyAccess.VIA_HOME : CompanyAccess.VIA_GRANT;
                if (home) roles.addAll(ownRoles);
                for (Grant g : p.grants()) {
                    if (g.companyId().equals(id)) {
                        roles.add(new RoleEntry(g.role().code(), g.role().name(), "GRANT", g.grantedBy(), g.grantedAt()));
                    }
                }
            }
            out.add(new CompanyEntry(id, (String) row.get("name"), (String) row.get("logo_url"), active, home, access, roles));
        }
        out.sort(Comparator.comparing((CompanyEntry c) -> !c.home()));  // stable: home first, rest by name
        return new CompanyAccessView(p.userId(), p.homeCompanyId(), all, out);
    }

    // ── Grants (data only: who may change them is decided by the caller) ────

    /** Whether migration V143.93 is applied and this connection may use its table. */
    public boolean tableReady() {
        if (tablePresent) return true;
        try {
            tablePresent = Boolean.TRUE.equals(jdbc.queryForObject("""
                    SELECT CASE WHEN to_regclass('rbac.user_company_access') IS NULL THEN false
                                ELSE has_table_privilege('rbac.user_company_access', 'SELECT') END
                    """, Boolean.class));
        } catch (RuntimeException e) {
            tablePresent = false;
        }
        return tablePresent;
    }

    /** Add one grant. Returns false when it was already there. */
    public boolean grant(UUID userId, UUID companyId, UUID roleId, UUID grantedBy) {
        UUID tenantId = TenantContext.requireTenantId();
        int n = jdbc.update("""
                INSERT INTO rbac.user_company_access (tenant_id, user_id, company_id, role_id, granted_by, granted_at)
                VALUES (?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, user_id, company_id, role_id) DO NOTHING
                """, tenantId, userId, companyId, roleId, grantedBy);
        evictUser(tenantId, userId);
        return n > 0;
    }

    /** Remove one role ({@code roleId}) or every role ({@code null}) a person holds in a company. Returns rows removed. */
    public int revoke(UUID userId, UUID companyId, UUID roleId) {
        UUID tenantId = TenantContext.requireTenantId();
        int n = roleId == null
                ? jdbc.update("DELETE FROM rbac.user_company_access WHERE user_id = ? AND company_id = ?", userId, companyId)
                : jdbc.update("DELETE FROM rbac.user_company_access WHERE user_id = ? AND company_id = ? AND role_id = ?",
                        userId, companyId, roleId);
        evictUser(tenantId, userId);
        return n;
    }

    /** Every grant in the workspace, optionally for one company. Empty before V143.93. */
    public List<GrantRow> listGrants(UUID companyId) {
        if (!tableReady()) return List.of();
        String sql = """
                SELECT a.user_id, uc.email, e.first_name, e.last_name, e.company_id AS home_company_id,
                       a.company_id, c.name AS company_name, r.code, r.display_name, a.granted_by, a.granted_at
                  FROM rbac.user_company_access a
                  JOIN rbac.roles r ON r.id = a.role_id
                  JOIN org.companies c ON c.id = a.company_id
                  LEFT JOIN auth.user_credentials uc ON uc.id = a.user_id
                  LEFT JOIN hrms.employees e ON e.id = uc.employee_id
                """ + (companyId == null ? "" : " WHERE a.company_id = ?") + """
                 ORDER BY lower(c.name), lower(uc.email), r.display_name
                """;
        Object[] args = companyId == null ? new Object[0] : new Object[] {companyId};
        return jdbc.query(sql, (rs, i) -> {
            String first = rs.getString("first_name");
            String last = rs.getString("last_name");
            String name = first == null && last == null ? null
                    : ((first == null ? "" : first) + " " + (last == null ? "" : last)).trim();
            return new GrantRow((UUID) rs.getObject("user_id"), rs.getString("email"), name,
                    (UUID) rs.getObject("home_company_id"), (UUID) rs.getObject("company_id"),
                    rs.getString("company_name"), rs.getString("code"), rs.getString("display_name"),
                    (UUID) rs.getObject("granted_by"), rs.getObject("granted_at", OffsetDateTime.class));
        }, args);
    }

    // ── Cache ───────────────────────────────────────────────────────────────

    /** Drop one person's cached profile and company permission sets. */
    public void evictUser(UUID tenantId, UUID userId) {
        if (tenantId == null || userId == null) return;
        String k = key(tenantId, userId);
        profiles.invalidate(k);
        scopes.asMap().keySet().removeIf(s -> s.startsWith(k + ":"));
    }

    /** Roles granted or revoked through RbacService: their workspace-wide status may have changed. */
    @EventListener
    public void onRolesChanged(PermissionCacheEvictEvent event) {
        evictUser(event.tenantId(), event.userId());
    }

    /** For tests. */
    void evictAll() {
        profiles.invalidateAll();
        scopes.invalidateAll();
        companies.invalidateAll();
    }

    private static String key(UUID tenantId, UUID id) {
        return tenantId + ":" + id;
    }
}
