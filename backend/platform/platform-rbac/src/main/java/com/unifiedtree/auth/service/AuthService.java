package com.unifiedtree.auth.service;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.dto.AuthDtos.MeResponse;
import com.unifiedtree.auth.entity.RefreshToken;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.mfa.MfaChallengeTokens;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.session.SessionDevice;
import com.unifiedtree.auth.session.SignedInEvent;
import com.unifiedtree.auth.repository.RbacRefreshTokenRepository;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Login + token issuance for the canonical auth flow.
 *
 * <p>Login is unusual: the request comes in WITHOUT an authenticated tenant
 * yet, so we have to seed {@link TenantContext} from the request body before
 * the JPA repositories can find the credential row (RLS-isolated). The
 * caller commits to a tenant up front by sending {@code tenantId}.
 *
 * <p>Refresh tokens are opaque, server-side hashed, replace-on-use.
 */
@Service
@Transactional
public class AuthService {

    private final UserCredentialsRepository credentialsRepo;
    private final RbacRefreshTokenRepository refreshRepo;
    private final UserRoleRepository userRoleRepo;
    private final RoleRepository roleRepo;
    private final RolePermissionRepository rolePermissionRepo;
    private final PasswordService passwords;
    private final JwtService jwt;
    private final JdbcTemplate jdbc;
    private final com.unifiedtree.rbac.security.EmployeeBaselinePermissions employeeBaseline;
    private final MfaService mfa;
    private final MfaChallengeTokens mfaChallenges;

    /**
     * How a password sign-in ended: a session, or a stop at the two-factor
     * step ({@code mfaToken} + what the step is).
     */
    public record LoginOutcome(LoginResponse session, String mfaToken,
                               MfaChallengeTokens.Purpose mfaPurpose, String email) {
        public boolean needsMfa() { return session == null; }
    }

    public AuthService(UserCredentialsRepository credentialsRepo,
                       RbacRefreshTokenRepository refreshRepo,
                       UserRoleRepository userRoleRepo,
                       RoleRepository roleRepo,
                       RolePermissionRepository rolePermissionRepo,
                       PasswordService passwords,
                       JwtService jwt,
                       JdbcTemplate jdbc,
                       com.unifiedtree.rbac.security.EmployeeBaselinePermissions employeeBaseline,
                       MfaService mfa,
                       MfaChallengeTokens mfaChallenges) {
        this.credentialsRepo = credentialsRepo;
        this.refreshRepo = refreshRepo;
        this.userRoleRepo = userRoleRepo;
        this.roleRepo = roleRepo;
        this.rolePermissionRepo = rolePermissionRepo;
        this.passwords = passwords;
        this.jwt = jwt;
        this.jdbc = jdbc;
        this.employeeBaseline = employeeBaseline;
        this.mfa = mfa;
        this.mfaChallenges = mfaChallenges;
    }

    /** Tells listeners (the audit log) about each new sign-in. Optional, so tests can build the service bare. */
    private org.springframework.context.ApplicationEventPublisher events;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setEvents(org.springframework.context.ApplicationEventPublisher events) {
        this.events = events;
    }

    /**
     * Works out "personalPages" for the sign-in answer and /me (V143.90). Optional,
     * so tests can build the service bare; without it the field is null and the
     * clients keep their own role rule.
     */
    private com.unifiedtree.rbac.service.PersonalPagesService personalPages;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setPersonalPages(com.unifiedtree.rbac.service.PersonalPagesService personalPages) {
        this.personalPages = personalPages;
    }

    /** Whether this person sees the personal pages; null when the service is absent. */
    private Boolean personalPagesFor(UUID tenantId, List<UUID> roleIds) {
        return personalPages == null ? null : personalPages.forRoles(tenantId, roleIds);
    }

