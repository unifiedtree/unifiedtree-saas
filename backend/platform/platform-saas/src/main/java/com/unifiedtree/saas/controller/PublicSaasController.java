package com.unifiedtree.saas.controller;

import com.unifiedtree.saas.dto.SaasDtos.SignupRequest;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.dto.SaasDtos.SubdomainCheckResponse;
import com.unifiedtree.saas.dto.SaasDtos.WorkspaceStatusResponse;
import com.unifiedtree.saas.service.SaasService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

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

    @PostMapping("/signup-request")
    public SignupResponse signup(@Valid @RequestBody SignupRequest req) {
        return saas.createSignupRequest(req);
    }

    @GetMapping("/subdomains/check")
    public SubdomainCheckResponse checkSubdomain(@RequestParam("slug") String slug) {
        return saas.checkSubdomain(slug);
    }

    @GetMapping("/workspace-status")
    public WorkspaceStatusResponse workspaceStatus(
            @RequestHeader(value = "X-Tenant-ID",        required = false) String tenantIdHeader,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomainHeader,
            @RequestHeader(value = "Host",               required = false) String hostHeader) {
        return saas.workspaceStatus(tenantIdHeader, subdomainHeader, hostHeader);
    }
}
