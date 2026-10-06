package com.unifiedtree.saas.oauth;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * "Continue with Google" on a business's own login page (contract §5a with the HRMS lane, 6 Oct 2026).
 *
 * <p>Rides on the existing Google flow (same registered callback): the start marks the state row's
 * return path as {@code /__business/<subdomain>}; after Google has verified the email, the callback
 * hands it here instead of signing in a website account. Here: the ACTIVE login with that email in
 * THAT business (emails are unique per business since V143_91) gets a business session — through
 * {@link AuthService#issueWorkspaceSession}, so inactive and locked logins are refused exactly like
 * password sign-in. A login that needs a two-factor code is sent to the password page instead:
 * Google sign-in never skips the code.
 */
@Component
public class BusinessGoogleSignIn {

    /** The state row's return path for a business sign-in. Passes GoogleOauthService.sanitizeReturnTo. */
    public static final String PREFIX = "/__business/";
    private static final Pattern SUBDOMAIN = Pattern.compile("^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$");

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final MfaService mfa;
    /** Where a business lives; {sub} is replaced. Local: http://{sub}.localhost:3002 */
    private final String businessUrl;

    public BusinessGoogleSignIn(JdbcTemplate jdbc, AuthService auth, MfaService mfa,
                                @Value("${unifiedtree.oauth.google.business-url:https://{sub}.unifiedtree.com}") String businessUrl) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.mfa = mfa;
        this.businessUrl = businessUrl;
    }

    /** The return path that marks a business sign-in, or null for a malformed subdomain. */
    public static String returnToFor(String subdomain) {
        String s = subdomain == null ? "" : subdomain.trim().toLowerCase(Locale.ROOT);
        return SUBDOMAIN.matcher(s).matches() ? PREFIX + s : null;
    }

    /** The business a return path names, or null when it isn't a business sign-in. */
    public static String businessOf(String returnTo) {
        if (returnTo == null || !returnTo.startsWith(PREFIX)) return null;
        String s = returnTo.substring(PREFIX.length());
        return SUBDOMAIN.matcher(s).matches() ? s : null;
    }

    public String businessUrl(String subdomain) {
        return businessUrl.replace("{sub}", subdomain).replaceAll("/+$", "");
    }

    /**
     * Signs the Google-verified email into the business, or throws {@link Refused} with a code for
     * the business's /login?error=… (GOOGLE_NOT_REGISTERED, ACCOUNT_INACTIVE, ACCOUNT_LOCKED,
     * USE_PASSWORD_FOR_TWO_FACTOR, BUSINESS_NOT_FOUND).
     */
    public Result signIn(String subdomain, String verifiedEmail) {
        List<UUID> tenants = jdbc.queryForList(
                "SELECT id FROM platform.tenants WHERE lower(subdomain) = lower(?) AND status = 'ACTIVE'",
                UUID.class, subdomain);
        if (tenants.isEmpty()) throw new Refused("BUSINESS_NOT_FOUND");
        UUID tenantId = tenants.get(0);
        if (verifiedEmail == null || verifiedEmail.isBlank()) throw new Refused("GOOGLE_NOT_REGISTERED");

        // auth.user_credentials and rbac are row-level secured per business: bind it first.
        TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            List<UUID> users = jdbc.queryForList("""
                    SELECT id FROM auth.user_credentials
                     WHERE tenant_id = ? AND lower(email) = lower(?)
                     ORDER BY is_active DESC
                     LIMIT 1
                    """, UUID.class, tenantId, verifiedEmail.trim().toLowerCase(Locale.ROOT));
            if (users.isEmpty()) throw new Refused("GOOGLE_NOT_REGISTERED");
            UUID userId = users.get(0);

            List<String> roles = jdbc.queryForList("""
                    SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id
                     WHERE ur.tenant_id = ? AND ur.user_id = ?
                    """, String.class, tenantId, userId);
            if (mfa.requirementFor(tenantId, userId, roles) != MfaService.Requirement.NONE) {
                throw new Refused("USE_PASSWORD_FOR_TWO_FACTOR");
            }

            try {
                LoginResponse session = auth.issueWorkspaceSession(tenantId, userId);
                return new Result(tenantId, session);
            } catch (HrmsException e) {
                String code = e.getErrorCode();
                throw new Refused("ACCOUNT_LOCKED".equals(code) || "ACCOUNT_INACTIVE".equals(code) ? code : "GOOGLE_NOT_REGISTERED");
            }
        } finally {
            TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    public record Result(UUID tenantId, LoginResponse session) {}

    /** A business sign-in that can't go ahead; {@link #code} goes on the business's /login?error=. */
    public static class Refused extends RuntimeException {
        private final String code;
        public Refused(String code) { super(code); this.code = code; }
        public String code() { return code; }
    }
}
