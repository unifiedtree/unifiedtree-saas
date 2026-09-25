package com.hrms.api.settings.workspace;

import com.hrms.api.mail.EmailMessage;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.session.SessionService;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.Array;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Workspace-wide sign-in security (Settings -> Security, for people holding
 * {@code workspace.security.manage}):
 *
 * <pre>
 *   GET  /v1/workspace/security                         the rule + how many people have two-factor on
 *   PUT  /v1/workspace/security            {mfaPolicy}  OFF | ADMINS | EVERYONE
 *   GET  /v1/workspace/security/members                 everyone who can sign in, with their two-factor state
 *   POST /v1/workspace/security/members/{userId}/mfa/reset
 *        turn someone's two-factor off (lost phone and recovery codes); signs them out everywhere
 * </pre>
 */
@RestController
@RequestMapping("/v1/workspace/security")
@SecurityRequirement(name = "bearerAuth")
public class WorkspaceSecurityController {

    private final JdbcTemplate jdbc;
    private final MfaService mfa;
    private final SessionService sessions;
    private final AuditService audit;
    private final WorkspaceMailer mailer;

    public WorkspaceSecurityController(JdbcTemplate jdbc, MfaService mfa, SessionService sessions,
                                       AuditService audit, WorkspaceMailer mailer) {
        this.jdbc = jdbc;
        this.mfa = mfa;
        this.sessions = sessions;
        this.audit = audit;
        this.mailer = mailer;
    }

    public record PolicyRequest(String mfaPolicy) {}

    public record SecuritySummary(String mfaPolicy, int people, int withTwoFactor,
                                  int requiredByRule, int requiredButNotSetUp) {}

    public record Member(UUID userId, String email, String name, List<String> roles, boolean mfaEnabled,
                         OffsetDateTime mfaEnabledAt, boolean requiredByRule, OffsetDateTime lastSignInAt) {}

    @Operation(summary = "Workspace two-factor rule and how many people have it on")
    @GetMapping
    @PreAuthorize("hasAuthority('workspace.security.manage')")
    @Transactional(readOnly = true)
    public SecuritySummary summary() {
        return summarize(tenant());
    }

    @Operation(summary = "Change who must use two-factor sign-in")
    @PutMapping
    @PreAuthorize("hasAuthority('workspace.security.manage')")
    @Transactional
    public SecuritySummary update(@RequestBody PolicyRequest body) {
        UUID tenantId = tenant();
        String raw = body == null || body.mfaPolicy() == null ? "" : body.mfaPolicy().trim().toUpperCase();
        if (!List.of("OFF", "ADMINS", "EVERYONE").contains(raw)) {
            throw new BusinessRuleException("Choose Off, Admins and HR, or Everyone.", "MFA_POLICY_INVALID");
        }
        MfaService.Policy before = mfa.policy(tenantId);
        jdbc.update("UPDATE platform.tenants SET mfa_policy = ? WHERE id = ?", raw, tenantId);
        if (!before.name().equals(raw)) {
            audit.record("security", "MFA_POLICY_CHANGED", "workspace", tenantId,
                    "Two-factor rule changed from " + label(before.name()) + " to " + label(raw));
        }
        return summarize(tenantId);
    }

    @Operation(summary = "Everyone who can sign in, with their two-factor state")
    @GetMapping("/members")
    @PreAuthorize("hasAuthority('workspace.security.manage')")
    @Transactional(readOnly = true)
    public List<Member> members() {
        return loadMembers(mfa.policy(tenant()));
    }

