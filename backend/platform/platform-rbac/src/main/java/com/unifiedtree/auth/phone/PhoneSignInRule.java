package com.unifiedtree.auth.phone;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Who an SMS code may sign in: one rule for a business's web sign-in and the mobile app.
 * <ul>
 *   <li>only an active login counts, and a number on more than one signs nobody in
 *       ({@link PhoneLookupService.SeveralLogins}): the code can't say which login it is for;</li>
 *   <li>a login that needs a two-factor code never signs in with an SMS code alone: {@link Refusal#TWO_FACTOR},
 *       as Google sign-in;</li>
 *   <li>on the web only, the owner, super admins and admins neither: {@link Refusal#ADMIN} (review 7 Oct).
 *       The app keeps SMS for them for now, phone being its main sign-in (owner's decision Q-21, 9 Oct).</li>
 * </ul>
 */
@Component
public class PhoneSignInRule {

    public enum Refusal { ADMIN, TWO_FACTOR }

    /** Roles that never sign in with an SMS code on the web. */
    static final List<String> PRIVILEGED = List.of("OWNER", "SUPER_ADMIN", "ADMIN");

    static final String SEVERAL_LOGINS = "PHONE_ON_SEVERAL_LOGINS";
    static final String TWO_FACTOR = "USE_PASSWORD_FOR_TWO_FACTOR";

    private final PhoneLookupService lookup;
    private final MfaService mfa;
    private final JdbcTemplate jdbc;

    public PhoneSignInRule(PhoneLookupService lookup, MfaService mfa, JdbcTemplate jdbc) {
        this.lookup = lookup;
        this.mfa = mfa;
        this.jdbc = jdbc;
    }

    /** Why this login can't sign in with an SMS code; empty: it can. {@code web}: a business's web sign-in. */
    public Optional<Refusal> refusal(PhoneLookupService.Match match, boolean web) {
        // Roles and two-factor are read in the login's business (RLS); the caller's binding is put back after.
        UUID was = TenantContext.getTenantId();
        UUID wasCore = com.hrms.core.tenant.TenantContext.getTenantId();
        TenantContext.setTenantId(match.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(match.tenantId());
        try {
            List<String> roles = jdbc.queryForList("""
                    SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id
                     WHERE ur.tenant_id = ? AND ur.user_id = ?
                    """, String.class, match.tenantId(), match.authUserId());
            if (web && roles.stream().anyMatch(PRIVILEGED::contains)) return Optional.of(Refusal.ADMIN);
            if (mfa.requirementFor(match.tenantId(), match.authUserId(), roles) != MfaService.Requirement.NONE) {
                return Optional.of(Refusal.TWO_FACTOR);
            }
            return Optional.empty();
        } finally {
            TenantContext.setTenantId(was);
            com.hrms.core.tenant.TenantContext.setTenantId(wasCore);
        }
    }

    /**
     * The mobile app's phone sign-in (no business named), checked before any SMS is sent and again before a
     * session is issued: the one active login with this number, empty when there is none (unknown or inactive:
     * as before). A number on several active logins (PHONE_ON_SEVERAL_LOGINS, 409) and a two-factor login
     * (USE_PASSWORD_FOR_TWO_FACTOR, 403) are refused. The owner and admins are not: the app keeps SMS for them.
     */
    public Optional<PhoneLookupService.Match> forTheApp(String phone) {
        Optional<PhoneLookupService.Match> match;
        try {
            match = lookup.findTheOnlyLogin(phone);
        } catch (PhoneLookupService.SeveralLogins e) {
            throw new HrmsException("This number is on more than one login. Sign in with your email.",
                    HttpStatus.CONFLICT, SEVERAL_LOGINS);
        }
        if (match.isPresent() && refusal(match.get(), false).isPresent()) {
            throw new HrmsException("Your login uses two-factor sign-in. Use your password.",
                    HttpStatus.FORBIDDEN, TWO_FACTOR);
        }
        return match;
    }
}
