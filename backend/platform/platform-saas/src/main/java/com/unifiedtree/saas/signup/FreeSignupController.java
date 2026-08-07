package com.unifiedtree.saas.signup;

import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.service.SaasService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;
import java.util.UUID;

/**
 * Public "Create Free Workspace" endpoint.
 *
 * <p>Contrast with {@link SubscriptionSignupController} which does the paid /
 * autopay signup and requires a Razorpay mandate before it will provision
 * anything. This endpoint is synchronous and free:
 *
 * <ol>
 *   <li>Validate the payload.</li>
 *   <li>Resolve the account — signed-in caller uses their JWT account_id,
 *       anon caller uses email+password (existing account with matching
 *       password → reuse; new email → mint a new account).</li>
 *   <li>Create the workspace via {@link SaasService#createFreeWorkspace}
 *       with ZERO active modules — every module renders as locked in the
 *       workspace until the admin opens {@code /plan} and sets up autopay.</li>
 *   <li>Return {@code tenantId + subdomain + workspaceUrl + email} so the
 *       browser can auto-login and redirect the user straight into their
 *       new workspace.</li>
 * </ol>
 *
 * <p>Multiple free workspaces per account are supported. There is NO
 * "one free per email" cap — the client explicitly wants users to be able
 * to create as many free workspaces as they need. The 7-day trial is
 * per-workspace, not per-email, and it starts LATER (when autopay is set
 * up inside the workspace), not at creation time.
 */
@RestController
@RequestMapping("/v1/public/free-signup")
public class FreeSignupController {

    private static final Logger log = LoggerFactory.getLogger(FreeSignupController.class);

    private final SaasService saas;
    private final PasswordService passwords;

    public FreeSignupController(SaasService saas, PasswordService passwords) {
        this.saas = saas;
        this.passwords = passwords;
    }

    @PostMapping
    public ResponseEntity<FreeSignupResponse> signup(
            @Valid @RequestBody FreeSignupRequest req,
            @AuthenticationPrincipal Jwt jwt) {

        String email = norm(req.adminEmail());
        UUID signedInAccountId = jwt == null ? null : accountIdFromJwt(jwt);

        // Resolve account:
        //   - signed-in caller → use the JWT account, no password needed
        //   - anon caller     → email+password path in SaasService (existing
        //                       account with matching password → reuse;
        //                       else mint a new UUID for SaasWriter to insert)
        UUID accountId;
        String passwordHash;
        if (signedInAccountId != null) {
            accountId    = signedInAccountId;
            passwordHash = null;
        } else {
            String plaintext = req.password();
            if (plaintext == null || plaintext.length() < 8) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Password is required (min 8 characters)");
            }
            accountId    = saas.resolveOrCreateAccountId(email, plaintext);
            passwordHash = passwords.hash(plaintext);
        }

        SignupResponse resp = saas.createFreeWorkspace(
                accountId,
                passwordHash,
                req.companyName(),
                req.subdomain(),
                req.adminName(),
                email,
                norm(req.adminMobile()),
                req.country(),
                req.timezone(),
                req.currency() == null ? "INR" : req.currency());

        log.info("free-signup {} → tenant={} subdomain={} signedIn={}",
                email, resp.tenantId(), resp.subdomain(), signedInAccountId != null);

        return ResponseEntity.ok(new FreeSignupResponse(
                resp.tenantId(),
                resp.subdomain(),
                resp.workspaceUrl(),
                email));
    }

    // -- helpers --------------------------------------------------------------

    private static String norm(String s) {
        return s == null ? null : s.trim();
    }

    private static UUID accountIdFromJwt(Jwt jwt) {
        // Same claim name our other endpoints (e.g. AccountService) read.
        Object v = jwt.getClaim("account_id");
        if (v == null) v = jwt.getClaim("accountId");
        if (v == null) return null;
        try { return UUID.fromString(v.toString()); } catch (Exception e) { return null; }
    }

    // -- DTOs -----------------------------------------------------------------

    /**
     * Minimal free-signup payload. NO planKeys, NO seats, NO billingCycle —
     * those are picked inside the workspace when the admin sets up autopay.
     */
    public record FreeSignupRequest(
            @NotBlank @Size(max = 150) String companyName,
            @NotBlank @Size(min = 3, max = 63) String subdomain,
            @NotBlank @Size(max = 150) String adminName,
            @NotBlank @Email @Size(max = 255) String adminEmail,
            @Size(max = 20)  String adminMobile,

            // Optional (nullable) when the caller is signed in (JWT present)
            // — enforced at request time.
            @Size(min = 8, max = 128) String password,

            @Size(max = 50)  String country,
            @Size(max = 50)  String timezone,
            @Size(max = 10)  String currency
    ) {
        public FreeSignupRequest {
            // Normalise subdomain to lower-case so downstream uniqueness
            // checks + tenant_domains row are consistent.
            if (subdomain != null) subdomain = subdomain.trim().toLowerCase(Locale.ROOT);
        }
    }

    public record FreeSignupResponse(
            UUID tenantId,
            String subdomain,
            String workspaceUrl,
            String email
    ) {}
}