    @Operation(summary = "Turn someone's two-factor off (lost phone); signs them out everywhere")
    @PostMapping("/members/{userId}/mfa/reset")
    @PreAuthorize("hasAuthority('workspace.security.manage')")
    @Transactional
    public Map<String, Object> reset(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID userId) {
        UUID tenantId = tenant();
        UUID actor = TenantContext.getUserId();
        if (userId.equals(actor)) {
            throw new HrmsException("Use Two-factor authentication above to turn your own off; it asks for a code.",
                    HttpStatus.CONFLICT, "MFA_RESET_SELF");
        }
        Member target = loadMembers(mfa.policy(tenantId)).stream().filter(m -> m.userId().equals(userId)).findFirst()
                .orElseThrow(() -> new HrmsException("That person can't be found in this workspace.", HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        boolean targetIsOwner = target.roles().contains("OWNER") || target.roles().contains("SUPER_ADMIN");
        List<String> callerRoles = jwt == null || jwt.getClaimAsStringList("roles") == null ? List.of() : jwt.getClaimAsStringList("roles");
        if (targetIsOwner && !callerRoles.contains("OWNER")) {
            throw new HrmsException("Only a workspace owner can turn off an owner's two-factor sign-in.",
                    HttpStatus.FORBIDDEN, "MFA_RESET_OWNER_ONLY");
        }
        if (!mfa.adminReset(userId)) {
            throw new HrmsException("Two-factor sign-in is already off for " + target.email() + ".", HttpStatus.CONFLICT, "MFA_NOT_ENABLED");
        }
        int signedOut = sessions.revokeAll(tenantId, userId);
        audit.record("security", "MFA_RESET_BY_ADMIN", "user", userId,
                "Turned off two-factor sign-in for " + target.email() + " and signed them out of " + signedOut + " session(s)");

        String ws = mailer.workspaceName(tenantId);
        mailer.sendAfterCommit(List.of(new EmailMessage(target.email(), target.name(),
                "Two-factor sign-in was turned off for your " + ws + " account",
                WorkspaceMailer.html(ws, "Two-factor sign-in was turned off",
                        List.of("An admin of " + WorkspaceMailer.esc(ws) + " turned off two-factor sign-in for your account ("
                                        + WorkspaceMailer.esc(target.email()) + ") and signed you out everywhere.",
                                "Sign in with your password, then set two-factor up again on your new phone from Settings, Security.",
                                "If you didn't ask for this, tell your admin straight away."),
                        "Sign in", mailer.link(tenantId, "/login")), null, List.of())));
        return Map.of("reset", true, "signedOut", signedOut);
    }

    // ---- helpers --------------------------------------------------------------

    private SecuritySummary summarize(UUID tenantId) {
        MfaService.Policy p = mfa.policy(tenantId);
        List<Member> ms = loadMembers(p);
        int on = (int) ms.stream().filter(Member::mfaEnabled).count();
        int required = (int) ms.stream().filter(Member::requiredByRule).count();
        int missing = (int) ms.stream().filter(m -> m.requiredByRule() && !m.mfaEnabled()).count();
        return new SecuritySummary(p.name(), ms.size(), on, required, missing);
    }

    private List<Member> loadMembers(MfaService.Policy policy) {
        return jdbc.query("""
                SELECT uc.id, uc.email, uc.display_name, uc.is_mfa_enabled, uc.mfa_enabled_at, uc.last_login_at,
                       e.first_name, e.last_name,
                       COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
                  FROM auth.user_credentials uc
                  LEFT JOIN hrms.employees e ON e.id = uc.employee_id
                  LEFT JOIN rbac.user_roles ur ON ur.user_id = uc.id
                  LEFT JOIN rbac.roles r ON r.id = ur.role_id
                 WHERE uc.tenant_id = ? AND uc.is_active
                 GROUP BY uc.id, uc.email, uc.display_name, uc.is_mfa_enabled, uc.mfa_enabled_at, uc.last_login_at,
                          e.first_name, e.last_name
                 ORDER BY uc.is_mfa_enabled DESC, lower(uc.email)
                """, (rs, n) -> {
                    List<String> roles = toList(rs.getArray("roles"));
                    String display = rs.getString("display_name");
                    String first = rs.getString("first_name");
                    String last = rs.getString("last_name");
                    String name = display != null && !display.isBlank() ? display.trim()
                            : first != null ? (first + (last == null || last.isBlank() ? "" : " " + last)).trim()
                            : rs.getString("email");
                    var enabledAt = rs.getTimestamp("mfa_enabled_at");
                    var lastLogin = rs.getTimestamp("last_login_at");
                    return new Member(rs.getObject("id", UUID.class), rs.getString("email"), name, roles,
                            rs.getBoolean("is_mfa_enabled"),
                            enabledAt == null ? null : enabledAt.toInstant().atOffset(ZoneOffset.UTC),
                            MfaService.policyCovers(policy, roles),
                            lastLogin == null ? null : lastLogin.toInstant().atOffset(ZoneOffset.UTC));
                }, tenant());
    }

    private static List<String> toList(Array a) throws SQLException {
        if (a == null) return List.of();
        Object arr = a.getArray();
        if (arr instanceof Object[] objs) {
            List<String> out = new ArrayList<>();
            for (Object o : objs) if (o != null) out.add(o.toString());
            return out;
        }
        return Arrays.asList();
    }

    private static String label(String policy) {
        return switch (policy) {
            case "ADMINS" -> "admins and HR";
            case "EVERYONE" -> "everyone";
            default -> "off";
        };
    }

    private static UUID tenant() {
        UUID t = TenantContext.getTenantId();
        if (t == null) throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        return t;
    }
}
