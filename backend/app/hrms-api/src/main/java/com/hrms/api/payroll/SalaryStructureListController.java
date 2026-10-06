package com.hrms.api.payroll;

import com.unifiedtree.rbac.company.CompanyAccessService;
import com.hrms.core.dto.PageResponse;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Salary structure reads for the redesign (BW-56):
 * <ul>
 *   <li>{@code GET /v1/payroll/structures?page&size&q&noStructure&companyId}:
 *       one page of people with their current structure ({@code payroll.structure.read}),</li>
 *   <li>{@code GET /v1/payroll/structures/summary[?companyId]}: the page's tiles
 *       ({@code payroll.structure.read}),</li>
 *   <li>{@code GET /v1/payroll/structures/me/history}: the caller's own salary
 *       history with reasons ({@code payroll.structure.read.self}).</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/payroll/structures")
public class SalaryStructureListController {

    /** Company access: an optional companyId left out means the caller's current company, not every company (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private CompanyAccessService companyAccess;

    private final SalaryStructureListService service;

    public SalaryStructureListController(SalaryStructureListService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('payroll.structure.read')")
    public PageResponse<SalaryStructureListService.StructureRowDto> page(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "false") boolean noStructure,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        companyId = CompanyAccessService.listCompanyId(companyAccess, companyId);
        return service.page(TenantContext.getTenantId(), companyId, q, noStructure, page, size);
    }

    @GetMapping("/summary")
    @PreAuthorize("hasAuthority('payroll.structure.read')")
    public SalaryStructureListService.StructureSummaryDto summary(@RequestParam(required = false) UUID companyId) {
        companyId = CompanyAccessService.listCompanyId(companyAccess, companyId);
        return service.summary(TenantContext.getTenantId(), companyId);
    }

    @GetMapping("/me/history")
    @PreAuthorize("hasAuthority('payroll.structure.read.self')")
    public List<SalaryStructureListService.SalaryHistoryDto> myHistory(@AuthenticationPrincipal Jwt jwt) {
        return service.myHistory(TenantContext.getTenantId(), MyPayController.ownEmployeeId(jwt));
    }
}
