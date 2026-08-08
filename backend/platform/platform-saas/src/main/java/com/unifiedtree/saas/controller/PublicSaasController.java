package com.unifiedtree.saas.controller;

import com.unifiedtree.saas.dto.SaasDtos.SubdomainCheckResponse;
import com.unifiedtree.saas.dto.SaasDtos.WorkspaceStatusResponse;
import com.unifiedtree.saas.service.SaasService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Unauthenticated SaaS portal endpoints. Mounted under /v1/public so the
 * CanonicalProdSecurityConfig's permitAll() rules let anonymous traffic in.
 *
 * <p>These three endpoints replace the legacy com.hrms.api.saas
 * PublicSaasController which targeted public.* tables and was not loaded
 * under canonical-prod.
 */
@RestController
@RequestMapping("/v1/public")
public class PublicSaasController {

    private final SaasService saas;

    public PublicSaasController(SaasService saas) {
        this.saas = saas;
    }

    /**
     * DEPRECATED — replaced by POST /v1/public/subscription-signup.
     *
     * <p>The legacy path let any caller mint a workspace with
     * {@code mode="TRIAL"} without ever touching Razorpay, bypassing the
     * hard-gate autopay-mandate contract. Kept here only as a 410 GONE stub
     * so the frontend gets a clear "moved" signal in the (unlikely) case a
     * stale bundle still calls it; the real signup flow now lives at
     * {@code POST /v1/public/subscription-signup} which requires an
     * authenticated Razorpay subscription before the tenant is written.
     */
    @PostMapping("/signup-request")
    public ResponseEntity<Map<String, String>> signupDeprecated() {
        return ResponseEntity.status(HttpStatus.GONE).body(Map.of(
                "error", "moved",
                "message", "This endpoint has been retired. Signup now requires an autopay mandate.",
                "replacement", "/v1/public/subscription-signup"));
    }

    @GetMapping("/subdomains/check")
    public SubdomainCheckResponse checkSubdomain(@RequestParam("slug") String slug) {
        return saas.checkSubdomain(slug);
    }

    @GetMapping("/workspace-status")
    public WorkspaceStatusResponse workspaceStatus(
            @RequestParam(value = "subdomain",           required = false) String subdomainParam,
            @RequestHeader(value = "X-Tenant-ID",        required = false) String tenantIdHeader,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomainHeader,
            @RequestHeader(value = "Host",               required = false) String hostHeader) {
        return saas.workspaceStatus(subdomainParam, tenantIdHeader, subdomainHeader, hostHeader);
    }

    /**
     * REMOVED 2026-08-08 — {@code POST /v1/public/module-toggle}.
     *
     * <p>It took {@code {subdomain, module, active}} and called
     * {@code saas.setModuleActive} with NO authentication, NO authorisation and
     * no check that the caller had anything to do with the workspace. It sat in
     * the {@code permitAll()} list, so anyone on the internet who knew a
     * subdomain — and subdomains are public, they are in the URL — could:
     * <ul>
     *   <li>switch ON any paid module for any workspace, free, bypassing the
     *       entire Razorpay flow; and</li>
     *   <li>switch OFF modules belonging to a paying customer, i.e. a
     *       one-request denial of service against a live client.</li>
     * </ul>
     * Verified exploitable against production on 2026-08-08: a token-less
     * request enabled {@code crm} on a live workspace and the response echoed
     * the module as active. It is the most likely explanation for tenants
     * holding modules they never bought, including LAUNCHING_SOON ones that
     * cannot be purchased at all.
     *
     * <p>Not re-secured, deleted. Module state is a billing outcome: it is
     * written by {@code PlanChangeService.activate} once Razorpay confirms a
     * mandate, and read everywhere else. A self-service switch on an
     * unauthenticated marketing page contradicts the paid model outright, so
     * there is nothing here worth keeping behind an auth check. The public
     * {@code /edit-workspace} page that called it was removed in the same
     * change. Customers change modules from {@code /plan} inside the
     * workspace, which is admin-gated and goes through payment.
     *
     * <p>{@code POST /v1/public/module-request} is unaffected and stays: it
     * only emails us and records REQUESTED rows, and never grants access.
     */
}
