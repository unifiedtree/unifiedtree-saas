package com.unifiedtree.saas.service;

import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.dto.AccountDtos.CreateWorkspaceRequest;
import com.unifiedtree.saas.dto.AccountDtos.AccountLoginResponse;
import com.unifiedtree.saas.dto.AccountDtos.AccountSummary;
import com.unifiedtree.saas.dto.AccountDtos.ModuleCard;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionResponse;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSummary;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Global account portal and workspace switcher.
 *
 * <p>The account token issued here is deliberately not enough to query ERP
 * tenant data. A caller must exchange a selected workspace membership for the
 * existing tenant-scoped JWT produced by {@link AuthService}.
 */
@Service
public class AccountService {

    private static final int LOCK_AFTER_FAILURES = 10;
    private static final String ACCOUNT_TOKEN_TYPE = "account";

    private final JdbcTemplate jdbc;
    private final PasswordService passwords;
    private final JwtService jwt;
    private final AuthService auth;
    private final SaasService saas;
    private final String baseDomain;

    public AccountService(JdbcTemplate jdbc,
                          PasswordService passwords,
                          JwtService jwt,
                          AuthService auth,
                          SaasService saas,
                          @Value("${unifiedtree.base-domain:unifiedtree.com}") String baseDomain) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.jwt = jwt;
        this.auth = auth;
        this.saas = saas;
        this.baseDomain = baseDomain;
    }

    public AccountLoginResponse login(String email, String password) {
        String normalizedEmail = normalizeEmail(email);
        AccountCredential account = loadCredential(normalizedEmail);

        if (!"ACTIVE".equals(account.status())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
        }
        if (account.lockedUntil() != null && account.lockedUntil().isAfter(OffsetDateTime.now())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is temporarily locked");
        }
        if (!passwords.matches(password, account.passwordHash())) {
            int failures = account.failedLoginCount() + 1;
            if (failures >= LOCK_AFTER_FAILURES) {
                jdbc.update("""
                        UPDATE platform.accounts
                           SET failed_login_count = ?,
                               locked_until = now() + interval '15 minutes',
                               updated_at = now()
                         WHERE id = ?
                        """, failures, account.accountId());
            } else {
                jdbc.update("""
                        UPDATE platform.accounts
                           SET failed_login_count = ?, updated_at = now()
                         WHERE id = ?
                        """, failures, account.accountId());
            }
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }

        jdbc.update("""
                UPDATE platform.accounts
                   SET failed_login_count = 0,
                       locked_until = NULL,
                       last_login_at = now(),
                       updated_at = now()
                 WHERE id = ?
                """, account.accountId());

        JwtService.IssuedToken issued = jwt.issueAccountToken(account.accountId(), account.email());
        return new AccountLoginResponse(
                issued.token(),
                issued.expiresAt(),
                toSummary(account),
                workspacesForAccount(account.accountId()));
    }

    public List<WorkspaceSummary> workspaces(Jwt accountJwt) {
        return workspacesForAccount(requireAccountId(accountJwt));
    }

    public SignupResponse createWorkspace(Jwt accountJwt, CreateWorkspaceRequest request) {
        return saas.createWorkspaceForAccount(requireAccountId(accountJwt), request);
    }

    public WorkspaceSessionResponse createWorkspaceSession(Jwt accountJwt, UUID tenantId) {
        UUID accountId = requireAccountId(accountJwt);
        WorkspaceMembership membership = loadMembership(accountId, tenantId);

        // Set tenant context BEFORE calling issueWorkspaceSession() so that
        // the @Transactional proxy on AuthService obtains a connection with the
        // correct SET LOCAL app.tenant_id already applied. Without this, the
        // connection is leased before TenantContext is populated, RLS hides all
        // rows, and findById returns empty → "Workspace account not found".
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            LoginResponse session = auth.issueWorkspaceSession(tenantId, membership.authUserId());
            WorkspaceSummary workspace = workspaceForMembership(membership);
            return new WorkspaceSessionResponse(session, workspace);
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    public WorkspaceSummary currentWorkspace(Jwt tenantJwt) {
        UUID tenantId = uuidClaim(tenantJwt, "tenant_id");
        UUID authUserId = UUID.fromString(tenantJwt.getSubject());
        WorkspaceMembership membership = jdbc.query("""
                SELECT aw.id, aw.account_id, aw.tenant_id, aw.auth_user_id, aw.role::text,
                       aw.default_workspace, t.display_name, t.subdomain, t.status
                  FROM platform.account_workspaces aw
                  JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.tenant_id = ?
                   AND aw.auth_user_id = ?
                   AND aw.status = 'ACTIVE'
                """, rs -> rs.next() ? mapMembership(rs) : null, tenantId, authUserId);

        if (membership != null) {
            return workspaceForMembership(membership);
        }

        String role = roleFromJwt(tenantJwt);
        return workspaceForTenantFallback(tenantId, role);
    }

    public WorkspaceSummary requestModuleUpgrade(Jwt tenantJwt, String moduleKey) {
        UUID tenantId = uuidClaim(tenantJwt, "tenant_id");
        UUID authUserId = UUID.fromString(tenantJwt.getSubject());
        WorkspaceMembership membership = jdbc.query("""
                SELECT aw.id, aw.account_id, aw.tenant_id, aw.auth_user_id, aw.role::text,
                       aw.default_workspace, t.display_name, t.subdomain, t.status
                  FROM platform.account_workspaces aw
                  JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.tenant_id = ?
                   AND aw.auth_user_id = ?
                   AND aw.status = 'ACTIVE'
                """, rs -> rs.next() ? mapMembership(rs) : null, tenantId, authUserId);
        String role = membership != null ? membership.role() : roleFromJwt(tenantJwt);
        if (!"OWNER".equals(role)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the workspace owner can buy modules");
        }

        String normalizedModule = normalizeModuleKey(moduleKey);
        Boolean exists = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM platform.module_catalog WHERE key = ?)",
                Boolean.class, normalizedModule);
        if (!Boolean.TRUE.equals(exists)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Module not found");
        }

        jdbc.update("""
                INSERT INTO platform.tenant_modules
                    (id, tenant_id, module_key, status, requested_at)
                VALUES (?, ?, ?, 'REQUESTED', now())
                ON CONFLICT (tenant_id, module_key) DO UPDATE
                    SET status = CASE
                        WHEN tenant_modules.status = 'ACTIVE' THEN 'ACTIVE'
                        ELSE 'REQUESTED'
                    END,
                    requested_at = now()
                """, UUID.randomUUID(), tenantId, normalizedModule);

        return membership != null ? workspaceForMembership(membership) : workspaceForTenantFallback(tenantId, role);
    }

    private List<WorkspaceSummary> workspacesForAccount(UUID accountId) {
        List<WorkspaceMembership> memberships = jdbc.query("""
                SELECT aw.id, aw.account_id, aw.tenant_id, aw.auth_user_id, aw.role::text,
                       aw.default_workspace, t.display_name, t.subdomain, t.status
                  FROM platform.account_workspaces aw
                  JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.account_id = ?
                   AND aw.status = 'ACTIVE'
                   AND t.status <> 'TERMINATED'
                 ORDER BY aw.default_workspace DESC, t.display_name ASC
                """, (rs, rowNum) -> mapMembership(rs), accountId);
        List<WorkspaceSummary> summaries = new ArrayList<>();
        for (WorkspaceMembership membership : memberships) {
            summaries.add(workspaceForMembership(membership));
        }
        return summaries;
    }

    private WorkspaceSummary workspaceForMembership(WorkspaceMembership membership) {
        return workspaceSummary(
                membership.tenantId(),
                membership.tenantName(),
                membership.subdomain(),
                membership.status(),
                membership.role(),
                membership.defaultWorkspace());
    }

    private WorkspaceSummary workspaceForTenantFallback(UUID tenantId, String role) {
        WorkspaceTenant tenant = jdbc.query("""
                SELECT id, display_name, subdomain, status
                  FROM platform.tenants
                 WHERE id = ?
                """, rs -> {
            if (!rs.next()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
            }
            return new WorkspaceTenant(
                    UUID.fromString(rs.getString("id")),
                    rs.getString("display_name"),
                    rs.getString("subdomain"),
                    rs.getString("status"));
        }, tenantId);
        return workspaceSummary(tenant.tenantId(), tenant.tenantName(), tenant.subdomain(), tenant.status(), role, false);
    }

    private WorkspaceSummary workspaceSummary(UUID tenantId,
                                              String tenantName,
                                              String subdomain,
                                              String status,
                                              String role,
                                              boolean defaultWorkspace) {
        CompanyRef company = defaultCompany(tenantId);
        List<ModuleCard> active = activeModules(tenantId);
        boolean canBuy = "OWNER".equals(role);
        List<ModuleCard> lockedPreview = canBuy ? lockedModules(tenantId, 2) : List.of();
        int lockedCount = canBuy ? lockedModuleCount(tenantId) : 0;
        return new WorkspaceSummary(
                tenantId,
                tenantName,
                subdomain,
                workspaceUrl(subdomain),
                status,
                role,
                defaultWorkspace,
                company == null ? null : company.id(),
                company == null ? null : company.name(),
                active,
                lockedPreview,
                lockedCount,
                canBuy);
    }

    private List<ModuleCard> activeModules(UUID tenantId) {
        return jdbc.query("""
                SELECT mc.key, mc.display_name, mc.category
                  FROM platform.tenant_modules tm
                  JOIN platform.module_catalog mc ON mc.key = tm.module_key
                 WHERE tm.tenant_id = ?
                   AND tm.status = 'ACTIVE'
                 ORDER BY mc.category, mc.display_name
                """, (rs, rowNum) -> new ModuleCard(
                rs.getString("key"),
                rs.getString("display_name"),
                rs.getString("category"),
                true,
                false,
                "OPEN"), tenantId);
    }

    private List<ModuleCard> lockedModules(UUID tenantId, int limit) {
        return jdbc.query("""
                SELECT mc.key, mc.display_name, mc.category, mc.is_available
                  FROM platform.module_catalog mc
                 WHERE mc.key <> 'billing'
                   AND NOT EXISTS (
                       SELECT 1 FROM platform.tenant_modules tm
                        WHERE tm.tenant_id = ?
                          AND tm.module_key = mc.key
                          AND tm.status = 'ACTIVE'
                   )
                 ORDER BY mc.is_available DESC, mc.category, mc.display_name
                 LIMIT ?
                """, (rs, rowNum) -> {
            boolean available = rs.getBoolean("is_available");
            return new ModuleCard(
                    rs.getString("key"),
                    rs.getString("display_name"),
                    rs.getString("category"),
                    false,
                    true,
                    available ? "BUY" : "COMING_SOON");
        }, tenantId, limit);
    }

    private int lockedModuleCount(UUID tenantId) {
        Integer count = jdbc.queryForObject("""
                SELECT COUNT(*)
                  FROM platform.module_catalog mc
                 WHERE mc.key <> 'billing'
                   AND NOT EXISTS (
                       SELECT 1 FROM platform.tenant_modules tm
                        WHERE tm.tenant_id = ?
                          AND tm.module_key = mc.key
                          AND tm.status = 'ACTIVE'
                   )
                """, Integer.class, tenantId);
        return count == null ? 0 : count;
    }

    private CompanyRef defaultCompany(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            return jdbc.query("""
                    SELECT id, name
                      FROM org.companies
                     WHERE tenant_id = ?
                       AND is_active = TRUE
                     ORDER BY created_at ASC
                     LIMIT 1
                    """, rs -> rs.next()
                    ? new CompanyRef(UUID.fromString(rs.getString("id")), rs.getString("name"))
                    : null, tenantId);
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    private WorkspaceMembership loadMembership(UUID accountId, UUID tenantId) {
        WorkspaceMembership membership = jdbc.query("""
                SELECT aw.id, aw.account_id, aw.tenant_id, aw.auth_user_id, aw.role::text,
                       aw.default_workspace, t.display_name, t.subdomain, t.status
                  FROM platform.account_workspaces aw
                  JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.account_id = ?
                   AND aw.tenant_id = ?
                   AND aw.status = 'ACTIVE'
                   AND t.status = 'ACTIVE'
                """, rs -> rs.next() ? mapMembership(rs) : null, accountId, tenantId);
        if (membership == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not have access to this workspace");
        }
        return membership;
    }

    private AccountCredential loadCredential(String email) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, email, display_name, phone, password_hash, status::text,
                           failed_login_count, locked_until
                      FROM platform.accounts
                     WHERE lower(email) = lower(?)
                    """, (rs, rowNum) -> new AccountCredential(
                    UUID.fromString(rs.getString("id")),
                    rs.getString("email"),
                    rs.getString("display_name"),
                    rs.getString("phone"),
                    rs.getString("password_hash"),
                    rs.getString("status"),
                    rs.getInt("failed_login_count"),
                    rs.getObject("locked_until", OffsetDateTime.class)), email);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
        }
    }

    private AccountSummary toSummary(AccountCredential account) {
        return new AccountSummary(
                account.accountId(),
                account.email(),
                account.displayName(),
                account.phone(),
                account.status());
    }

    private UUID requireAccountId(Jwt token) {
        if (token == null || !ACCOUNT_TOKEN_TYPE.equals(token.getClaimAsString("token_type"))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account token required");
        }
        return UUID.fromString(token.getSubject());
    }

    private UUID uuidClaim(Jwt token, String claim) {
        String value = token.getClaimAsString(claim);
        if (value == null || value.isBlank()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, claim + " claim required");
        }
        return UUID.fromString(value);
    }

    private String roleFromJwt(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles == null || roles.isEmpty()) return "EMPLOYEE";
        if (roles.contains("OWNER") || roles.contains("SUPER_ADMIN")) return "OWNER";
        if (roles.contains("ADMIN") || roles.contains("COMPANY_ADMIN") || roles.contains("HR_MANAGER")) return "ADMIN";
        if (roles.contains("MANAGER") || roles.contains("DEPT_MANAGER")) return "MANAGER";
        return "EMPLOYEE";
    }

    private static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeModuleKey(String moduleKey) {
        return moduleKey == null ? "" : moduleKey.trim().toLowerCase(Locale.ROOT);
    }

    private String workspaceUrl(String subdomain) {
        return "https://" + subdomain + "." + baseDomain;
    }

    private static WorkspaceMembership mapMembership(ResultSet rs) throws SQLException {
        return new WorkspaceMembership(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("account_id")),
                UUID.fromString(rs.getString("tenant_id")),
                UUID.fromString(rs.getString("auth_user_id")),
                rs.getString("role"),
                rs.getBoolean("default_workspace"),
                rs.getString("display_name"),
                rs.getString("subdomain"),
                rs.getString("status"));
    }

    private record AccountCredential(
            UUID accountId,
            String email,
            String displayName,
            String phone,
            String passwordHash,
            String status,
            int failedLoginCount,
            OffsetDateTime lockedUntil
    ) {}

    private record WorkspaceMembership(
            UUID id,
            UUID accountId,
            UUID tenantId,
            UUID authUserId,
            String role,
            boolean defaultWorkspace,
            String tenantName,
            String subdomain,
            String status
    ) {}

    private record WorkspaceTenant(UUID tenantId, String tenantName, String subdomain, String status) {}

    private record CompanyRef(UUID id, String name) {}
}
