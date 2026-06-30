package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/** Per-employee salary structures (Prompt 12). */
@RestController
@RequestMapping("/v1/payroll/structures")
public class EmployeeStructureController {

    private final PayrollService service;

    public EmployeeStructureController(PayrollService service) {
        this.service = service;
    }

    @GetMapping("/employee/{id}")
    @PreAuthorize("hasAuthority('payroll.structure.read')")
    public PayrollService.StructureDto byEmployee(@PathVariable UUID id) {
        return service.getCurrentStructure(TenantContext.getTenantId(), id);
    }

    @GetMapping("/employee/{id}/history")
    @PreAuthorize("hasAuthority('payroll.structure.read')")
    public List<PayrollService.StructureDto> history(@PathVariable UUID id) {
        return service.getStructureHistory(TenantContext.getTenantId(), id);
    }

    @GetMapping("/me")
    @PreAuthorize("hasAuthority('payroll.structure.read.self')")
    public PayrollService.StructureDto me(@AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        return service.getCurrentStructure(TenantContext.getTenantId(), employeeId);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('payroll.structure.manage')")
    public PayrollService.StructureDto create(@jakarta.validation.Valid @RequestBody PayrollService.CreateStructureRequest req) {
        return service.createStructure(TenantContext.getTenantId(), req);
    }

    @PutMapping
    @PreAuthorize("hasAuthority('payroll.structure.manage')")
    public PayrollService.StructureDto revise(@jakarta.validation.Valid @RequestBody PayrollService.CreateStructureRequest req) {
        return service.createStructure(TenantContext.getTenantId(), req);
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        return employeeId != null ? UUID.fromString(employeeId) : UUID.fromString(jwt.getSubject());
    }
}
