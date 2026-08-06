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
     * Self-service module switch for the public Edit-Workspace page. Activates
     * ({@code active=true}) or removes ({@code active=false}) a single module
     * for the workspace and returns the refreshed status so the caller can sync
     * its UI immediately.
     */
    @PostMapping("/module-toggle")
    public WorkspaceStatusResponse toggleModule(@Valid @RequestBody ModuleToggleRequest req) {
        return saas.setModuleActive(req.subdomain(), req.module(), req.active());
    }

    public record ModuleToggleRequest(
            @NotBlank String subdomain,
            @NotBlank String module,
            boolean active) {}
}
