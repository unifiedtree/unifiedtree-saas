package com.unifiedtree.auth.firebase;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.auth.dto.AuthDtos.LoginResponse;
import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.phone.PhoneLookupService;
import com.unifiedtree.auth.phone.PhoneSignInRule;
import com.unifiedtree.auth.ratelimit.ClientIp;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Public endpoint that turns a Firebase phone-auth ID token into a normal
 * UnifiedTree access + refresh token pair.
 *
 * <p>Flow:
 * <ol>
 *   <li>Client (Android) runs Firebase phone-number sign-in → gets an
 *       ID token.</li>
 *   <li>Client POSTs {@code {"idToken":"..."}} here.</li>
 *   <li>We verify the token against the project (audience check + signature
 *       check via the Firebase Admin SDK), pull the {@code phone_number}
 *       claim, and look up the matching employee by phone.</li>
 *   <li>Reuse {@link AuthService#issueWorkspaceSession(UUID, UUID)} to mint
 *       the same JWT + refresh pair {@code /v1/canonical-auth/login} does.
 *       Sets the same per-tenant refresh cookie so a browser reload can
 *       restore the session — parity with the password path.</li>
 * </ol>
 *
 * <p>Deliberately does NOT touch {@link AuthService} internals — the whole
 * password path (rate-limit, tenant scan, credential lookup, refresh cookie)
 * is unchanged. This controller only calls the same public
 * {@code issueWorkspaceSession} entry point invited-user activation and
 * cross-workspace switching already use.
 */
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "unifiedtree.firebase.enabled", havingValue = "true", matchIfMissing = true)
@RequestMapping("/v1/auth")
public class FirebaseAuthController {

    private static final Logger log = LoggerFactory.getLogger(FirebaseAuthController.class);

    /** Rate-limit key label — kept independent of the password endpoint. */
    private static final String ENDPOINT = "firebase-verify";
    private static final String ENDPOINT_CHECK = "firebase-phone-check";

    /** Same prefix / TTL / attributes as CanonicalAuthController.RT_COOKIE_*. */
    private static final String RT_COOKIE_PREFIX = "ut_rt_";
    private static final int RT_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

    private final AuthService auth;
    private final PhoneLookupService phoneLookup;
    private final PublicEndpointRateLimiter rateLimiter;
    /** Who an SMS code may sign in, on the web and in the app (shared with the MSG91 OtpController). */
    private final PhoneSignInRule rule;

    public FirebaseAuthController(AuthService auth,
                                  PhoneLookupService phoneLookup,
                                  PublicEndpointRateLimiter rateLimiter,
                                  MfaService mfa,
                                  JdbcTemplate jdbc) {
        this.auth = auth;
        this.phoneLookup = phoneLookup;
        this.rateLimiter = rateLimiter;
        this.rule = new PhoneSignInRule(phoneLookup, mfa, jdbc);
    }

    /**
     * Pre-flight registration check. Called by the mobile app BEFORE
     * asking Firebase to send an SMS OTP — if the number isn't on file
     * we skip Firebase entirely, saving a paid SMS send and avoiding
     * a Firebase rate-limit hit on the caller's device. Also gives the
     * mobile UI a chance to render the "Not registered" panel with
     * email-login / create-workspace CTAs before any SMS goes out.
     *
     * <p>Trade-off: this IS a mild enumeration oracle — an attacker who
     * hits the endpoint with a phone number gets back a definitive
     * {@code registered: true/false}. Mitigations:
     * <ul>
     *   <li>Rate-limited on both IP and phone via
     *       {@link PublicEndpointRateLimiter} (5/15m per phone, 20/15m per IP)</li>
     *   <li>Employee phones aren't publicly-known lists in a B2B HRMS
     *       (unlike consumer platforms where phone-number = user id)</li>
     *   <li>The endpoint is small and returns only a boolean — no name,
     *       tenant, employee code, or any identifiable data leaks</li>
     * </ul>
     * If the trade-off ever becomes uncomfortable, swap the response
     * shape to always-true + let the OTP path 404 as before.
     */
    @PostMapping("/phone/check")
    public ResponseEntity<?> phoneCheck(@Valid @RequestBody PhoneCheckRequest req,
                                        HttpServletRequest http) {
        String phone = req.mobile() == null ? null : req.mobile().trim();
        if (phone == null || phone.isBlank()) {
            throw new HrmsException("Mobile number is required", HttpStatus.BAD_REQUEST,
                    "MOBILE_REQUIRED");
        }
        // Two rate-limit passes (same pattern as /firebase-verify) so a
        // burst against one number OR one source IP both trip.
        rateLimiter.check(ENDPOINT_CHECK, ClientIp.of(http), null);
        rateLimiter.check(ENDPOINT_CHECK, null, ClientIp.phoneKey(phone));

        // findByPhone normalises to last-10-digit lookup across all
        // tenants — same match logic the /firebase-verify path uses on
        // the phone_number claim, so a hit here guarantees a hit there.
        UUID business = businessFrom(http);
        boolean registered;
        try {
            // The app (no business named): a number on several logins, or a two-factor login, is refused
            // here, before the app asks Firebase for an SMS (owner's decision Q-21, 9 Oct).
            registered = business == null
                    ? rule.forTheApp(phone).isPresent()
                    : phoneLookup.findByPhone(phone, business).isPresent();
        } catch (PhoneLookupService.SeveralLogins e) {
            // Several logins here carry this number: no SMS (it couldn't sign anyone in).
            return ResponseEntity.ok(Map.of("registered", false, "reason", "PHONE_ON_SEVERAL_LOGINS"));
        }
        log.info("phone/check: phone(last-10)={} registered={}",
                phone.length() > 10 ? phone.substring(phone.length() - 10) : phone,
                registered);
        return ResponseEntity.ok(Map.of("registered", registered));
    }

