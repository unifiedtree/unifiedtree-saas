package com.hrms.api.compliance;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

@RestController
public class InspectorAccessController {
    private final InspectorAccessService service;
    public InspectorAccessController(InspectorAccessService service) { this.service = service; }
    @PostMapping("/v1/compliance/inspector-sessions/{id}/link")
    @PreAuthorize("hasAnyAuthority('hrms.compliance.inspector.write','hrms.compliance.write')")
    public Map<String, String> link(@PathVariable UUID id) { return Map.of("token", service.issue(id)); }
    public record AccessRequest(String token, LocalDate from, LocalDate to) {}
    @PostMapping("/v1/public/inspector-view")
    public org.springframework.http.ResponseEntity<InspectorAccessService.AuditView> view(@RequestBody AccessRequest request) {
        // Authenticate the signed capability before choosing the transaction's tenant.
        UUID[] scope = service.verify(request.token());
        UUID previous = com.unifiedtree.security.tenant.TenantContext.getTenantId();
        UUID legacyPrevious = com.hrms.core.tenant.TenantContext.getTenantId();
        try {
            com.unifiedtree.security.tenant.TenantContext.setTenantId(scope[0]);
            com.hrms.core.tenant.TenantContext.setTenantId(scope[0]);
            return org.springframework.http.ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore()).body(service.read(scope[1], request.from(), request.to()));
        } finally {
            com.unifiedtree.security.tenant.TenantContext.setTenantId(previous);
            com.hrms.core.tenant.TenantContext.setTenantId(legacyPrevious);
        }
    }
}
