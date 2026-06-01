package com.hrms.api.saas;

import com.hrms.api.saas.SaasDtos.SignupRequest;
import com.hrms.api.saas.SaasDtos.SignupResponse;
import com.hrms.api.saas.SaasDtos.SubdomainCheckResponse;
import com.hrms.api.saas.SaasDtos.WorkspaceStatusResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

// Replaced by com.unifiedtree.saas.controller.PublicSaasController in platform-saas module
@RequestMapping("/v1/public")
@Tag(name = "Public SaaS", description = "UnifiedTree signup, workspace reservation, and status APIs")
public class PublicSaasController {

    private final SaasPlatformService saasPlatformService;

    public PublicSaasController(SaasPlatformService saasPlatformService) {
        this.saasPlatformService = saasPlatformService;
    }

    @Operation(summary = "Create a pending UnifiedTree tenant workspace request")
    @PostMapping("/signup-request")
    public ResponseEntity<SignupResponse> signupRequest(@Valid @RequestBody SignupRequest request) {
        return ResponseEntity.ok(saasPlatformService.createSignupRequest(request));
    }

    @Operation(summary = "Check whether a tenant subdomain is available")
    @GetMapping("/subdomains/check")
    public ResponseEntity<SubdomainCheckResponse> checkSubdomain(@RequestParam("slug") String slug) {
        return ResponseEntity.ok(saasPlatformService.checkSubdomain(slug));
    }

    @Operation(summary = "Get workspace approval/module status")
    @GetMapping("/workspace-status")
    public ResponseEntity<WorkspaceStatusResponse> workspaceStatus(
            @RequestHeader(value = "X-Tenant-ID", required = false) String tenantId,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomain,
            @RequestHeader(value = "Host", required = false) String host) {
        return ResponseEntity.ok(saasPlatformService.workspaceStatus(tenantId, subdomain, host));
    }
}