    @PostMapping("/firebase-verify")
    public ResponseEntity<?> verify(@Valid @RequestBody FirebaseVerifyRequest req,
                                    HttpServletRequest http,
                                    HttpServletResponse res) {

        // ── Rate-limit before we spend a network round-trip on token verify.
        // Keyed on IP only up front — we don't know the phone number yet, so
        // this stops a single source from hammering the endpoint with random
        // tokens. Once we know the phone, we rate-limit on that too (below)
        // so a distributed flood targeting one victim's phone still trips.
        rateLimiter.check(ENDPOINT, ClientIp.of(http), null);

        // ── Verify the ID token. FirebaseAuth throws:
        //   - FirebaseAuthException      → tampered / expired / wrong project
        //   - IllegalArgumentException   → structurally malformed
        // Both surface as 401 UNAUTHORIZED. The upstream code (Bearer resource
        // server) uses the same status for a bad JWT, so this stays consistent.
        FirebaseToken decoded;
        try {
            // checkRevoked: a token Firebase has revoked (signed out everywhere, disabled) is refused.
            decoded = FirebaseAuth.getInstance().verifyIdToken(req.idToken(), true);
        } catch (FirebaseAuthException e) {
            log.warn("firebase-verify: token verification failed: {}", e.getMessage());
            throw new HrmsException("Invalid or expired sign-in token", HttpStatus.UNAUTHORIZED,
                    "FIREBASE_TOKEN_INVALID");
        } catch (IllegalArgumentException e) {
            log.warn("firebase-verify: malformed token: {}", e.getMessage());
            throw new HrmsException("Invalid sign-in token", HttpStatus.UNAUTHORIZED,
                    "FIREBASE_TOKEN_MALFORMED");
        }

        // Only a phone sign-in proves the number (a token from another Firebase sign-in method doesn't).
        Object firebaseClaim = decoded.getClaims() == null ? null : decoded.getClaims().get("firebase");
        Object provider = firebaseClaim instanceof Map<?, ?> f ? f.get("sign_in_provider") : null;
        if (!"phone".equals(provider)) {
            log.warn("firebase-verify: token is not a phone sign-in (provider={}), uid={}", provider, decoded.getUid());
            throw new HrmsException("Invalid sign-in token", HttpStatus.UNAUTHORIZED, "FIREBASE_NOT_PHONE");
        }

        String phone = extractPhone(decoded);
        if (phone == null || phone.isBlank()) {
            // ID token was valid but issued for an account that has no phone
            // number attached (Firebase can issue tokens for email/anon sign-in
            // too). We can't map that to an employee.
            log.warn("firebase-verify: token has no phone_number claim, uid={}",
                    decoded.getUid());
            throw new HrmsException("Sign-in token does not carry a phone number",
                    HttpStatus.UNPROCESSABLE_ENTITY, "PHONE_MISSING_IN_TOKEN");
        }

        // Second rate-limit pass — now that we have a stable per-user key,
        // this defends against distributed floods targeting one number.
        rateLimiter.check(ENDPOINT, null, ClientIp.phoneKey(phone));

        // ── Look up the employee across tenants (RLS-safe scan, see
        // FirebasePhoneLookupService).
        // On a business's own login page the web says which business (X-Tenant-Subdomain):
        // the match stays inside it. The mobile app sends none: matched across businesses, as before.
        UUID business = businessFrom(http);
        Optional<PhoneLookupService.Match> maybe;
        try {
            // The app: only the one active login with this number; several, or a two-factor login, are refused.
            maybe = business == null ? rule.forTheApp(phone) : phoneLookup.findByPhone(phone, business);
        } catch (PhoneLookupService.SeveralLogins e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "error", "PHONE_ON_SEVERAL_LOGINS",
                    "message", "This mobile number is on more than one login here. Sign in with your email."));
        }
        if (maybe.isEmpty()) {
            log.info("firebase-verify: no employee found for phone (last 10 digits) — uid={}",
                    decoded.getUid());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "error", "PHONE_NOT_REGISTERED",
                    "message", "This phone number is not registered. Contact your HR administrator."));
        }
        PhoneLookupService.Match match = maybe.get();

        // ── Bind the tenant BEFORE calling AuthService — issueWorkspaceSession
        // is @Transactional, and TenantAwareDataSource reads TenantContext at
        // connection-lease time to issue SET LOCAL app.tenant_id. Missing this
        // step means RLS hides the credential row and issueWorkspaceSession
        // throws WORKSPACE_USER_NOT_FOUND. Same setup CanonicalAuthController
        // does before calling auth.login().
        TenantContext.setTenantId(match.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(match.tenantId());

        if (business != null) refuseOnTheWeb(match);

        LoginResponse out = auth.issueWorkspaceSession(match.tenantId(), match.authUserId());

        // Web clients rely on the httpOnly refresh cookie to survive reloads;
        // mobile ignores it (no cookie jar) and keeps using the body copy.
        writeRefreshCookie(res, match.tenantId(), out.refreshToken());
        return ResponseEntity.ok(out);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /**
     * On a business's web sign-in (a business named), an SMS code alone never signs in (review 7 Oct):
     * <ul>
     *   <li>the owner, super admins and admins — anyone who can edit employees could otherwise put
     *       their own number on an admin's record and sign in as them: USE_EMAIL_FOR_ADMIN;</li>
     *   <li>anyone whose login needs a two-factor code: USE_PASSWORD_FOR_TWO_FACTOR, as Google sign-in.</li>
     * </ul>
     * The mobile app (no business named) refuses the two-factor login too, but not the owner and admins
     * ({@link PhoneSignInRule#forTheApp}, owner's decision Q-21).
     */
    void refuseOnTheWeb(PhoneLookupService.Match match) {
        PhoneSignInRule.Refusal refusal = rule.refusal(match, true).orElse(null);
        if (refusal == PhoneSignInRule.Refusal.ADMIN) {
            throw new HrmsException("Admins sign in with their email and password.", HttpStatus.FORBIDDEN, "USE_EMAIL_FOR_ADMIN");
        }
        if (refusal == PhoneSignInRule.Refusal.TWO_FACTOR) {
            throw new HrmsException("Your login uses two-factor sign-in. Sign in with your email and password.",
                    HttpStatus.FORBIDDEN, "USE_PASSWORD_FOR_TWO_FACTOR");
        }
    }

    /** The business named by X-Tenant-Subdomain; null when the header is absent (the mobile app). */
    private UUID businessFrom(HttpServletRequest http) {
        String sub = http == null ? null : http.getHeader("X-Tenant-Subdomain");
        return sub == null || sub.isBlank() ? null : phoneLookup.businessBySubdomain(sub.trim());
    }

    /**
     * Firebase surfaces the phone number as a top-level claim on the decoded
     * token (auth-time proof of ownership). Fall back to the raw claims map
     * for defensive parsing in case the SDK ever renames the accessor.
     */
    private static String extractPhone(FirebaseToken token) {
        // The convenience accessor doesn't exist on FirebaseToken in every
        // SDK version — read the claim map, same key Firebase always uses.
        Object v = token.getClaims() == null ? null : token.getClaims().get("phone_number");
        return v == null ? null : v.toString();
    }

    private static String cookieName(UUID tenantId) {
        // Cookie names may not contain '-'; UUIDs do. Same shape
        // CanonicalAuthController writes so both endpoints target the same
        // per-workspace slot.
        return RT_COOKIE_PREFIX + tenantId.toString().replace("-", "");
    }

    private static void writeRefreshCookie(HttpServletResponse res, UUID tenantId, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank() || tenantId == null) return;
        res.addHeader("Set-Cookie", String.join("; ",
                cookieName(tenantId) + "=" + refreshToken,
                "Max-Age=" + RT_COOKIE_MAX_AGE_SECONDS,
                "Path=/",
                "Domain=.unifiedtree.com",
                "HttpOnly", "Secure", "SameSite=Lax"));
    }

    // ── DTO ─────────────────────────────────────────────────────────────────

    public record FirebaseVerifyRequest(@NotBlank String idToken) { }

    /** Body of {@link #phoneCheck}. Accepts a plain 10-digit mobile string,
     *  or a longer variant (E.164 with country code) — the phone lookup
     *  matches on the last 10 digits either way. */
    public record PhoneCheckRequest(@NotBlank String mobile) { }
}
