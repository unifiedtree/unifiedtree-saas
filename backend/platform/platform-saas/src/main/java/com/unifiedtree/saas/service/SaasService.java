package com.unifiedtree.saas.service;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.dto.AccountDtos.CreateWorkspaceRequest;
import com.unifiedtree.saas.dto.SaasDtos.ApprovalRequest;
import com.unifiedtree.saas.dto.SaasDtos.PlatformLoginResponse;
import com.unifiedtree.saas.dto.SaasDtos.RejectionRequest;
import com.unifiedtree.saas.dto.SaasDtos.SignupRequest;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.dto.SaasDtos.SubdomainCheckResponse;
import com.unifiedtree.saas.dto.SaasDtos.TenantRequestSummary;
import com.unifiedtree.saas.dto.SaasDtos.WorkspaceStatusResponse;
import com.unifiedtree.saas.event.WorkspaceCreatedEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Customer-facing SaaS portal orchestration. Talks only to canonical
 * schemas (platform.*, auth.*, rbac.*).
 *
 * <p>Write paths that touch RLS-protected tables (auth.user_credentials,
 * rbac.user_roles) set TenantContext before delegating to {@link SaasWriter},
 * whose @Transactional methods cause {@code TenantAwareDataSource} to issue
 * {@code SET LOCAL app.tenant_id} on connection lease.
 */
@Service
public class SaasService {

    /** Special tenant id used to host UnifiedTree platform admins. */
    public static final UUID PLATFORM_TENANT_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000000");

    private static final UUID SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID PLATFORM_SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000006");

    /**
     * Subdomains a tenant may NOT register, because they collide with
     * platform infrastructure or routing. The wildcard *.unifiedtree.com
     * serves the tenant workspace app, but these names are claimed by
     * other hosts (the marketing site, the admin console, the API, mail,
     * static assets, etc.). Allowing a tenant to take one would hijack
     * real traffic. Kept lowercase; matching is exact after normalization.
     */
    private static final java.util.Set<String> RESERVED_SUBDOMAINS = java.util.Set.of(
            "www", "api", "admin", "app", "apps", "platform", "dashboard",
            "mail", "email", "smtp", "imap", "ftp", "ns", "ns1", "ns2", "dns",
            "static", "assets", "cdn", "img", "images", "media", "files",
            "status", "health", "metrics", "monitor", "grafana", "prometheus",
            "blog", "docs", "help", "support", "billing", "pay", "payment",
            "payments", "checkout", "auth", "login", "signup", "register",
            "account", "accounts", "console", "control", "internal", "test",
            "staging", "stage", "dev", "demo", "sandbox", "preview", "vercel",
            "railway", "root", "unifiedtree", "webhook", "webhooks",
            "ws", "socket", "vpn", "git", "ci", "cd", "ops", "noc", "sec");

    private final JdbcTemplate jdbc;
    private final SaasWriter writer;
    private final JwtService jwt;
    private final PasswordService passwords;
    private final String baseDomain;
    private final ApplicationEventPublisher events;
    private final com.unifiedtree.saas.payment.PaymentService payments;
    private final com.unifiedtree.saas.plans.ModulePlanService planService;
    private final com.unifiedtree.saas.trial.BillingSettingsService billingSettings;
    private final com.unifiedtree.saas.trial.TrialSubscriptionService trials;

    public SaasService(JdbcTemplate jdbc,
                       SaasWriter writer,
                       JwtService jwt,
                       PasswordService passwords,
                       @Value("${unifiedtree.base-domain:unifiedtree.com}") String baseDomain,
                       ApplicationEventPublisher events,
                       com.unifiedtree.saas.payment.PaymentService payments,
                       com.unifiedtree.saas.plans.ModulePlanService planService,
                       com.unifiedtree.saas.trial.BillingSettingsService billingSettings,
                       com.unifiedtree.saas.trial.TrialSubscriptionService trials) {
        this.jdbc = jdbc;
        this.writer = writer;
        this.jwt = jwt;
        this.passwords = passwords;
        this.baseDomain = baseDomain;
        this.events = events;
        this.payments = payments;
        this.planService = planService;
        this.billingSettings = billingSettings;
        this.trials = trials;
    }

    // -- Public: subdomain availability -----------------------------------------------------------

