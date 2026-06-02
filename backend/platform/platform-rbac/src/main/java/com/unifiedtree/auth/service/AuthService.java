package com.unifiedtree.auth.service;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.dto.AuthDtos.LoginRequest;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.dto.AuthDtos.MeResponse;
import com.unifiedtree.auth.entity.RefreshToken;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.RbacRefreshTokenRepository;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
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

    public AuthService(UserCredentialsRepository credentialsRepo,
                       RbacRefreshTokenRepository refreshRepo,
                       UserRoleRepository userRoleRepo,
                       RoleRepository roleRepo,
                       RolePermissionRepository rolePermissionRepo,
                       PasswordService passwords,
                       JwtService jwt) {
        this.credentialsRepo = credentialsRepo;
        this.refreshRepo = refreshRepo;
        this.userRoleRepo = userRoleRepo;
        this.roleRepo = roleRepo;
        this.rolePermissionRepo = rolePermissionRepo;
        this.passwords = passwords;
        this.jwt = jwt;
    }

    public LoginResponse login(LoginRequest req) {
        // Bind the caller-supplied tenant id BEFORE touching the repos so RLS
        // can scope auth.user_credentials and rbac.user_roles correctly.
        TenantContext.setTenantId(req.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(req.tenantId());

        UserCredentials creds = credentialsRepo.findByEmailIgnoreCase(req.email())
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

        return issueSession(creds, req.tenantId());
    }

    /**
     * Issue a normal tenant-scoped ERP session after a global account token has
     * already proved the caller can enter this workspace. This deliberately does
     * not check a password; account membership is validated by the SaaS account
     * service before calling this method.
     */
    public LoginResponse issueWorkspaceSession(UUID tenantId, UUID authUserId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);

        UserCredentials creds = credentialsRepo.findById(authUserId)
            .orElseThrow(() -> new BusinessRuleException("Workspace account not found", "WORKSPACE_USER_NOT_FOUND"));
        if (!creds.isActive()) {
            throw new BusinessRuleException("Account is inactive", "ACCOUNT_INACTIVE");
        }
        if (creds.getLockedUntil() != null
                && creds.getLockedUntil().isAfter(OffsetDateTime.now())) {
            throw new BusinessRuleException("Account is temporarily locked", "ACCOUNT_LOCKED");
        }
        return issueSession(creds, tenantId);
    }

    private LoginResponse issueSession(UserCredentials creds, UUID tenantId) {
        // Reset failure counter on success and update audit-friendly login time.
        creds.setFailedLoginCount(0);
        creds.setLastLoginAt(OffsetDateTime.now());
        credentialsRepo.save(creds);

        List<UUID> roleIds = userRoleRepo.findAllByUserId(creds.getId())
            .stream().map(UserRole::getRoleId).toList();

        List<String> roleCodes = roleIds.isEmpty()
            ? List.of()
            : roleRepo.findAllById(roleIds).stream()
                .map(com.unifiedtree.rbac.entity.Role::getCode)
                .sorted()
                .collect(Collectors.toList());

        List<String> permissions = roleIds.isEmpty()
            ? List.of()
            : rolePermissionRepo.findPermissionCodesByRoleIds(roleIds).stream()
                .distinct()
                .sorted()
                .collect(Collectors.toList());

        // Mint access token (employee_id claim lets AttendanceController resolve the employee).
        JwtService.IssuedToken access = jwt.issueAccessToken(
            creds.getId(), tenantId, creds.getEmail(), roleCodes, permissions, creds.getEmployeeId());

        String refreshPlain = randomOpaque(48);
        String refreshHash  = sha256Hex(refreshPlain);
        RefreshToken rt = new RefreshToken();
        rt.setUserId(creds.getId());
        rt.setTokenHash(refreshHash);
        rt.setIssuedAt(OffsetDateTime.now());
        rt.setExpiresAt(OffsetDateTime.now().plus(jwt.refreshTokenTtl()));
        refreshRepo.save(rt);

        return new LoginResponse(
            access.token(), refreshPlain, access.expiresAt(),
            creds.getId(), creds.getEmployeeId(), tenantId, creds.getEmail(),
            roleCodes, permissions);
    }

    /** Issue a session for a user that just activated via invitation/password reset. */
    @Transactional
    public LoginResponse issueSessionForActivatedUser(UUID userId, UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        UserCredentials creds = credentialsRepo.findById(userId)
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
        List<String> permissions = roleIds.isEmpty()
            ? List.of()
            : rolePermissionRepo.findPermissionCodesByRoleIds(roleIds).stream()
                .distinct().sorted().toList();
        return new MeResponse(userId, tenantId, creds.getEmail(), roleCodes, permissions);
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
