package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Company KPIs (redesign BW-83): read by anyone who sees performance or sets their
 * own goals (the goal forms list them); managed with {@code hrms.kpi.manage}.
 * Progress is the weighted average of the linked goals ({@link CompanyKpiService}).
 */
@RestController
@RequestMapping("/v1/performance/company-kpis")
public class CompanyKpiController {

    private final CompanyKpiService service;

    public CompanyKpiController(CompanyKpiService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAnyAuthority('hrms.performance.read','hrms.performance.review.self')")
    public List<CompanyKpiService.CompanyKpi> list(@RequestParam(required = false) UUID companyId,
                                                   @RequestParam(defaultValue = "false") boolean includeDropped) {
        return service.list(TenantContext.getTenantId(), companyId, includeDropped);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.kpi.manage')")
    public CompanyKpiService.CompanyKpi create(@RequestBody CompanyKpiService.CompanyKpiRequest request,
                                               @AuthenticationPrincipal Jwt jwt) {
        return service.create(TenantContext.getTenantId(), request, userId(jwt));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.kpi.manage')")
    public CompanyKpiService.CompanyKpi update(@PathVariable UUID id,
                                               @RequestBody CompanyKpiService.CompanyKpiRequest request,
                                               @AuthenticationPrincipal Jwt jwt) {
        return service.update(TenantContext.getTenantId(), id, request, userId(jwt));
    }

    private static UUID userId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
