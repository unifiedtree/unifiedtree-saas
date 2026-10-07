package com.hrms.api.payroll;

import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Payroll settings + PT slab reference data (Prompt 12).
 *
 * <p>Settings are per company (V143.105, owner decision 7 Oct 2026): the company is the
 * {@code companyId} parameter, else the one chosen with {@code X-Company-Id}, else the caller's
 * home company, else the workspace's only company; with none of those (or before V143.105) the
 * workspace's settings, as before. Same permissions as before.
 */
@RestController
@RequestMapping("/v1/payroll")
public class PayrollSettingsController {

    private final PayrollService service;

    /** The caller's home company when the request names none. Optional, so tests can build the controller bare. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private CompanyAccessService companyAccess;

    public PayrollSettingsController(PayrollService service) {
        this.service = service;
    }

    @GetMapping("/settings")
    @PreAuthorize("hasAuthority('payroll.settings.read')")
    public PayrollService.SettingsDto getSettings(@RequestParam(required = false) UUID companyId) {
        return service.getSettings(TenantContext.getTenantId(), company(companyId));
    }

    @PutMapping("/settings")
    @PreAuthorize("hasAuthority('payroll.settings.update')")
    public PayrollService.SettingsDto updateSettings(@RequestParam(required = false) UUID companyId,
                                                     @jakarta.validation.Valid @RequestBody PayrollService.SettingsDto req) {
        return service.updateSettings(TenantContext.getTenantId(), company(companyId), req);
    }

    /** The company a settings request is for (see the class note); null = let the service decide. */
    UUID company(UUID requested) {
        if (requested != null) return requested;
        UUID selected = CompanyContext.getCompanyId();
        if (selected != null) return selected;
        if (companyAccess == null) return null;
        try {
            return companyAccess.currentCompanyId();
        } catch (RuntimeException e) {
            // No signed-in workspace person to take a home company from: the service decides.
            return null;
        }
    }

    @GetMapping("/pt-slabs/{stateCode}")
    @PreAuthorize("hasAuthority('payroll.pt_slabs.read')")
    public List<PayrollService.PtSlabDto> ptSlabsByPath(@PathVariable String stateCode) {
        return service.getPtSlabs(stateCode);
    }

    @GetMapping("/pt-slabs")
    @PreAuthorize("hasAuthority('payroll.pt_slabs.read')")
    public List<PayrollService.PtSlabDto> ptSlabsByQuery(@RequestParam String state) {
        return service.getPtSlabs(state);
    }
}
