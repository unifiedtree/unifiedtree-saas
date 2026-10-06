package com.hrms.api.workforce;

import com.unifiedtree.rbac.company.CompanyAccessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * The org chart, for everyone signed in (client ask, 1 Oct 2026). What each
 * person sees is decided in {@link OrgChartService}: the whole company with
 * hrms.employee.read, otherwise their own line up to the top and everyone
 * below them. /v1/hrms is behind the HRMS module (TenantModuleGuard).
 */
@RestController
@RequestMapping("/v1/hrms/org-chart")
@Tag(name = "Org chart", description = "Reporting lines, from the top person down")
@SecurityRequirement(name = "bearerAuth")
public class OrgChartController {

    /** Company access: an optional companyId left out means the caller's current company, not every company (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private CompanyAccessService companyAccess;

    private final OrgChartService service;

    public OrgChartController(OrgChartService service) {
        this.service = service;
    }

    @Operation(summary = "The org chart: one company's tree with hrms.employee.read, else the caller's own line and everyone below them")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public OrgChartService.OrgChart chart(@RequestParam(required = false) UUID companyId,
                                          @AuthenticationPrincipal Jwt jwt, Authentication auth) {
        companyId = CompanyAccessService.listCompanyId(companyAccess, companyId);
        return service.chart(companyId, jwt, auth);
    }
}