    public SubdomainCheckResponse checkSubdomain(String requested) {
        String subdomain = normalizeSubdomain(requested);
        if (subdomain.length() < 3) {
            return new SubdomainCheckResponse(subdomain, false,
                    "Workspace address must be at least 3 characters.");
        }
        // Reject infrastructure-reserved names BEFORE the DB check so the
        // guard holds even on a fresh database. Covers both the live
        // availability probe and createWorkspace (which calls this method).
        if (RESERVED_SUBDOMAINS.contains(subdomain)) {
            return new SubdomainCheckResponse(subdomain, false,
                    "This workspace address is reserved. Please choose another.");
        }
        // A subdomain is unavailable if it's either
        //   (a) already provisioned into platform.tenants, OR
        //   (b) currently being claimed by a pending_signups row that hasn't
        //       finished the Razorpay mandate yet (24h reservation window).
        // The stash-time index on pending_signups is what actually enforces
        // uniqueness, but the availability probe MUST see both so the form
        // doesn't say "Available" and then 409 on submit.
        boolean exists = Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM platform.tenants        WHERE lower(subdomain) = ?
                    UNION ALL
                    SELECT 1 FROM platform.pending_signups
                     WHERE lower(subdomain) = ? AND status = 'AWAITING_MANDATE'
                )
                """, Boolean.class, subdomain, subdomain));
        return new SubdomainCheckResponse(subdomain, !exists,
                exists ? "This workspace address is already reserved." : "Available");
    }

    // -- Public: signup ---------------------------------------------------------------------------

    public SignupResponse createSignupRequest(SignupRequest req) {
        // ----------------------------------------------------------------------
        // Paywall. When Razorpay is configured (production) a verified paid order
        // is MANDATORY to create a workspace, and the PAID plans dictate which
        // modules get activated — the client's requestedModules cannot self-grant
        // anything it did not pay for. When the gateway is not configured (local
        // dev) we keep the original free path so nothing local breaks.
        //
        // Note: this gate is ONLY on NEW workspace creation. Existing workspaces,
        // their logins, the platform-admin login and the Google-reviewer/test
        // logins are entirely untouched.
        // ----------------------------------------------------------------------
        com.unifiedtree.saas.payment.PaymentService.PaidOrder paid = null;
        boolean isTrial = "TRIAL".equalsIgnoreCase(req.mode());
        List<String> modulesToActivate = normalizeModules(req.requestedModules());
        List<String> trialPlanKeys = List.of();

        if (isTrial) {
            // TRIAL path: free workspace, no payment. The trial covers whatever
            // AVAILABLE plans the visitor picked (client-supplied plan keys);
            // launching-soon plans are rejected by requireAvailable. Duration
            // comes from platform.billing_settings (DB-driven, default 7 days).
            if (!billingSettings.current().trialEnabled()) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Free trials are currently disabled. Please subscribe to continue.");
            }
            trialPlanKeys = normalizeModules(req.requestedModules());
            if (trialPlanKeys.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Pick at least one module for your free trial");
            }
            // Fail fast on launching-soon / unknown plans BEFORE we create the
            // tenant so signup never half-succeeds.
            var trialPlans = planService.requireAvailable(trialPlanKeys);
            modulesToActivate = planService.expandModules(trialPlans);
        } else if (payments.paywallActive()) {
            SignupRequest.PaymentProof p = req.payment();
            if (p == null || isBlank(p.razorpayOrderId()) || isBlank(p.razorpayPaymentId())
                    || isBlank(p.razorpaySignature())) {
                throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                        "Payment is required to create a workspace");
            }
            paid = payments.verifyPaid(p.razorpayOrderId(), p.razorpayPaymentId(), p.razorpaySignature());
            // Activated modules come from the plans that were actually paid for.
            modulesToActivate = planService.expandModules(planService.requireAvailable(paid.planKeys()));
        }

        UUID accountId = resolveOrCreateAccountId(req);
        String passwordHash = passwords.hash(req.password());
        // publishWorkspaceCreated=true — this legacy path is fully synchronous
        // (no separate webhook-driven downstream), so firing the welcome email
        // inline is the whole completion signal. (The legacy /signup-request
        // endpoint that reached this method returns 410 GONE now, but
        // paywallActive / trial branches keep it wired for admin backfills.)
        SignupResponse resp = createWorkspace(accountId, passwordHash, req, modulesToActivate,
                /*publishWorkspaceCreated=*/ true);

        if (isTrial) {
            // Write the durable TRIAL subscription (visible in platform.subscriptions
            // with plan_type='TRIAL', status='ACTIVE', current_period_end = now + trial_days).
            trials.createTrial(resp.tenantId(), resp.subdomain(), req.adminEmail(),
                    trialPlanKeys, 1);
        } else if (paid != null) {
            // Burn the order so a single successful payment can never mint a second
            // workspace (idempotency / replay guard). Done after the tenant is
            // persisted so a mid-flight failure leaves the order re-usable.
            payments.markConsumed(paid.orderId(), resp.tenantId());
        }
        return resp;
    }

    /**
     * Workspace-creation entry point for the unified autopay signup flow.
     *
     * <p>Called from the Razorpay webhook (via MandateProvisioningService)
     * once the customer's mandate is authenticated. Everything the webhook
     * needs — validated form fields, pre-hashed password, chosen modules,
     * account id if the caller was signed in — was stashed in
     * {@code platform.pending_signups} at signup time; this method reads
     * those fields and drives {@link #createWorkspace} the same way
     * {@link #createWorkspaceForAccount} does for authenticated additions.
     *
     * <p>Account resolution:
     * <ul>
     *   <li>{@code accountId} non-null (existing signed-in user adding a
     *       workspace) — reuse that account.</li>
     *   <li>{@code accountId} null (fresh signup) — generate a random UUID;
     *       {@link SaasWriter#signup} upserts the platform.accounts row with
     *       {@code ON CONFLICT DO NOTHING}. The TRIAL-mode duplicate-email
     *       gate at the signup endpoint prevents the collision case here.</li>
     * </ul>
     *
     * <p>Not idempotent by itself — the caller (webhook) enforces
     * "one workspace per pending_signup" via the pending row's status
     * transition and a lookup-before-provision check.
     */
    public SignupResponse provisionFromPending(
            UUID accountIdOrNull,
            String passwordHashOrNull,       // null when accountId is non-null (existing account)
            String companyName,
            String subdomain,
            String adminName,
            String adminEmail,
            String adminMobile,
            String country,
            String timezone,
            String currency,
            java.util.List<String> planKeys) {
        UUID accountId = accountIdOrNull != null ? accountIdOrNull : UUID.randomUUID();
        String passwordHash = passwordHashOrNull != null && !passwordHashOrNull.isBlank()
                ? passwordHashOrNull
                : "webhook-provisioned-no-plaintext-available";  // placeholder for signed-in adds

        // Fan plan keys out to catalog module keys the way the endpoint used to.
        java.util.List<String> modulesToActivate =
                planService.expandModules(planService.requireAvailable(planKeys));

        // Reuse the existing SignupRequest shape so createWorkspace does not need
        // to be rewritten. Fields we don't have from a pending row (industry,
        // companySize, primaryInterest) stay null — they are optional in the DTO.
        SignupRequest signup = new SignupRequest(
                companyName,
                subdomain,
                adminName,
                adminEmail,
                adminMobile,
                "webhook-provisioned",   // password: unused — SaasWriter uses the hash we pass separately
                null,                    // industry
                country,
                timezone,
                currency == null ? "INR" : currency,
                null,                    // companySize
                null,                    // primaryInterest (removed from public signup)
                planKeys,
                null,                    // payment proof: not used for autopay path
                null);                   // mode: not used for autopay path
        // publishWorkspaceCreated=false — the webhook path
        // (MandateProvisioningService) fires the WorkspaceCreatedEvent itself,
        // AFTER the downstream subscription-ledger INSERT + markProvisioned
        // succeed. That way a partial-provisioning failure never triggers a
        // "workspace ready" email for a workspace that isn't actually usable.
        return createWorkspace(accountId, passwordHash, signup, modulesToActivate, /*publishWorkspaceCreated=*/ false);
    }

    /**
     * Publish {@link WorkspaceCreatedEvent} on behalf of an external caller
     * (currently {@link com.unifiedtree.saas.signup.MandateProvisioningService})
     * that provisioned a workspace via {@link #provisionFromPending} and needs
     * to defer the welcome-email side-effect until after downstream inserts
     * commit. Fire-and-forget — the caller is expected to swallow exceptions
     * so a mail-side hiccup doesn't fail the provisioning path.
     */
    public void publishWorkspaceCreated(WorkspaceCreatedEvent event) {
        events.publishEvent(event);
    }

    /**
     * Build the {@link WorkspaceCreatedEvent} payload for a workspace that
     * was just provisioned via {@link #provisionFromPending}. Kept here (not
     * on the caller) so {@link #workspaceUrl(String)} and the base-domain
     * value are single-sourced.
     */
    public WorkspaceCreatedEvent buildWorkspaceCreatedEvent(
            UUID tenantId, UUID accountId, String subdomain,
            String adminName, String adminEmail, String companyName,
            List<String> activeModules) {
        return new WorkspaceCreatedEvent(
                tenantId, accountId, subdomain,
                subdomain + "." + baseDomain, workspaceUrl(subdomain),
                adminName, adminEmail, companyName, activeModules);
    }

    public SignupResponse createWorkspaceForAccount(UUID accountId, CreateWorkspaceRequest req) {
        AccountForWorkspace account = loadAccountForWorkspace(accountId);
        SignupRequest signup = new SignupRequest(
                req.companyName(),
                req.subdomain(),
                defaultText(req.adminName(), account.displayName()),
                account.email(),
                defaultText(req.adminMobile(), account.phone()),
                "account-session-password",
                req.industry(),
                req.country(),
                req.timezone(),
                req.currency(),
                req.companySize(),
                req.primaryInterest(),
                req.requestedModules(),
                null,     // payment: not applicable for existing-account flow
                null);    // mode: PAID (default)
        // publishWorkspaceCreated=true — this path is a single synchronous
        // request from an authenticated account; there's no separate provisioning
        // step downstream, so firing the welcome email inline is the whole
        // completion signal.
        return createWorkspace(account.accountId(), account.passwordHash(), signup,
                normalizeModules(req.requestedModules()), /*publishWorkspaceCreated=*/ true);
    }

    /**
     * Free-workspace creation. Synchronous, no payment, no Razorpay round-trip,
     * no trial timer running yet. The workspace is created with ZERO active
     * modules — the admin unlocks + pays inside the workspace via the
     * {@code /plan} page (which sets up autopay and starts the per-workspace
     * 7-day trial at mandate authentication).
     *
     * <p>Multiple free workspaces per account are supported. The account row
     * is reused when email + password match; a new UUID is minted otherwise.
     * Signed-in callers pass their existing accountId + null passwordHash.
     */
    public SignupResponse createFreeWorkspace(
            UUID accountIdOrNull,
            String passwordHashOrNull,       // null when accountId is non-null (existing account)
            String companyName,
            String subdomain,
            String adminName,
            String adminEmail,
            String adminMobile,
            String country,
            String timezone,
            String currency) {

        UUID accountId = accountIdOrNull != null ? accountIdOrNull : UUID.randomUUID();
        String passwordHash = passwordHashOrNull != null && !passwordHashOrNull.isBlank()
                ? passwordHashOrNull
                : "free-signup-no-password-available";  // placeholder for signed-in adds

        SignupRequest signup = new SignupRequest(
                companyName,
                subdomain,
                adminName,
                adminEmail,
                adminMobile,
                "free-signup",           // password: unused — SaasWriter uses the hash we pass separately
                null,                    // industry
                country,
                timezone,
                currency == null ? "INR" : currency,
                null,                    // companySize
                null,                    // primaryInterest
                java.util.List.of(),     // no modules requested
                null,                    // payment proof: not applicable
                null);                   // mode: not applicable

        // publishWorkspaceCreated=true — this path is a single synchronous
        // request; no separate provisioning step downstream.
        // allowEmptyModules=true — zero-module workspace is the whole point.
        return createWorkspace(accountId, passwordHash, signup,
                java.util.List.of(), /*publishWorkspaceCreated=*/ true,
                /*allowEmptyModules=*/ true);
    }

    private SignupResponse createWorkspace(UUID accountId, String passwordHash, SignupRequest req,
                                           List<String> modulesToActivate,
                                           boolean publishWorkspaceCreated) {
        return createWorkspace(accountId, passwordHash, req, modulesToActivate,
                publishWorkspaceCreated, /*allowEmptyModules=*/ false);
    }

    private SignupResponse createWorkspace(UUID accountId, String passwordHash, SignupRequest req,
                                           List<String> modulesToActivate,
                                           boolean publishWorkspaceCreated,
                                           boolean allowEmptyModules) {
        String subdomain = normalizeSubdomain(req.subdomain());
        if (subdomain.length() < 3) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Workspace address too short");
        }
        if (RESERVED_SUBDOMAINS.contains(subdomain)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Workspace address '" + subdomain + "' is reserved. Please choose another.");
        }
        // Uniqueness check for the ACTUAL create — only look at
        // platform.tenants. NOT the fuller checkSubdomain() used by the
        // /subdomains/check endpoint, which also examines pending_signups
        // AWAITING_MANDATE reservations: on the provisioning path we ARE
        // the owner of the AWAITING_MANDATE row and would 409 against
        // ourselves. Race-safety with other pending signups is enforced
        // upstream by the partial UNIQUE index on
        //   pending_signups(lower(subdomain)) WHERE status='AWAITING_MANDATE'
        // so no two can hold the same reservation concurrently.
        boolean alreadyProvisioned = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM platform.tenants WHERE lower(subdomain) = ?)",
                Boolean.class, subdomain));
        if (alreadyProvisioned) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Workspace address already reserved");
        }
        List<String> requestedModules = normalizeModules(modulesToActivate);
        if (requestedModules.isEmpty() && !allowEmptyModules) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one module");
        }
        if (!requestedModules.isEmpty()) {
            ensureModulesExist(requestedModules);
        }

        UUID tenantId = UUID.randomUUID();
        UUID userId   = UUID.randomUUID();

        // Set tenant context so the @Transactional writer's SET LOCAL kicks
        // in on the connection lease, allowing inserts into RLS-protected
        // auth.user_credentials and rbac.user_roles where tenant_id matches.
        TenantContext.setTenantId(tenantId);
        try {
            writer.signup(tenantId, accountId, userId, subdomain, baseDomain, passwordHash, requestedModules, req);
        } finally {
            TenantContext.clear();
        }

        // Fire-and-forget welcome email — listener lives in hrms-api where MailService is.
        // Wrapped: a mail-side failure must NEVER fail the signup transaction.
        //
        // Skipped when publishWorkspaceCreated=false (webhook path) — the caller
        // (MandateProvisioningService) fires the event itself AFTER the
        // subscription-ledger INSERT and markProvisioned succeed, so a broken
        // partial workspace never triggers a "workspace ready" mail.
        if (publishWorkspaceCreated) {
            try {
                events.publishEvent(new WorkspaceCreatedEvent(
                        tenantId, accountId, subdomain,
                        subdomain + "." + baseDomain, workspaceUrl(subdomain),
                        req.adminName(), req.adminEmail(), req.companyName(),
                        requestedModules));
            } catch (Exception ignored) { /* no-op; signup must not depend on email */ }
        }

        return new SignupResponse(
                accountId,
                tenantId,
                subdomain,
                workspaceUrl(subdomain),
                "ACTIVE",
                requestedModules,
                "OWNER",
                "Workspace created and instantly activated.");
    }

    private AccountForWorkspace loadAccountForWorkspace(UUID accountId) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, email, display_name, phone, password_hash, status
                      FROM platform.accounts
                     WHERE id = ?
                    """, (rs, rowNum) -> {
                String status = rs.getString("status");
                if (!"ACTIVE".equals(status)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
                }
                return new AccountForWorkspace(
                        UUID.fromString(rs.getString("id")),
                        rs.getString("email"),
                        rs.getString("display_name"),
                        rs.getString("phone"),
                        rs.getString("password_hash"));
            }, accountId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account token is no longer valid");
        }
    }

    /**
     * Public overload for callers that don't have a full SignupRequest —
     * takes email + plaintext password directly and returns the account id
     * to use (existing if email+password match, freshly minted UUID otherwise).
     * Throws 409 when an account exists but the password doesn't match.
     */
    public UUID resolveOrCreateAccountId(String email, String plaintextPassword) {
        return resolveOrCreateAccountId(new SignupRequest(
                "", "", "", email, "", plaintextPassword,
                null, null, null, null, null, null, java.util.List.of(), null, null));
    }

    private UUID resolveOrCreateAccountId(SignupRequest req) {
        String email = req.adminEmail().trim().toLowerCase(Locale.ROOT);
        return jdbc.query("""
                SELECT id, password_hash, status
                  FROM platform.accounts
                 WHERE lower(email) = lower(?)
                """, rs -> {
            if (!rs.next()) {
                return UUID.randomUUID();
            }
            String status = rs.getString("status");
            if (!"ACTIVE".equals(status)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
            }
            String existingHash = rs.getString("password_hash");
            if (!passwords.matches(req.password(), existingHash)) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "An account already exists for this email. Sign in first to create another workspace.");
            }
            return UUID.fromString(rs.getString("id"));
        }, email);
    }

    // -- Public: workspace status ----------------------------------------------------------------

    public WorkspaceStatusResponse workspaceStatus(String subdomainParam,
                                                   String tenantIdHeader,
                                                   String subdomainHeader,
                                                   String hostHeader) {
        String subdomain = resolveSubdomain(subdomainParam, tenantIdHeader, subdomainHeader, hostHeader);
        if (subdomain == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not identified");
        }
        return buildWorkspaceStatus(subdomain);
    }

    /**
     * Build the status payload for a resolved subdomain. Shared by the public
     * {@code workspace-status} read and the {@code module-toggle} write so both
     * return the same authoritative shape.
     */
    private WorkspaceStatusResponse buildWorkspaceStatus(String subdomain) {
        var tenant = jdbc.query(
                "SELECT id, subdomain, display_name, status FROM platform.tenants WHERE subdomain = ?",
                rs -> rs.next() ? new Object[]{
                        UUID.fromString(rs.getString("id")),
                        rs.getString("subdomain"),
                        rs.getString("display_name"),
                        rs.getString("status")
                } : null,
                subdomain);
        if (tenant == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }
        UUID tenantId = (UUID) tenant[0];
        List<String> activeModules = jdbc.queryForList(
                "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY module_key",
                String.class, tenantId);
        List<String> requestedModules = jdbc.queryForList(
                "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status IN ('REQUESTED','APPROVED') ORDER BY module_key",
                String.class, tenantId);
        return new WorkspaceStatusResponse(
                tenantId,
                (String) tenant[2],
                (String) tenant[1],
                (String) tenant[3],
                requestedModules,
                activeModules);
    }

    // -- Public: self-service module toggle ------------------------------------------------------

    /**
     * Modules a workspace admin may switch on/off from the public Edit-Workspace
     * page, keyed exactly as the website's {@code data/modules.ts}. The value is
     * the catalog display name used to self-seed {@code platform.module_catalog}
     * — the website ships keys (inventory, pos, …) the original catalog seed
     * never listed, and {@code tenant_modules.module_key} has an FK onto it.
     */
    private static final java.util.Map<String, String> TOGGLEABLE_MODULES = java.util.Map.ofEntries(
            java.util.Map.entry("hrms",          "HR & Employees"),
            java.util.Map.entry("attendance",    "Attendance"),
            java.util.Map.entry("payroll",       "Payroll"),
            java.util.Map.entry("accounting",    "Accounting"),
            java.util.Map.entry("inventory",     "Inventory"),
            java.util.Map.entry("crm",           "CRM"),
            java.util.Map.entry("purchase",      "Purchase"),
            java.util.Map.entry("sales",         "Sales"),
            java.util.Map.entry("projects",      "Projects"),
            java.util.Map.entry("manufacturing", "Manufacturing"),
            java.util.Map.entry("pos",           "Point of Sale"),
            java.util.Map.entry("reports",       "Reports & BI"));

    /**
     * Activate or deactivate a single module for a workspace, addressed by
     * subdomain.
     *
     * <p><b>DANGEROUS — NO CALLERS, AND DO NOT ADD ONE WITHOUT AUTHORISATION.</b>
     * This method grants or revokes paid product access from nothing but a
     * subdomain string. It performs no authentication, no authorisation, and
     * no check that the caller is connected to the workspace. Its only caller
     * was {@code POST /v1/public/module-toggle}, which sat in the
     * {@code permitAll()} list and was verified exploitable against production
     * on 2026-08-08: an unauthenticated request switched on a paid module for
     * a live workspace. The same call with {@code active=false} takes modules
     * AWAY from a paying customer. Both the endpoint and the public
     * Edit-Workspace page that called it were deleted.
     *
     * <p>The premise in the old comment — "the admin lands here from an emailed
     * deep link" — was never enforced: no token was checked, so the deep link
     * was decoration. Module state is a billing outcome and must only be
     * written by {@code PlanChangeService.activate} after Razorpay confirms a
     * mandate. If a genuine admin-facing toggle is ever needed, put it on an
     * authenticated workspace endpoint behind {@code requireAdmin} with the
     * tenant taken from the JWT, never from a request field.
     *
     * <p>Kept only because platform-admin tooling may legitimately need it one
     * day; it is unreachable today.
     *
     * <p>Writes target the non-RLS {@code platform.*} tables, so no
     * TenantContext is needed. Activation upserts the row to {@code ACTIVE};
     * deactivation hard-deletes it so re-adding is a clean insert.
     */
    public WorkspaceStatusResponse setModuleActive(String subdomainRaw, String moduleRaw, boolean active) {
        String subdomain = subdomainRaw == null ? "" : subdomainRaw.trim().toLowerCase(Locale.ROOT);
        if (subdomain.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "subdomain is required");
        }
        String moduleKey = normalizeModuleKey(moduleRaw == null ? "" : moduleRaw);
        String displayName = TOGGLEABLE_MODULES.get(moduleKey);
        if (displayName == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown module: " + moduleKey);
        }
        UUID tenantId = jdbc.query(
                "SELECT id FROM platform.tenants WHERE subdomain = ?",
                rs -> rs.next() ? UUID.fromString(rs.getString(1)) : null,
                subdomain);
        if (tenantId == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }

        if (active) {
            // Ensure the catalog row exists (FK target) before activating.
            jdbc.update("""
                    INSERT INTO platform.module_catalog (key, display_name, category, is_available)
                    VALUES (?, ?, 'ERP', TRUE)
                    ON CONFLICT (key) DO NOTHING
                    """, moduleKey, displayName);
            jdbc.update("""
                    INSERT INTO platform.tenant_modules
                        (id, tenant_id, module_key, status, requested_at, approved_at, activated_at)
                    VALUES (?, ?, ?, 'ACTIVE', now(), now(), now())
                    ON CONFLICT (tenant_id, module_key)
                    DO UPDATE SET status = 'ACTIVE', activated_at = now()
                    """, UUID.randomUUID(), tenantId, moduleKey);
        } else {
            jdbc.update("DELETE FROM platform.tenant_modules WHERE tenant_id = ? AND module_key = ?",
                    tenantId, moduleKey);
        }
        return buildWorkspaceStatus(subdomain);
    }

    // -- Public: platform admin login ------------------------------------------------------------

    public PlatformLoginResponse platformLogin(String email, String password) {
        String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);

        // Switch tenant context to the platform tenant so RLS lets us see the
        // platform admin's credentials + role grants. After we leave this
        // service call, downstream code can replace the context based on the
        // freshly-issued JWT.
        TenantContext.setTenantId(PLATFORM_TENANT_ID);
        try {
            return doPlatformLogin(normalizedEmail, password);
        } finally {
            TenantContext.clear();
        }
    }

    private PlatformLoginResponse doPlatformLogin(String email, String password) {
        try {
            Object[] row = jdbc.queryForObject(
                    "SELECT id, password_hash, is_active FROM auth.user_credentials WHERE tenant_id = ? AND email = ?",
                    (rs, n) -> new Object[]{
                            UUID.fromString(rs.getString("id")),
                            rs.getString("password_hash"),
                            rs.getBoolean("is_active")
                    },
                    PLATFORM_TENANT_ID, email);
            UUID userId = (UUID) row[0];
            String hash = (String) row[1];
            boolean active = (boolean) row[2];
            if (!active) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
            }
            if (!passwords.matches(password, hash)) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
            }
            List<String> roleCodes = jdbc.queryForList(
                    "SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id " +
                    "WHERE ur.tenant_id = ? AND ur.user_id = ?",
                    String.class, PLATFORM_TENANT_ID, userId);
            List<String> permissions = jdbc.queryForList(
                    "SELECT DISTINCT rp.permission_code FROM rbac.user_roles ur " +
                    "JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id " +
                    "WHERE ur.tenant_id = ? AND ur.user_id = ?",
                    String.class, PLATFORM_TENANT_ID, userId);
            String displayName = jdbc.query(
                    "SELECT display_name FROM platform.tenants WHERE id = ?",
                    rs -> rs.next() ? rs.getString(1) : "Platform Admin",
                    PLATFORM_TENANT_ID);

            JwtService.IssuedToken issued = jwt.issueAccessToken(
                    userId, PLATFORM_TENANT_ID, email, roleCodes, permissions);
            return new PlatformLoginResponse(
                    issued.token(),
                    issued.ttl().toSeconds(),
                    userId,
                    email,
                    displayName,
                    roleCodes,
                    permissions);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
    }

    // -- Platform admin: list tenant requests ----------------------------------------------------

    public List<TenantRequestSummary> listTenantRequests(String statusFilter) {
        String sql;
        Object[] args;
        if (statusFilter == null || statusFilter.isBlank() || "ALL".equalsIgnoreCase(statusFilter)) {
            sql = "SELECT id, display_name, subdomain, status, admin_name, contact_email, contact_phone, " +
                  "       requested_modules, created_at, approved_at, rejected_at, rejection_reason " +
                  "FROM platform.tenants " +
                  "WHERE id <> ? " +     // exclude the platform tenant itself
                  "ORDER BY created_at DESC";
            args = new Object[]{ PLATFORM_TENANT_ID };
        } else {
            sql = "SELECT id, display_name, subdomain, status, admin_name, contact_email, contact_phone, " +
                  "       requested_modules, created_at, approved_at, rejected_at, rejection_reason " +
                  "FROM platform.tenants " +
                  "WHERE id <> ? AND status = ? " +
                  "ORDER BY created_at DESC";
            args = new Object[]{ PLATFORM_TENANT_ID, statusFilter };
        }
        List<TenantRequestSummary> rows = new ArrayList<>();
        jdbc.query(sql, rs -> {
            UUID tenantId = UUID.fromString(rs.getString("id"));
            String displayName = rs.getString("display_name");
            String subdomain = rs.getString("subdomain");
            String status = rs.getString("status");
            String adminName = rs.getString("admin_name");
            String adminEmail = rs.getString("contact_email");
            String adminPhone = rs.getString("contact_phone");
            java.sql.Array requestedSqlArray = rs.getArray("requested_modules");
            String[] requested = requestedSqlArray != null
                    ? (String[]) requestedSqlArray.getArray() : new String[0];
            Instant requestedAt = rs.getTimestamp("created_at").toInstant();
            Instant approvedAt = rs.getTimestamp("approved_at") != null
                    ? rs.getTimestamp("approved_at").toInstant() : null;
            Instant rejectedAt = rs.getTimestamp("rejected_at") != null
                    ? rs.getTimestamp("rejected_at").toInstant() : null;
            String rejectionReason = rs.getString("rejection_reason");

            List<String> activeModules = jdbc.queryForList(
                    "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY module_key",
                    String.class, tenantId);
            String fullDomain = subdomain + "." + baseDomain;
            rows.add(new TenantRequestSummary(
                    tenantId, displayName, subdomain, fullDomain, status,
                    adminName, adminEmail, adminPhone,
                    List.of(requested), activeModules,
                    requestedAt, approvedAt, rejectedAt, rejectionReason));
        }, args);
        return rows;
    }

    // -- Platform admin: approve / reject --------------------------------------------------------

    public TenantRequestSummary approveTenant(UUID tenantId, UUID approverUserId, ApprovalRequest req) {
        List<String> approvedModules = normalizeModules(req.approvedModules());
        if (approvedModules.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "approvedModules must not be empty");
        }
        writer.approve(tenantId, approverUserId, approvedModules);
        return loadOne(tenantId);
    }

    public TenantRequestSummary rejectTenant(UUID tenantId, UUID rejectorUserId, RejectionRequest req) {
        if (req.reason() == null || req.reason().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Rejection reason is required");
        }
        writer.reject(tenantId, rejectorUserId, req.reason().trim());
        return loadOne(tenantId);
    }

    // -- helpers --------------------------------------------------------------------------------

    private TenantRequestSummary loadOne(UUID tenantId) {
        List<TenantRequestSummary> all = listTenantRequests(null);
        return all.stream().filter(t -> t.tenantId().equals(tenantId)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tenant not found"));
    }

    private String workspaceUrl(String subdomain) {
        return "https://" + subdomain + "." + baseDomain;
    }

    static String normalizeSubdomain(String requested) {
        if (requested == null) return "";
        String s = requested.toLowerCase(Locale.ROOT).trim()
                .replaceAll("[^a-z0-9-]", "-")
                .replaceAll("-+", "-")
                .replaceAll("^-+|-+$", "");
        return s.length() > 63 ? s.substring(0, 63) : s;
    }

    static List<String> normalizeModules(List<String> requested) {
        if (requested == null) return List.of();
        return requested.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(SaasService::normalizeModuleKey)
                .distinct()
                .toList();
    }

    private static String normalizeModuleKey(String requested) {
        String key = requested.trim().toLowerCase(Locale.ROOT);
        return switch (key) {
            case "hrms.core", "core" -> "hrms";
            case "hrms.attendance" -> "attendance";
            case "hrms.leave" -> "leave";
            default -> key;
        };
    }

    private void ensureModulesExist(List<String> modules) {
        String placeholders = String.join(",", modules.stream().map(m -> "?").toList());
        List<String> existing = jdbc.queryForList(
                "SELECT key FROM platform.module_catalog WHERE key IN (" + placeholders + ")",
                String.class,
                modules.toArray());
        HashSet<String> missing = new HashSet<>(modules);
        missing.removeAll(existing);
        if (!missing.isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Unknown module(s): " + String.join(", ", missing));
        }
    }

    private static String defaultText(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String resolveSubdomain(String subdomainParam, String tenantIdHeader,
                                    String subdomainHeader, String hostHeader) {
        // Explicit ?subdomain= wins: the website's Edit-Workspace page identifies
        // the workspace this way (no tenant headers on cross-origin calls).
        if (subdomainParam != null && !subdomainParam.isBlank()) {
            return subdomainParam.trim().toLowerCase(Locale.ROOT);
        }
        if (subdomainHeader != null && !subdomainHeader.isBlank()) {
            return subdomainHeader.trim().toLowerCase(Locale.ROOT);
        }
        if (tenantIdHeader != null && !tenantIdHeader.isBlank()) {
            // Lookup tenant by id
            return jdbc.query(
                    "SELECT subdomain FROM platform.tenants WHERE id = ?",
                    rs -> rs.next() ? rs.getString(1) : null,
                    UUID.fromString(tenantIdHeader.trim()));
        }
        if (hostHeader != null && !hostHeader.isBlank()) {
            String host = hostHeader.trim().toLowerCase(Locale.ROOT);
            int dot = host.indexOf('.');
            if (dot > 0) {
                return host.substring(0, dot);
            }
        }
        return null;
    }

    private record AccountForWorkspace(
            UUID accountId,
            String email,
            String displayName,
            String phone,
            String passwordHash
    ) {}
}
