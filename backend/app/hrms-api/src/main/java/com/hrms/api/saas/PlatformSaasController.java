package com.hrms.api.saas;

import com.hrms.api.saas.SaasDtos.ApprovalRequest;
import com.hrms.api.saas.SaasDtos.PlatformLoginRequest;
import com.hrms.api.saas.SaasDtos.PlatformLoginResponse;
import com.hrms.api.saas.SaasDtos.RejectionRequest;
import com.hrms.api.saas.SaasDtos.TenantRequestSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

// Replaced by com.unifiedtree.saas.controller.PlatformSaasController in platform-saas module
@RequestMapping("/v1/platform")
@Tag(name = "Platform Administration", description = "UnifiedTree administrator approval APIs")
public class PlatformSaasController {

    private final SaasPlatformService saasPlatformService;

    public PlatformSaasController(SaasPlatformService saasPlatformService) {
        this.saasPlatformService = saasPlatformService;
    }

    @Operation(summary = "UnifiedTree administrator login")
    @PostMapping("/auth/login")
    public ResponseEntity<PlatformLoginResponse> login(@Valid @RequestBody PlatformLoginRequest request) {
        return ResponseEntity.ok(saasPlatformService.platformLogin(request.email(), request.password()));
    }

    @Operation(summary = "List tenant signup requests")
    @SecurityRequirement(name = "bearerAuth")
    @GetMapping("/tenant-requests")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<List<TenantRequestSummary>> tenantRequests(
            @RequestParam(required = false) String status) {
        return ResponseEntity.ok(saasPlatformService.tenantRequests(status));
    }

    @Operation(summary = "Approve requested tenant modules")
    @SecurityRequirement(name = "bearerAuth")
    @PostMapping("/tenant-requests/{tenantId}/approve")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<TenantRequestSummary> approve(
            @PathVariable UUID tenantId,
            @Valid @RequestBody ApprovalRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(saasPlatformService.approveTenant(tenantId, UUID.fromString(jwt.getSubject()), request));
    }

    @Operation(summary = "Reject a tenant signup request")
    @SecurityRequirement(name = "bearerAuth")
    @PostMapping("/tenant-requests/{tenantId}/reject")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<TenantRequestSummary> reject(
            @PathVariable UUID tenantId,
            @Valid @RequestBody RejectionRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(saasPlatformService.rejectTenant(tenantId, UUID.fromString(jwt.getSubject()), request));
    }
}
