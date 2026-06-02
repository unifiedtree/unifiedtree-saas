package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Tenant payroll settings + PT slab reference data (Prompt 12). */
@RestController
@RequestMapping("/v1/payroll")
public class PayrollSettingsController {

    private final PayrollService service;

    public PayrollSettingsController(PayrollService service) {
        this.service = service;
    }

    @GetMapping("/settings")
    @PreAuthorize("hasAuthority('payroll.settings.read')")
    public PayrollService.SettingsDto getSettings() {
        return service.getSettings(TenantContext.getTenantId());
    }

    @PutMapping("/settings")
    @PreAuthorize("hasAuthority('payroll.settings.update')")
    public PayrollService.SettingsDto updateSettings(@RequestBody PayrollService.SettingsDto req) {
        return service.updateSettings(TenantContext.getTenantId(), req);
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
