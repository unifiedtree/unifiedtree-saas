package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Salary component catalog (Prompt 12). */
@RestController
@RequestMapping("/v1/payroll/components")
public class SalaryComponentController {

    private final PayrollService service;

    public SalaryComponentController(PayrollService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('payroll.components.read')")
    public List<PayrollService.ComponentDto> list() {
        return service.listComponents(TenantContext.getTenantId());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('payroll.components.manage')")
    @ResponseStatus(HttpStatus.CREATED)
    public void create(@RequestBody PayrollService.CreateComponentRequest req) {
        service.createComponent(TenantContext.getTenantId(), req);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('payroll.components.manage')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void update(@PathVariable UUID id, @RequestBody PayrollService.CreateComponentRequest req) {
        service.updateComponent(TenantContext.getTenantId(), id, req);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('payroll.components.manage')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.deleteComponent(TenantContext.getTenantId(), id);
    }

    @PostMapping("/seed-defaults")
    @PreAuthorize("hasAuthority('payroll.components.manage')")
    public Map<String, Object> seedDefaults() {
        int count = service.seedDefaults(TenantContext.getTenantId());
        return Map.of("seeded", true, "componentCount", count);
    }
}
