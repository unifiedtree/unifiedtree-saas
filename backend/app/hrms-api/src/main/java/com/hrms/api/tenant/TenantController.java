package com.hrms.api.tenant;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.tenant.TenantContext;
import com.hrms.tenant.dto.BranchRequest;
import com.hrms.tenant.dto.BranchResponse;
import com.hrms.tenant.dto.CompanyRequest;
import com.hrms.tenant.dto.CompanyResponse;
import com.hrms.tenant.dto.DepartmentRequest;
import com.hrms.tenant.dto.DepartmentResponse;
import com.hrms.tenant.service.BranchService;
import com.hrms.tenant.service.DepartmentService;
import com.hrms.tenant.service.TenantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/tenant")
@Tag(name = "Tenant & Org", description = "Companies, departments, and branch management")
@SecurityRequirement(name = "bearerAuth")
public class TenantController {

    private final TenantService tenantService;
    private final DepartmentService departmentService;
    private final BranchService branchService;

    public TenantController(TenantService tenantService,
                             DepartmentService departmentService,
                             BranchService branchService) {
        this.tenantService = tenantService;
        this.departmentService = departmentService;
        this.branchService = branchService;
    }

    // ─── Companies ────────────────────────────────────────────────────────────

    @Operation(summary = "Create a new company within the current tenant")
    @PostMapping("/companies")
    @PreAuthorize("hasAnyRole('COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<CompanyResponse> createCompany(@Valid @RequestBody CompanyRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(tenantService.createCompany(request, TenantContext.getTenantId()));
    }

    @Operation(summary = "Get a company by ID")
    @GetMapping("/companies/{companyId}")
    @PreAuthorize("hasAnyRole('COMPANY_ADMIN','SUPER_ADMIN','HR_MANAGER')")
    public ResponseEntity<CompanyResponse> getCompany(@PathVariable UUID companyId) {
        return ResponseEntity.ok(tenantService.getCompany(companyId));
    }

    @Operation(summary = "List companies in this tenant")
    @GetMapping("/companies")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','COMPANY_ADMIN')")
    public ResponseEntity<PageResponse<CompanyResponse>> listCompanies(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(tenantService.listCompanies(pageable));
    }

    // ─── Departments ─────────────────────────────────────────────────────────

    @Operation(summary = "Create a department")
    @PostMapping("/departments")
    @PreAuthorize("hasAnyRole('COMPANY_ADMIN','SUPER_ADMIN','HR_MANAGER')")
    public ResponseEntity<DepartmentResponse> createDepartment(
            @Valid @RequestBody DepartmentRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(departmentService.createDepartment(request));
    }

    @Operation(summary = "Get department tree for a company")
    @GetMapping("/companies/{companyId}/departments")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<DepartmentResponse>> getDeptTree(@PathVariable UUID companyId) {
        return ResponseEntity.ok(departmentService.getDepartmentTree(companyId));
    }

    @Operation(summary = "Assign a department head")
    @PostMapping("/departments/{deptId}/head")
    @PreAuthorize("hasAnyRole('COMPANY_ADMIN','SUPER_ADMIN','HR_MANAGER')")
    public ResponseEntity<Void> assignHead(
            @PathVariable UUID deptId,
            @RequestParam UUID employeeId) {
        departmentService.assignDepartmentHead(deptId, employeeId);
        return ResponseEntity.noContent().build();
    }

    // ─── Branches ────────────────────────────────────────────────────────────

    @Operation(summary = "Create a branch / office location")
    @PostMapping("/branches")
    @PreAuthorize("hasAnyRole('COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<BranchResponse> createBranch(@Valid @RequestBody BranchRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(branchService.createBranch(request));
    }

    @Operation(summary = "List branches for a company")
    @GetMapping("/companies/{companyId}/branches")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<BranchResponse>> listBranches(@PathVariable UUID companyId) {
        return ResponseEntity.ok(branchService.listByCompany(companyId));
    }
}
