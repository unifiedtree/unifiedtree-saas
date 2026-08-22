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

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
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

    /**
     * Refresh-token lifetime for the account portal. 30 days matches the "sign
     * in once a month" web UX target: shorter forces users through the login
     * screen on every long weekend; longer widens the replay window on a
     * stolen cookie.
     *
     * <p>The access-token TTL is unchanged (whatever {@link JwtService#issueAccountToken}
     * mints) — this is the LONG-lived credential paired with it.
     */
    private static final Duration ACCOUNT_REFRESH_TTL = Duration.ofDays(30);

    private static final SecureRandom RNG = new SecureRandom();

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
        if (account.passwordHash() == null || account.passwordHash().isBlank()) {
            // Google-only account (V108): password_hash is now nullable. Return
            // a specific 401 so the front end can nudge the user to the
            // "Continue with Google" button rather than looping through the
            // generic "invalid email or password" wall.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Use Continue with Google to sign in");
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

    /**
     * Mint a fresh refresh token for {@code accountId} and persist its SHA-256
     * hash. Returns the plain token — the caller writes it into the
     * {@code ut_acct_rt} cookie (web) and/or the JSON response body (mobile).
     * The plaintext is never stored.
     *
     * <p>Optional {@code userAgent} / {@code requestIp} are recorded for the
     * future "list active sessions" screen. Pass null when unknown.
     */
    public String issueRefresh(UUID accountId, String userAgent, String requestIp) {
        if (accountId == null) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "accountId required");
        }
        String plain = randomOpaque(48);
        String hash = sha256Hex(plain);
        OffsetDateTime now = OffsetDateTime.now();
        // gen_random_uuid() default fills id; issued_at defaults to now().
        jdbc.update("""
                INSERT INTO platform.account_refresh_tokens
                    (account_id, token_hash, expires_at, user_agent, request_ip)
                VALUES (?, ?, ?, ?, ?)
                """,
                accountId, hash,
                now.plus(ACCOUNT_REFRESH_TTL),
                truncate(userAgent, 512),
                truncate(requestIp, 64));
        return plain;
    }

    /**
     * Rotate: consume the presented refresh token and hand back a fresh access
     * token + workspace list, exactly as {@link #login} would. The presented
     * row is DELETED atomically with the load so a replay of the same
     * plaintext cannot succeed twice (stolen-token defence). A new refresh
     * token is minted separately by the caller (controller) so the cookie is
     * rewritten in the same response — otherwise the next reload would send a
     * dead token and the user would silently be signed out.
     *
     * <p>Not @Transactional: the delete-then-select-then-insert pattern here
     * mirrors AuthService.refresh (which also deletes on rotation). platform.*
     * has no RLS (V002), so there's no tenant to set up before running.
     */
    public AccountLoginResponse refresh(String plainToken) {
        if (plainToken == null || plainToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Refresh token missing");
        }
        String hash = sha256Hex(plainToken.trim());

        // Load-and-check BEFORE deleting so we can return the right error
        // (expired vs revoked vs unknown) — otherwise every failure looks
        // identical and debugging session bugs becomes impossible.
        StoredRefresh row;
        try {
            row = jdbc.queryForObject("""
                    SELECT id, account_id, expires_at, revoked_at
                      FROM platform.account_refresh_tokens
                     WHERE token_hash = ?
                    """, (rs, i) -> new StoredRefresh(
                    UUID.fromString(rs.getString("id")),
                    UUID.fromString(rs.getString("account_id")),
                    rs.getObject("expires_at", OffsetDateTime.class),
                    rs.getObject("revoked_at", OffsetDateTime.class)), hash);
        } catch (EmptyResultDataAccessException e) {
            // Unknown / already-rotated token. Same 401 as expired so we
            // don't leak "this token used to exist" to an attacker.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired — please sign in again.");
        }
        if (row.revokedAt() != null) {
            // Belt-and-braces: rotation deletes rather than stamps, but a
            // manual admin revoke would set revoked_at. Delete now so the
            // cookie replay stops working.
            jdbc.update("DELETE FROM platform.account_refresh_tokens WHERE id = ?", row.id());
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired — please sign in again.");
        }
        if (row.expiresAt() != null && row.expiresAt().isBefore(OffsetDateTime.now())) {
            jdbc.update("DELETE FROM platform.account_refresh_tokens WHERE id = ?", row.id());
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired — please sign in again.");
        }

        // Load account BEFORE deleting the token: if the account has been
        // disabled between issue and refresh, we should NOT rotate — the
        // cookie should die on the next call, but we still surface a clean
        // 403 rather than silently issuing a fresh session for a dead user.
        AccountCredential account = loadCredentialById(row.accountId());
        if (!"ACTIVE".equals(account.status())) {
            jdbc.update("DELETE FROM platform.account_refresh_tokens WHERE id = ?", row.id());
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
        }

        // Atomically consume the presented row. Delete-by-id, not by hash —
        // hash is UNIQUE anyway, but this way we could not accidentally nuke
        // a different account's token even if a race duplicated the value.
        int deleted = jdbc.update("DELETE FROM platform.account_refresh_tokens WHERE id = ?", row.id());
        if (deleted == 0) {
            // Someone else consumed it between the SELECT and the DELETE —
            // treat as replayed. Refuse the rotation.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired — please sign in again.");
        }

        JwtService.IssuedToken issued = jwt.issueAccountToken(account.accountId(), account.email());
        return new AccountLoginResponse(
                issued.token(),
                issued.expiresAt(),
                toSummary(account),
                workspacesForAccount(account.accountId()));
    }

    /**
     * Sign out of the account portal: delete the presented refresh row so a
     * cookie replay cannot restore the session. Idempotent — an already-gone
     * token is a successful logout.
     */
    public void revokeRefresh(String plainToken) {
        if (plainToken == null || plainToken.isBlank()) return;
        String hash = sha256Hex(plainToken.trim());
        jdbc.update("DELETE FROM platform.account_refresh_tokens WHERE token_hash = ?", hash);
    }

    public List<WorkspaceSummary> workspaces(Jwt accountJwt) {
        return workspacesForAccount(requireAccountId(accountJwt));
    }

    /**
     * OAuth callback helper: build the same {@link AccountLoginResponse} the
     * password login returns, given an already-resolved account id. The caller
     * ({@code GoogleOauthService}) has already verified the ID token,
     * find-or-created the account row, and updated {@code last_login_at}
     * inside its own {@code @Transactional} boundary. This method issues the
     * access-token JWT and packages workspaces exactly as {@link #login}
     * would — the front end on {@code /workspaces} then fetches the same
     * shape via {@code /v1/accounts/auth/refresh}.
     *
     * <p>Deliberately does NOT touch {@code failed_login_count} /
     * {@code last_login_at} — that is the OAuth service's job (it already
     * did it inside the resolve transaction to keep the write atomic with
     * the find-or-create).
     */
    public AccountLoginResponse buildLoginResponseAfterOauth(UUID accountId) {
        AccountCredential account = loadCredentialById(accountId);
        if (!"ACTIVE".equals(account.status())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
        }
        JwtService.IssuedToken issued = jwt.issueAccountToken(account.accountId(), account.email());
        return new AccountLoginResponse(
                issued.token(),
                issued.expiresAt(),
                toSummary(account),
                workspacesForAccount(account.accountId()));
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

    private AccountCredential loadCredentialById(UUID accountId) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, email, display_name, phone, password_hash, status::text,
                           failed_login_count, locked_until
                      FROM platform.accounts
                     WHERE id = ?
                    """, (rs, rowNum) -> new AccountCredential(
                    UUID.fromString(rs.getString("id")),
                    rs.getString("email"),
                    rs.getString("display_name"),
                    rs.getString("phone"),
                    rs.getString("password_hash"),
                    rs.getString("status"),
                    rs.getInt("failed_login_count"),
                    rs.getObject("locked_until", OffsetDateTime.class)), accountId);
        } catch (EmptyResultDataAccessException e) {
            // Account was deleted between issuing the refresh and consuming it.
            // Same shape as a stale-token refresh — 401, no session.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired — please sign in again.");
        }
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    /**
     * 48 random bytes → 64-char URL-safe base64. Same shape and entropy budget
     * as AuthService.randomOpaque — deliberately kept lockstep so ops tooling
     * that grep-matches refresh tokens ({@code ^[A-Za-z0-9_-]{64}$}) works
     * for both tiers.
     */
    private static String randomOpaque(int byteLen) {
        byte[] buf = new byte[byteLen];
        RNG.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    /** Mirror of AuthService.sha256Hex — 64 lowercase hex chars, fits CHAR(64). */
    private static String sha256Hex(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private record StoredRefresh(UUID id, UUID accountId, OffsetDateTime expiresAt, OffsetDateTime revokedAt) {}

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
