package com.hrms.api.invitation;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.rbac.entity.Role;
import com.unifiedtree.rbac.entity.UserRole;
import com.unifiedtree.rbac.repository.RoleRepository;
import com.unifiedtree.rbac.repository.UserRoleRepository;
import com.unifiedtree.security.tenant.TenantContext;
import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class InvitationService {

    private static final Logger log = LoggerFactory.getLogger(InvitationService.class);
    private static final SecureRandom RNG = new SecureRandom();

    private final UserCredentialsRepository credRepo;
    private final UserRoleRepository userRoleRepo;
    private final RoleRepository roleRepo;
    private final InvitationTokenRepository tokenRepo;
    private final PasswordService passwordService;
    private final AuthService canonicalAuthService;
    private final MailService mailService;
    private final JdbcTemplate jdbc;

    @Value("${unifiedtree.mail.invite-url-base:${unifiedtree.invitation.platform-base-url:http://localhost:3001}}")
    private String platformBaseUrl;

    public InvitationService(UserCredentialsRepository credRepo,
                             UserRoleRepository userRoleRepo,
                             RoleRepository roleRepo,
                             InvitationTokenRepository tokenRepo,
                             PasswordService passwordService,
                             AuthService canonicalAuthService,
                             MailService mailService,
                             JdbcTemplate jdbc) {
        this.credRepo            = credRepo;
        this.userRoleRepo        = userRoleRepo;
        this.roleRepo            = roleRepo;
        this.tokenRepo           = tokenRepo;
        this.passwordService     = passwordService;
        this.canonicalAuthService = canonicalAuthService;
        this.mailService         = mailService;
        this.jdbc                = jdbc;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Send invitation
    // ──────────────────────────────────────────────────────────────────────────

    @Transactional
    public InvitationResult sendInvitation(UUID employeeId, UUID tenantId, UUID actorId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);

        Map<String, Object> emp = loadEmployee(employeeId, tenantId);
        String email     = (String) emp.get("email");
        String firstName = (String) emp.get("first_name");
        String tenantName = loadTenantName(tenantId);
        String tenantSlug = loadTenantSlug(tenantId);

        // Find-or-create auth.user_credentials row (with no password yet)
        UserCredentials creds = credRepo.findByEmailIgnoreCase(email).orElseGet(() -> {
            UserCredentials c = new UserCredentials();
            // Do NOT set id — BaseEntity uses @GeneratedValue(UUID). Assigning it
            // manually makes Hibernate treat the row as a detached entity with a
            // null @Version and the save fails.
            c.setTenantId(tenantId);
            c.setEmail(email);
            c.setEmployeeId(employeeId);
            c.setActive(false); // cannot login until they set their password
            return credRepo.save(c);
        });

        // Grant EMPLOYEE role if not already granted (canonical rbac.user_roles)
        boolean hasRole = userRoleRepo.findAllByUserId(creds.getId()).stream()
            .anyMatch(ur -> {
                Role r = roleRepo.findById(ur.getRoleId()).orElse(null);
                return r != null && "EMPLOYEE".equals(r.getCode());
            });
        if (!hasRole) {
            roleRepo.findAll().stream()
                .filter(r -> "EMPLOYEE".equals(r.getCode()))
                .findFirst()
                .ifPresent(role -> {
                    UserRole ur = new UserRole();
                    ur.setTenantId(tenantId);
                    ur.setUserId(creds.getId());
                    ur.setRoleId(role.getId());
                    ur.setGrantedAt(OffsetDateTime.now());
                    ur.setGrantedBy(actorId);
                    userRoleRepo.save(ur);
                });
        }

        // Mark invited_at
        creds.setInvitedAt(OffsetDateTime.now());
        credRepo.save(creds);

        // Invalidate any existing pending invitation tokens
        tokenRepo.invalidatePreviousTokens(creds.getId(), "INVITATION", OffsetDateTime.now());

        // Issue new invitation token
        String rawToken = randomToken();
        String hash     = sha256Hex(rawToken);
        OffsetDateTime expiresAt = OffsetDateTime.now().plusHours(72);

        InvitationToken token = new InvitationToken();
        token.setTenantId(tenantId);
        token.setUserId(creds.getId());
        token.setTokenHash(hash);
        token.setPurpose("INVITATION");
        token.setExpiresAt(expiresAt);
        token.setCreatedBy(actorId);
        tokenRepo.save(token);

        // Build invite URL: uses tenantSlug.localhost:3001 for dev, tenantSlug.ionora.app for prod
        String inviteUrl = buildUrl(tenantSlug, "/accept-invite?token=" + rawToken);

        // Send email
        sendEmail(email, "Welcome to " + tenantName,
            inviteHtml(firstName, tenantName, inviteUrl));

        log.info("Invitation sent to {} (employee {})", email, employeeId);
        return new InvitationResult(true, expiresAt);
    }

    @Transactional
    public InvitationResult resendInvitation(UUID employeeId, UUID tenantId, UUID actorId) {
        return sendInvitation(employeeId, tenantId, actorId);
    }

    /**
     * Issue an invitation token + send the invite email to an EXISTING
     * auth.user_credentials row that has no hrms.employees record (a workspace
     * user invited without creating an employee). Reuses the same token/email
     * path as {@link #sendInvitation} — no duplication. The credential's display
     * name falls back to the email local-part since there is no employee.
     */
    @Transactional
    public InvitationResult sendInviteToCredential(UUID userId, UUID tenantId, UUID actorId) {
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        setDbTenantContext(tenantId);

        UserCredentials creds = credRepo.findById(userId)
            .orElseThrow(() -> new BusinessRuleException("User not found", "USER_NOT_FOUND"));

        String firstName  = creds.getEmail().split("@")[0];
        String tenantName = loadTenantName(tenantId);
        String tenantSlug = loadTenantSlug(tenantId);

        creds.setInvitedAt(OffsetDateTime.now());
        credRepo.save(creds);

        tokenRepo.invalidatePreviousTokens(creds.getId(), "INVITATION", OffsetDateTime.now());

        String rawToken = randomToken();
        OffsetDateTime expiresAt = OffsetDateTime.now().plusHours(72);
        InvitationToken token = new InvitationToken();
        token.setTenantId(tenantId);
        token.setUserId(creds.getId());
        token.setTokenHash(sha256Hex(rawToken));
        token.setPurpose("INVITATION");
        token.setExpiresAt(expiresAt);
        token.setCreatedBy(actorId);
        tokenRepo.save(token);

        String inviteUrl = buildUrl(tenantSlug, "/accept-invite?token=" + rawToken);
        sendEmail(creds.getEmail(), "Welcome to " + tenantName,
            inviteHtml(firstName, tenantName, inviteUrl));

        log.info("Workspace invite sent to {} (no employee record)", creds.getEmail());
        return new InvitationResult(true, expiresAt);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Accept invitation (set password)
    // ──────────────────────────────────────────────────────────────────────────

    @Transactional
    public AcceptInviteResponse acceptInvitation(String rawToken, String newPassword) {
        // Resolve the token WITHOUT tenant context — the public accept flow does
        // not know the tenant yet. The SECURITY DEFINER function bypasses RLS.
        ResolvedToken rt = resolveToken(sha256Hex(rawToken), "INVITATION",
            "Invitation link is invalid or has already been used.", "INVITATION_INVALID",
            "This invitation link has expired. Ask your administrator to send a new one.", "INVITATION_EXPIRED");

        validatePassword(newPassword);

        UUID tenantId = rt.tenantId();
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        setDbTenantContext(tenantId);

        UserCredentials creds = credRepo.findById(rt.userId())
            .orElseThrow(() -> new BusinessRuleException("User not found", "USER_NOT_FOUND"));

        creds.setPasswordHash(passwordService.hash(newPassword));
        creds.setActive(true);
        credRepo.save(creds);

        markTokenUsed(rt.id());

        // Also update hrms.employees.employment_status to ACTIVE if still INVITED/DRAFT
        jdbc.update("""
            UPDATE hrms.employees
               SET employment_status = 'ACTIVE', updated_at = now()
             WHERE id = ? AND tenant_id = ?
               AND employment_status IN ('DRAFT','INVITED')
            """, creds.getEmployeeId(), tenantId);

        LoginResponse loginResp = canonicalAuthService.issueSessionForActivatedUser(creds.getId(), tenantId);

        String tenantName = loadTenantName(tenantId);
        String tenantSlug = loadTenantSlug(tenantId);
        List<String> activeModules = loadActiveModules(tenantId);

        return new AcceptInviteResponse(
            loginResp.accessToken(), loginResp.refreshToken(),
            loginResp.accessTokenExpiresAt() != null ? loginResp.accessTokenExpiresAt().toString() : null,
            creds.getId(), creds.getEmployeeId(), tenantId, creds.getEmail(),
            loginResp.roles(), loginResp.permissions(),
            tenantSlug, tenantName, activeModules
        );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Forgot / reset password
    // ──────────────────────────────────────────────────────────────────────────

    @Transactional
    public void requestPasswordReset(String email, UUID tenantId) {
        // tenantId may be null on a public localhost request (no subdomain, no JWT).
        // Set whatever we have so the email lookup can scope; if null, the Hibernate
        // filter is inactive and we resolve the tenant from the matched user row below.
        if (tenantId != null) {
            TenantContext.setTenantId(tenantId);
            com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        }

        // Always return success — never reveal which emails exist
        credRepo.findByEmailIgnoreCase(email).ifPresent(creds -> {
            // The token's tenant_id MUST come from the user's own row — using the
            // (possibly null) request tenantId violates the NOT NULL + RLS WITH CHECK.
            UUID resolvedTenant = creds.getTenantId();
            TenantContext.setTenantId(resolvedTenant);
            com.hrms.core.tenant.TenantContext.setTenantId(resolvedTenant);
            setDbTenantContext(resolvedTenant);

            tokenRepo.invalidatePreviousTokens(creds.getId(), "PASSWORD_RESET", OffsetDateTime.now());

            String rawToken  = randomToken();
            OffsetDateTime expiresAt = OffsetDateTime.now().plusHours(1);

            InvitationToken token = new InvitationToken();
            token.setTenantId(resolvedTenant);
            token.setUserId(creds.getId());
            token.setTokenHash(sha256Hex(rawToken));
            token.setPurpose("PASSWORD_RESET");
            token.setExpiresAt(expiresAt);
            tokenRepo.save(token);

            String tenantSlug = loadTenantSlug(resolvedTenant);
            String resetUrl   = buildUrl(tenantSlug, "/reset-password?token=" + rawToken);

            sendEmail(email, "Reset your UnifiedTree password", resetHtml(resetUrl));
            log.info("Password reset email sent to {}", email);
        });
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        ResolvedToken rt = resolveToken(sha256Hex(rawToken), "PASSWORD_RESET",
            "Reset link is invalid or has already been used.", "RESET_INVALID",
            "This reset link has expired. Request a new one.", "RESET_EXPIRED");

        validatePassword(newPassword);

        UUID tenantId = rt.tenantId();
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        setDbTenantContext(tenantId);

        UserCredentials creds = credRepo.findById(rt.userId())
            .orElseThrow(() -> new BusinessRuleException("User not found", "USER_NOT_FOUND"));

        creds.setPasswordHash(passwordService.hash(newPassword));
        credRepo.save(creds);

        markTokenUsed(rt.id());

        log.info("Password reset completed for user {}", creds.getEmail());
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    /** Minimal token routing fields resolved without tenant context (bypasses RLS). */
    private record ResolvedToken(UUID id, UUID tenantId, UUID userId, String purpose,
                                 OffsetDateTime expiresAt, OffsetDateTime usedAt) {}

    /**
     * Resolve a token by hash via the SECURITY DEFINER function, validating
     * not-found / used / expired / wrong-purpose. Runs BEFORE tenant context is
     * established, so it must not touch RLS-scoped repositories.
     */
    private ResolvedToken resolveToken(String hash, String expectedPurpose,
                                       String invalidMsg, String invalidCode,
                                       String expiredMsg, String expiredCode) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT * FROM auth.invitation_resolve(?)", hash);
        if (rows.isEmpty()) {
            throw new BusinessRuleException(invalidMsg, invalidCode);
        }
        Map<String, Object> r = rows.get(0);
        String purpose = (String) r.get("purpose");
        OffsetDateTime usedAt    = toOdt(r.get("used_at"));
        OffsetDateTime expiresAt = toOdt(r.get("expires_at"));

        if (usedAt != null || !expectedPurpose.equals(purpose)) {
            throw new BusinessRuleException(invalidMsg, invalidCode);
        }
        if (expiresAt != null && OffsetDateTime.now().isAfter(expiresAt)) {
            throw new BusinessRuleException(expiredMsg, expiredCode);
        }
        return new ResolvedToken(
            (UUID) r.get("id"), (UUID) r.get("tenant_id"), (UUID) r.get("user_id"),
            purpose, expiresAt, usedAt);
    }

    /** Mark a token used. Tenant context must already be set. */
    private void markTokenUsed(UUID tokenId) {
        jdbc.update("UPDATE auth.invitation_tokens SET used_at = now() WHERE id = ?", tokenId);
    }

    private static OffsetDateTime toOdt(Object o) {
        if (o == null) return null;
        if (o instanceof OffsetDateTime odt) return odt;
        if (o instanceof java.sql.Timestamp ts) return ts.toInstant().atOffset(java.time.ZoneOffset.UTC);
        if (o instanceof java.time.Instant i) return i.atOffset(java.time.ZoneOffset.UTC);
        return null;
    }

    private void validatePassword(String password) {
        if (password == null || password.length() < 8) {
            throw new BusinessRuleException("Password must be at least 8 characters.", "PASSWORD_TOO_SHORT");
        }
    }

    private void setDbTenantContext(UUID tenantId) {
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }

    private Map<String, Object> loadEmployee(UUID employeeId, UUID tenantId) {
        setDbTenantContext(tenantId);
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT email, first_name FROM hrms.employees WHERE id = ? AND tenant_id = ?",
            employeeId, tenantId);
        if (rows.isEmpty()) throw new BusinessRuleException("Employee not found", "EMPLOYEE_NOT_FOUND");
        return rows.get(0);
    }

    private String loadTenantName(UUID tenantId) {
        try {
            return jdbc.queryForObject(
                "SELECT display_name FROM platform.tenants WHERE id = ?", String.class, tenantId);
        } catch (Exception e) { return "UnifiedTree"; }
    }

    private String loadTenantSlug(UUID tenantId) {
        try {
            return jdbc.queryForObject(
                "SELECT subdomain FROM platform.tenants WHERE id = ?", String.class, tenantId);
        } catch (Exception e) { return "demo"; }
    }

    private List<String> loadActiveModules(UUID tenantId) {
        return jdbc.queryForList(
            "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE'",
            String.class, tenantId);
    }

    private String buildUrl(String tenantSlug, String path) {
        if (platformBaseUrl.contains("localhost")) {
            // dev: plain localhost with port, no subdomain (subdomain routing not available in dev)
            return platformBaseUrl + path;
        }
        return "https://" + tenantSlug + "." + platformBaseUrl.replaceFirst("https?://", "") + path;
    }

    private void sendEmail(String to, String subject, String bodyHtml) {
        mailService.send(EmailMessage.simple(to, subject, bodyHtml));
    }

    private static String randomToken() {
        byte[] buf = new byte[32];
        RNG.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

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

    // ──────────────────────────────────────────────────────────────────────────
    // Email templates (inline HTML — short, no external dependencies)
    // ──────────────────────────────────────────────────────────────────────────

    private static String inviteHtml(String firstName, String tenantName, String inviteUrl) {
        return """
            <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;color:#1e293b">
            <p style="font-size:24px;font-weight:700;color:#0f6e56">Welcome to %s</p>
            <p>Hi %s,</p>
            <p>You've been added to <strong>%s</strong> on UnifiedTree HRMS.
            Click the button below to set your password and log in.</p>
            <p style="margin:32px 0">
              <a href="%s" style="background:#0f6e56;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                Set up your account →
              </a>
            </p>
            <p style="color:#64748b;font-size:13px">This link expires in 72 hours.<br>
            If you weren't expecting this, you can safely ignore this email.</p>
            </body></html>
            """.formatted(tenantName, firstName, tenantName, inviteUrl);
    }

    private static String resetHtml(String resetUrl) {
        return """
            <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;color:#1e293b">
            <p style="font-size:22px;font-weight:700;color:#0f6e56">Reset your password</p>
            <p>Someone requested a password reset for your UnifiedTree account.
            Click the button below to set a new password.</p>
            <p style="margin:32px 0">
              <a href="%s" style="background:#0f6e56;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">
                Reset password →
              </a>
            </p>
            <p style="color:#64748b;font-size:13px">This link expires in 1 hour.<br>
            If you didn't request this, you can safely ignore this email.</p>
            </body></html>
            """.formatted(resetUrl);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // DTOs (inner records for this package)
    // ──────────────────────────────────────────────────────────────────────────

    public record InvitationResult(boolean sent, OffsetDateTime expiresAt) {}

    public record AcceptInviteResponse(
        String accessToken,
        String refreshToken,
        String expiresAt,
        UUID userId,
        UUID employeeId,
        UUID tenantId,
        String email,
        List<String> roles,
        List<String> permissions,
        String tenantSlug,
        String tenantName,
        List<String> activeModules
    ) {}
}