    /**
     * Resolve which workspace an email belongs to WITHOUT an authenticated
     * tenant context — used for email-only login (the app sends no workspace).
     *
     * <p>auth.user_credentials is RLS-protected with FORCE ROW LEVEL SECURITY,
     * so a single query cannot read it across tenants. Instead we iterate the
     * known tenants and, for each, bind the RLS context transaction-locally with
     * {@code set_config('app.tenant_id', <uuid>, true)} and count matching rows.
     * The class is {@code @Transactional}, so every statement here shares one
     * connection — the per-iteration {@code set_config} reliably re-scopes RLS.
     *
     * <p>Self-contained: needs NO superuser SQL function and NO extra deploy
     * step. Returns null when the email matches no workspace (caller surfaces a
     * generic invalid-credentials error); when it matches several, returns the
     * most-recently-logged-into one (see the loop below).
     *
     * <p>Never the platform tenant: platform operators are not workspace users
     * ({@link WorkspaceSignInRule#isPlatformOperator}).
     */
    public UUID resolveLoginTenant(String email) {
        if (email == null || email.isBlank()) return null;
        final String norm = email.trim();
        if (singleLookupAvailable()) {
            // One indexed lookup (V143.2) instead of two queries per workspace.
            UUID found = jdbc.queryForObject("SELECT auth.login_tenant_for_email(?)", UUID.class, norm);
            // The lookup can still name the platform tenant (an operator's email). Then look
            // again among the businesses only, so an address that is also a business login
            // still reaches that business; the scan below skips the platform tenant.
            if (!TenantContext.PLATFORM_TENANT_ID.equals(found)) return found;
        }
        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList(
                    "SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            // status column may be absent on older schemas — fall back to all tenants.
            try {
                tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class);
            } catch (Exception e2) {
                return null;
            }
        }
        // When an email belongs to exactly one workspace (the normal employee
        // case) we return it. When it belongs to several (e.g. a founder who
        // created multiple workspaces with the same email) we land on the one
        // most-recently logged into, rather than failing — the password is still
        // verified within that tenant by login().
        UUID match = null;
        double bestEpoch = Double.NEGATIVE_INFINITY;
        for (UUID t : tenantIds) {
            if (TenantContext.PLATFORM_TENANT_ID.equals(t)) continue;
            try {
                jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)",
                        String.class, t.toString());
                Map<String, Object> row = jdbc.queryForMap(
                        "SELECT count(*) AS c, EXTRACT(EPOCH FROM MAX(last_login_at)) AS ep "
                        + "FROM auth.user_credentials WHERE lower(email) = lower(?)", norm);
                long c = ((Number) row.get("c")).longValue();
                if (c == 0) continue;
                double ep = row.get("ep") == null
                        ? Double.NEGATIVE_INFINITY
                        : ((Number) row.get("ep")).doubleValue();
                if (match == null || ep > bestEpoch) {
                    match = t;
                    bestEpoch = ep;
                }
            } catch (Exception ignored) {
                // skip a tenant we can't read; keep scanning
            }
        }
        return match;
    }

    /**
     * Whether the V143.2 routing functions exist. Positive answers are cached
     * (functions don't disappear); a negative one is re-checked next call so an
     * instance picks the functions up as soon as the migration lands. The
     * catalog check never errors, so it can't abort the surrounding transaction.
     */
    private volatile boolean singleLookup;

    private boolean singleLookupAvailable() {
        if (singleLookup) return true;
        try {
            singleLookup = Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT to_regprocedure('auth.login_tenant_for_email(text)') IS NOT NULL "
                            + "AND to_regprocedure('auth.refresh_token_tenant(text)') IS NOT NULL",
                    Boolean.class));
        } catch (Exception e) {
            singleLookup = false;
        }
        return singleLookup;
    }

    /**
     * Password sign-in for clients that cannot show the two-factor step. An
     * account that needs a code is refused (see {@link #loginWithMfa}).
     */
    public LoginResponse login(LoginRequest req) {
        return loginWithMfa(req, false).session();
    }

    /**
     * Password sign-in. When the account has two-factor on, or the workspace
     * requires it for this person, a correct password does NOT issue a
     * session: an MFA-capable client (the web app) gets a challenge token for
     * the code step; any other client (the mobile app today) gets a 403 that
     * says how to sign in instead. Nobody gets a session without the code.
     */
    public LoginOutcome loginWithMfa(LoginRequest req, boolean mfaCapable) {
        // tenantId is optional: on email-only mobile login the controller has
        // already resolved + bound the tenant context BEFORE this @Transactional
        // boundary, so honor that when the request omits it.
        UUID tenantId = req.tenantId() != null ? req.tenantId() : TenantContext.getTenantId();

        // Platform operators sign in at /v1/platform/auth/login only: here the
        // platform tenant answers exactly like an unknown email.
        if (TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) {
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }

        // Bind the resolved tenant id BEFORE touching the repos so RLS can scope
        // auth.user_credentials and rbac.user_roles correctly.
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);

        UserCredentials creds = credentialsRepo.findByEmailForSession(req.email())
            .orElseThrow(() -> new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS"));

        if (!creds.isActive()) {
            throw new BusinessRuleException("Account is inactive", "ACCOUNT_INACTIVE");
        }
        if (creds.getLockedUntil() != null
                && creds.getLockedUntil().isAfter(OffsetDateTime.now())) {
            throw new BusinessRuleException("Account is temporarily locked", "ACCOUNT_LOCKED");
        }
        if (!passwords.matches(req.password(), creds.getPasswordHash())) {
            creds.setFailedLoginCount(creds.getFailedLoginCount() + 1);
            credentialsRepo.save(creds);
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }

        List<String> roleCodes = roleCodesFor(creds.getId());
        if (WorkspaceSignInRule.isPlatformOperator(tenantId, roleCodes)) {
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }
        MfaService.Requirement need = mfa.requirementFor(tenantId, creds.getId(), roleCodes);
        if (need == MfaService.Requirement.NONE) {
            return new LoginOutcome(issueSession(creds, tenantId), null, null, creds.getEmail());
        }
        if (!mfaCapable) {
            if (need == MfaService.Requirement.VERIFY) {
                throw new com.hrms.core.exception.HrmsException(
                        "Two-factor sign-in is on for this account. The app can't ask for the code yet, so sign in "
                                + "with your mobile number (text-message code) here, or sign in on the web.",
                        org.springframework.http.HttpStatus.FORBIDDEN, "MFA_REQUIRED");
            }
            throw new com.hrms.core.exception.HrmsException(
                    "Your workspace requires two-factor sign-in. Sign in on the web once to set it up. "
                            + "In the app, sign in with your mobile number (text-message code).",
                    org.springframework.http.HttpStatus.FORBIDDEN, "MFA_SETUP_REQUIRED");
        }
        MfaChallengeTokens.Purpose purpose = need == MfaService.Requirement.VERIFY
                ? MfaChallengeTokens.Purpose.VERIFY : MfaChallengeTokens.Purpose.SETUP;
        return new LoginOutcome(null, mfaChallenges.issue(creds.getId(), tenantId, creds.getEmail(), purpose),
                purpose, creds.getEmail());
    }

    /**
     * Issue the session once the two-factor step passed (the controller has
     * checked the code). Same account checks as a password sign-in.
     */
    public LoginResponse completeMfaLogin(UUID tenantId, UUID userId) {
        if (TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) {
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        UserCredentials creds = credentialsRepo.findByIdForSession(userId)
            .orElseThrow(() -> new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS"));
        if (!creds.isActive()) {
            throw new BusinessRuleException("Account is inactive", "ACCOUNT_INACTIVE");
        }
        if (creds.getLockedUntil() != null && creds.getLockedUntil().isAfter(OffsetDateTime.now())) {
            throw new BusinessRuleException("Account is temporarily locked", "ACCOUNT_LOCKED");
        }
        return issueSession(creds, tenantId);
    }

    /** Built-in and custom role codes held by a sign-in account. */
    private List<String> roleCodesFor(UUID userId) {
        List<UUID> roleIds = userRoleRepo.findAllByUserId(userId).stream().map(UserRole::getRoleId).toList();
        return roleIds.isEmpty() ? List.of()
                : roleRepo.findAllById(roleIds).stream().map(com.unifiedtree.rbac.entity.Role::getCode).toList();
    }

    /**
     * Rotate an access token using a valid refresh token (Play Store-grade
     * session: a brief 401 from token expiry MUST NOT log the user out — the
     * mobile axios interceptor calls this transparently and retries).
     *
     * <p>auth.refresh_tokens has FORCE ROW LEVEL SECURITY; the refresh hash is
     * a 256-bit random value, so a per-tenant scan to find its owning tenant is
     * collision-safe AND avoids any superuser/SECURITY DEFINER plumbing — same
     * pattern as {@link #resolveLoginTenant}. Once the tenant is bound, the old
     * row is invalidated (rotation) and a fresh access + refresh pair is minted
     * via {@link #issueSession}.
     */
    public LoginResponse refresh(String refreshTokenPlain) {
        if (refreshTokenPlain == null || refreshTokenPlain.isBlank()) {
            throw new BusinessRuleException("Refresh token missing", "REFRESH_INVALID");
        }
        final String hash = sha256Hex(refreshTokenPlain.trim());

        List<UUID> tenantIds;
        if (singleLookupAvailable()) {
            // One indexed lookup (V143.2) names the token's workspace; the loop
            // below then runs once, for that workspace only.
            UUID owner = jdbc.queryForObject("SELECT auth.refresh_token_tenant(?)", UUID.class, hash);
            // A platform-tenant token (only the workspace door ever minted one, before F1 was
            // closed) is answered like an unknown token: operators get no workspace session.
            if (owner == null || TenantContext.PLATFORM_TENANT_ID.equals(owner)) {
                throw new BusinessRuleException("Session expired — please sign in again.", "REFRESH_NOT_FOUND");
            }
            tenantIds = List.of(owner);
        } else {
            try {
                tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class);
            } catch (Exception e) {
                throw new BusinessRuleException("Session expired — please sign in again.", "REFRESH_INVALID");
            }
        }

        for (UUID t : tenantIds) {
            if (TenantContext.PLATFORM_TENANT_ID.equals(t)) continue;
            try {
                jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)",
                        String.class, t.toString());
                Optional<RefreshToken> maybe = refreshRepo.findByTokenHash(hash);
                if (maybe.isEmpty()) continue;

                RefreshToken rt = maybe.get();
                if (rt.getExpiresAt() != null && rt.getExpiresAt().isBefore(OffsetDateTime.now())) {
                    refreshRepo.delete(rt);
                    throw new BusinessRuleException("Session expired — please sign in again.", "REFRESH_EXPIRED");
                }
                if (rt.getRevokedAt() != null) {
                    throw new BusinessRuleException("Session expired — please sign in again.", "REFRESH_REVOKED");
                }

                // Bind the canonical tenant contexts so issueSession's RLS-scoped
                // writes (delete of the old row + insert of the new one + update
                // of last_login_at) all see the right tenant.
                TenantContext.setTenantId(t);
                com.hrms.core.tenant.TenantContext.setTenantId(t);

                UserCredentials creds = credentialsRepo.findByIdForSession(rt.getUserId())
                        .orElseThrow(() -> new BusinessRuleException("Session expired — please sign in again.", "REFRESH_USER_GONE"));
                if (!creds.isActive()) {
                    throw new BusinessRuleException("Account is inactive", "ACCOUNT_INACTIVE");
                }

                // Rotate: invalidate the old refresh token so the same plaintext
                // cannot be replayed (defends against stolen-token replay).
                refreshRepo.delete(rt);
                return issueSession(creds, t, new SessionCarry(
                        rt.getSessionId() != null ? rt.getSessionId() : rt.getId(),
                        rt.getSessionStartedAt() != null ? rt.getSessionStartedAt() : rt.getIssuedAt()));
            } catch (BusinessRuleException bre) {
                throw bre;
            } catch (Exception ignored) {
                // unreadable tenant; keep scanning
            }
        }
        throw new BusinessRuleException("Session expired — please sign in again.", "REFRESH_NOT_FOUND");
    }

    /**
     * Invalidate a refresh token on sign-out.
     *
     * <p>Without this, "log out" would only discard the in-memory access token
     * while leaving a valid refresh credential in the browser's cookie jar —
     * so the very next page load would silently sign the user back in. On a
     * shared machine that is a real problem, not a cosmetic one.
     *
     * <p>Takes the tenant explicitly (the caller knows it from the request
     * context) so this is ONE indexed lookup, rather than the tenant-by-tenant
     * scan {@link #refresh} is forced into when all it has is an opaque token.
     *
     * <p>Deleting rather than stamping revoked_at keeps it consistent with the
     * rotation in refresh(), which also deletes. Idempotent: a token that is
     * already gone is a successful logout.
     */
    @Transactional
    public void revokeRefreshToken(String refreshTokenPlain, UUID tenantId) {
        if (refreshTokenPlain == null || refreshTokenPlain.isBlank() || tenantId == null) return;
        String hash = sha256Hex(refreshTokenPlain.trim());
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
        refreshRepo.findByTokenHash(hash).ifPresent(refreshRepo::delete);
    }

    /**
     * Issue a normal tenant-scoped ERP session after a global account token has
     * already proved the caller can enter this workspace. This deliberately does
     * not check a password; account membership is validated by the SaaS account
     * service before calling this method.
     */
    public LoginResponse issueWorkspaceSession(UUID tenantId, UUID authUserId) {
        // Phone, Google and account hand-over: the platform tenant is no workspace.
        if (TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) {
            throw new BusinessRuleException("Workspace account not found", "WORKSPACE_USER_NOT_FOUND");
        }
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);

        UserCredentials creds = credentialsRepo.findByIdForSession(authUserId)
            .orElseThrow(() -> new BusinessRuleException("Workspace account not found", "WORKSPACE_USER_NOT_FOUND"));
        // Same rule as Marketing sign-in (WorkspaceSignInRule): inactive or locked is refused everywhere
        WorkspaceSignInRule.refusal(creds.isActive(), creds.getLockedUntil(), OffsetDateTime.now()).ifPresent(code -> {
            throw new BusinessRuleException(WorkspaceSignInRule.ACCOUNT_INACTIVE.equals(code)
                    ? "Account is inactive" : "Account is temporarily locked", code);
        });
        return issueSession(creds, tenantId);
    }

    /** A refresh keeps the session: its id (the JWT "sid") and when it began. */
    private record SessionCarry(UUID sessionId, OffsetDateTime startedAt) {}

    private LoginResponse issueSession(UserCredentials creds, UUID tenantId) {
        return issueSession(creds, tenantId, null);
    }

    private LoginResponse issueSession(UserCredentials creds, UUID tenantId, SessionCarry carry) {
        List<UUID> roleIds = userRoleRepo.findAllByUserId(creds.getId())
            .stream().map(UserRole::getRoleId).toList();

        List<String> roleCodes = roleIds.isEmpty()
            ? List.of()
            : roleRepo.findAllById(roleIds).stream()
                .map(com.unifiedtree.rbac.entity.Role::getCode)
                .sorted()
                .collect(Collectors.toList());

        // The last line for every way in: never a workspace session for a platform
        // operator (each door above already refuses them with its own answer).
        if (WorkspaceSignInRule.isPlatformOperator(tenantId, roleCodes)) {
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }

        // Reset failure counter on success and update audit-friendly login time.
        creds.setFailedLoginCount(0);
        creds.setLastLoginAt(OffsetDateTime.now());
        credentialsRepo.save(creds);

        // Effective permissions = assigned-role grants UNION the employee
        // baseline. Being an employee is a fact (the credential carries an
        // employee_id), not a role that a promotion can take away — see
        // EmployeeBaselinePermissions for why. Without this union, promoting
        // someone to DEPT_MANAGER silently revoked their ability to enrol their
        // own face, punch in, or read their own payslip.
        List<String> rolePerms = roleIds.isEmpty()
            ? List.of()
            : rolePermissionRepo.findPermissionCodesByRoleIds(roleIds);
        // Per-person overrides (V143.17) are applied last: GRANTs added, DENYs removed.
        List<String> permissions = employeeBaseline.effectiveFor(rolePerms, creds.getEmployeeId(), creds.getId());

        // One session = one refresh-token chain. A new sign-in starts a session;
        // a refresh continues it (same id, same start). The id rides in the
        // access token as "sid" so a signed-out session stops at once.
        OffsetDateTime now = OffsetDateTime.now();
        UUID sessionId = carry != null ? carry.sessionId() : UUID.randomUUID();
        SessionDevice.ClientInfo client = SessionDevice.currentClient();

        // Mint access token (employee_id claim lets AttendanceController resolve the employee).
        JwtService.IssuedToken access = jwt.issueAccessToken(
            creds.getId(), tenantId, creds.getEmail(), roleCodes, permissions, creds.getEmployeeId(), sessionId);

        String refreshPlain = randomOpaque(48);
        String refreshHash  = sha256Hex(refreshPlain);
        RefreshToken rt = new RefreshToken();
        rt.setUserId(creds.getId());
        rt.setTokenHash(refreshHash);
        rt.setIssuedAt(now);
        rt.setExpiresAt(now.plus(sessionTtl(jwt.refreshTokenTtl(), client.userAgent())));
        rt.setSessionId(sessionId);
        rt.setSessionStartedAt(carry != null && carry.startedAt() != null ? carry.startedAt() : now);
        rt.setLastUsedAt(now);
        rt.setUserAgent(client.userAgent());
        rt.setIpAddress(client.ipAddress());
        refreshRepo.save(rt);

        // A new session is a sign-in (a refresh carries the old one and is not).
        // Never let the notice fail the sign-in itself.
        if (carry == null && events != null) {
            try {
                events.publishEvent(new SignedInEvent(tenantId, creds.getId(), creds.getEmail(), sessionId,
                        client.userAgent(), client.ipAddress()));
            } catch (RuntimeException e) {
                org.slf4j.LoggerFactory.getLogger(AuthService.class)
                        .warn("sign-in notice not published for user {}: {}", creds.getId(), e.toString());
            }
        }

        String firstName = "";
        String lastName = "";
        if (creds.getEmployeeId() != null) {
            List<java.util.Map<String, Object>> rows = jdbc.queryForList("SELECT first_name, last_name FROM hrms.employees WHERE id = ?", creds.getEmployeeId());
            if (!rows.isEmpty()) {
                firstName = (String) rows.get(0).get("first_name");
                lastName = (String) rows.get(0).get("last_name");
            }
        }

        return new LoginResponse(
            access.token(), refreshPlain, access.expiresAt(),
            creds.getId(), creds.getEmployeeId(), tenantId, creds.getEmail(),
            firstName, lastName, roleCodes, permissions, personalPagesFor(tenantId, roleIds));
    }

    /**
     * How long this session lasts without use: the configured refresh-token
     * life, but never longer than a browser's refresh cookie for a browser
     * (see {@link SessionDevice#BROWSER_SESSION_TTL}). The mobile app keeps the
     * full life.
     */
    static java.time.Duration sessionTtl(java.time.Duration configured, String userAgent) {
        if ("web".equals(SessionDevice.kind(userAgent)) && SessionDevice.BROWSER_SESSION_TTL.compareTo(configured) < 0) {
            return SessionDevice.BROWSER_SESSION_TTL;
        }
        return configured;
    }

    /** Issue a session for a user that just activated via invitation/password reset. */
    @Transactional
    public LoginResponse issueSessionForActivatedUser(UUID userId, UUID tenantId) {
        if (TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) {
            throw new BusinessRuleException("User not found", "USER_NOT_FOUND");
        }
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        UserCredentials creds = credentialsRepo.findByIdForSession(userId)
            .orElseThrow(() -> new BusinessRuleException("User not found", "USER_NOT_FOUND"));
        return issueSession(creds, tenantId);
    }

    @Transactional(readOnly = true)
    public MeResponse currentUser() {
        UUID userId = TenantContext.getUserId();
        UUID tenantId = TenantContext.getTenantId();
        if (userId == null || tenantId == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }
        Optional<UserCredentials> credsOpt = credentialsRepo.findById(userId);
        if (credsOpt.isEmpty()) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }
        UserCredentials creds = credsOpt.get();
        List<UUID> roleIds = userRoleRepo.findAllByUserId(userId).stream()
            .map(UserRole::getRoleId).toList();
        List<String> roleCodes = roleIds.isEmpty()
            ? List.of()
            : roleRepo.findAllById(roleIds).stream()
                .map(com.unifiedtree.rbac.entity.Role::getCode)
                .sorted().toList();
        // Same union as issueSession — /me must report exactly the permission
        // set the JWT was minted with, or the SPA hides affordances the backend
        // would in fact allow.
        List<String> rolePerms = roleIds.isEmpty()
            ? List.of()
            : rolePermissionRepo.findPermissionCodesByRoleIds(roleIds);
        List<String> permissions = employeeBaseline.effectiveFor(rolePerms, creds.getEmployeeId(), userId);
        // In a company the caller reaches through a grant (X-Company-Id), /me
        // reports their roles and permissions THERE, the set this request's
        // checks use (CompanyAccessFilter). No header / home company: unchanged.
        CompanyContext.Scope scope = CompanyContext.getScope();
        if (scope != null) {
            roleIds = List.copyOf(scope.roleIds());
            roleCodes = scope.roleCodes().stream().sorted().toList();
            permissions = scope.permissions().stream().sorted().toList();
        }
        // ACTIVE modules come straight from platform.tenant_modules — the source
        // of truth for what the workspace selected/activated — NOT derived from
        // permissions. Same query pattern as WorkspaceAccessService.activeModuleKeys
        // and SaasService.workspaceStatus.
        List<String> activeModules = jdbc.queryForList(
            "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY module_key",
            String.class, tenantId);
        
        String firstName = "";
        String lastName = "";
        if (creds.getEmployeeId() != null) {
            List<java.util.Map<String, Object>> rows = jdbc.queryForList("SELECT first_name, last_name FROM hrms.employees WHERE id = ?", creds.getEmployeeId());
            if (!rows.isEmpty()) {
                firstName = (String) rows.get(0).get("first_name");
                lastName = (String) rows.get(0).get("last_name");
            }
        }
        
        return new MeResponse(userId, tenantId, creds.getEmail(), firstName, lastName, roleCodes, permissions, activeModules,
            personalPagesFor(tenantId, roleIds));
    }

    // ---- helpers --------------------------------------------------------------

    private static final SecureRandom RNG = new SecureRandom();

    private static String randomOpaque(int byteLen) {
        byte[] buf = new byte[byteLen];
        RNG.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    private static String sha256Hex(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
