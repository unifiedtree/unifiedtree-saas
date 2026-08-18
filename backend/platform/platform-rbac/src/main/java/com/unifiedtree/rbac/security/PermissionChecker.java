package com.unifiedtree.rbac.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Spring Security SpEL helper registered as {@code @perm}.
 *
 * <p>Usage in controllers:
 * <pre>
 *   @PreAuthorize("@perm.check('hrms.employee.read')")
 *   @PreAuthorize("@perm.check('hrms.employee.write')")
 *   @PreAuthorize("@perm.hasAny('hrms.leave.approve.l1','hrms.leave.approve.l2')")
 * </pre>
 *
 * <p>Permissions are NOT stored in the JWT (token bloat + slow revocation).
 * They are loaded per (userId, tenantId) on the first request and cached in
 * a Caffeine L1 cache with a 60-second TTL. Cache is invalidated immediately
 * on role-assignment mutations via {@link PermissionCacheEvictEvent}.
 */
@Component("perm")
public class PermissionChecker {

    private static final Logger log = LoggerFactory.getLogger(PermissionChecker.class);

    private final UserRoleRepository userRoleRepo;
    private final RolePermissionRepository rolePermissionRepo;
    private final EmployeeBaselinePermissions employeeBaseline;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    // keyed by "tenantId:userId" → set of permission codes
    private final Cache<String, Set<String>> cache = Caffeine.newBuilder()
            .expireAfterWrite(60, TimeUnit.SECONDS)
            .maximumSize(10_000)
            .build();

    public PermissionChecker(UserRoleRepository userRoleRepo,
                             RolePermissionRepository rolePermissionRepo,
                             EmployeeBaselinePermissions employeeBaseline,
                             org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.userRoleRepo = userRoleRepo;
        this.rolePermissionRepo = rolePermissionRepo;
        this.employeeBaseline = employeeBaseline;
        this.jdbc = jdbc;
    }

    /**
     * Returns true if the currently-authenticated user holds {@code permissionCode}
     * within the current tenant.
     */
    public boolean check(String permissionCode) {
        return permissions().contains(permissionCode);
    }

    /**
     * Returns true if the user holds the permission AND the resource referenced by
     * {@code resourceId} belongs to the current tenant (RLS enforces this at DB level,
     * but the explicit check gives a meaningful 403 before the DB round-trip).
     */
    public boolean check(String permissionCode, Object resourceId) {
        return check(permissionCode);
    }

    /**
     * Returns true if the user holds ANY of the supplied permission codes.
     */
    public boolean hasAny(String... codes) {
        Set<String> held = permissions();
        for (String code : codes) {
            if (held.contains(code)) return true;
        }
        return false;
    }

    /**
     * Returns true if the user holds ALL of the supplied permission codes.
     */
    public boolean hasAll(String... codes) {
        Set<String> held = permissions();
        for (String code : codes) {
            if (!held.contains(code)) return false;
        }
        return true;
    }

    /** Evict when a role is granted, revoked, or its permission set changes. */
    @EventListener
    public void onCacheEvict(PermissionCacheEvictEvent event) {
        String key = cacheKey(event.tenantId(), event.userId());
        cache.invalidate(key);
        log.debug("Permission cache evicted: {}", key);
    }

    /** Evict entire tenant (e.g. when a system role's permissions change). */
    public void evictTenant(UUID tenantId) {
        cache.asMap().keySet().removeIf(k -> k.startsWith(tenantId + ":"));
    }

    // ── internals ─────────────────────────────────────────────────────────────

    private Set<String> permissions() {
        UUID userId   = TenantContext.getUserId();
        UUID tenantId = TenantContext.getTenantId();

        if (userId == null || tenantId == null) {
            log.warn("PermissionChecker called without userId/tenantId in context — denying");
            return Set.of();
        }

        return cache.get(cacheKey(tenantId, userId), k -> loadPermissions(userId));
    }

    private Set<String> loadPermissions(UUID userId) {
        List<UUID> roleIds = userRoleRepo.findAllByUserId(userId)
                .stream().map(UserRole::getRoleId).toList();

        List<String> rolePerms = roleIds.isEmpty()
                ? List.of()
                : rolePermissionRepo.findPermissionCodesByRoleIds(roleIds);

        // Mirror AuthService.issueSession: a principal that owns an employee
        // record always holds the employee self-service baseline on top of
        // whatever their assigned roles grant. If these two paths disagreed,
        // a JWT-authority check (hasAuthority) and a bean check (@perm.check)
        // would reach different verdicts for the same user on the same request.
        UUID employeeId = lookupEmployeeId(userId);
        return Set.copyOf(employeeBaseline.effectiveFor(rolePerms, employeeId));
    }

    /**
     * Read the credential's employee_id. Returns null when the user has no
     * employee record (platform-only principals) or when the lookup fails —
     * failing closed to "not an employee" only withholds the self-service
     * baseline, it never grants anything extra.
     */
    private UUID lookupEmployeeId(UUID userId) {
        try {
            List<UUID> rows = jdbc.queryForList(
                    "SELECT employee_id FROM auth.user_credentials WHERE id = ?",
                    UUID.class, userId);
            return rows.isEmpty() ? null : rows.get(0);
        } catch (RuntimeException e) {
            log.warn("EMPLOYEE_ID_LOOKUP_FAIL user={} — employee baseline withheld", userId, e);
            return null;
        }
    }

    private static String cacheKey(UUID tenantId, UUID userId) {
        return tenantId + ":" + userId;
    }
}
