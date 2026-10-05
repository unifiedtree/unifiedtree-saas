package com.unifiedtree.saas.controller;

import com.unifiedtree.saas.dto.SaasDtos.ApprovalRequest;
import com.unifiedtree.saas.dto.SaasDtos.PlatformLoginRequest;
import com.unifiedtree.saas.dto.SaasDtos.PlatformLoginResponse;
import com.unifiedtree.saas.dto.SaasDtos.RejectionRequest;
import com.unifiedtree.saas.dto.SaasDtos.TenantRequestSummary;
import com.unifiedtree.saas.service.SaasService;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * UnifiedTree platform admin endpoints. Login is unauthenticated; everything
 * else needs a platform admin token ({@link com.unifiedtree.saas.security.PlatformAdminAccess})
 * AND the platform.tenant.* permission code seeded in V019. A workspace token
 * is refused even if it carries the code (SUPER_ADMIN did until V143_92).
 */
@RestController
@RequestMapping("/v1/platform")
public class PlatformSaasController {

    private final SaasService saas;

    public PlatformSaasController(SaasService saas) {
        this.saas = saas;
    }

    @PostMapping("/auth/login")
    public PlatformLoginResponse login(@Valid @RequestBody PlatformLoginRequest req) {
        return saas.platformLogin(req.email(), req.password());
    }

    @GetMapping("/tenant-requests")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.read')")
    public List<TenantRequestSummary> tenantRequests(@RequestParam(required = false) String status) {
        return saas.listTenantRequests(status);
    }

    @PostMapping("/tenant-requests/{tenantId}/approve")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.approve')")
    public TenantRequestSummary approve(@PathVariable UUID tenantId,
                                        @Valid @RequestBody ApprovalRequest req,
                                        @AuthenticationPrincipal Jwt jwt) {
        return saas.approveTenant(tenantId, UUID.fromString(jwt.getSubject()), req);
    }

    @PostMapping("/tenant-requests/{tenantId}/reject")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.reject')")
    public TenantRequestSummary reject(@PathVariable UUID tenantId,
                                       @Valid @RequestBody RejectionRequest req,
                                       @AuthenticationPrincipal Jwt jwt) {
        return saas.rejectTenant(tenantId, UUID.fromString(jwt.getSubject()), req);
    }
}
