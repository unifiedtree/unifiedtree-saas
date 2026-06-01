package com.hrms.api.workforce;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.service.BranchService;
import com.hrms.employee.workforce.service.CompanyService;
import com.hrms.employee.workforce.service.DepartmentService;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Mobile compatibility surface for the canonical profile.
 *
 * <p>The Expo app still calls the legacy /v1/tenant/* routes. In canonical
 * runtime the legacy tenant module is intentionally not scanned, so these
 * endpoints adapt those calls to the canonical workforce services.
 */
@RestController
@RequestMapping("/v1/tenant")
@Profile("canonical")
@Tag(name = "Tenant Compatibility", description = "Legacy mobile tenant routes backed by canonical workforce services")
@SecurityRequirement(name = "bearerAuth")
public class CanonicalTenantCompatibilityController {

    private final CompanyService companies;
    private final DepartmentService departments;
    private final BranchService branches;
    private final WorkforceDepartmentRepository departmentRepository;

    public CanonicalTenantCompatibilityController(
            CompanyService companies,
            @Qualifier("workforceDepartmentService") DepartmentService departments,
            @Qualifier("workforceBranchService") BranchService branches,
            WorkforceDepartmentRepository departmentRepository) {
        this.companies = companies;
        this.departments = departments;
        this.branches = branches;
        this.departmentRepository = departmentRepository;
    }

    @GetMapping("/companies")
    @PreAuthorize("isAuthenticated()")
    public MobilePage<MobileCompanyResponse> listCompanies(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        List<MobileCompanyResponse> rows = companies.list().stream()
                .map(this::toCompany)
                .toList();
        return page(rows, page, size);
    }

    @GetMapping("/companies/{companyId}/departments")
    @PreAuthorize("isAuthenticated()")
    public List<MobileDepartmentResponse> listDepartments(@PathVariable UUID companyId) {
        return departments.listForCompany(companyId).stream()
                .map(this::toDepartment)
                .toList();
    }

    @PostMapping("/departments")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.department.write') or hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public MobileDepartmentResponse createDepartment(@Valid @RequestBody MobileDepartmentRequest request) {
        WorkforceDtos.DepartmentResponse created = departments.create(new WorkforceDtos.CreateDepartmentRequest(
                request.companyId(),
                request.name(),
                request.code(),
                request.parentDepartmentId(),
                null,
                request.description(),
                List.of()));
        return toDepartment(created, request.colorHex(), request.iconKey());
    }

    @PostMapping("/departments/{departmentId}/head")
    @PreAuthorize("hasAuthority('hrms.department.write') or hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public ResponseEntity<Void> assignDepartmentHead(
            @PathVariable UUID departmentId,
            @RequestParam UUID employeeId) {
        com.hrms.employee.workforce.entity.Department department = departmentRepository.findById(departmentId)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + departmentId + " not found"));
        department.setDepartmentHeadEmployeeId(employeeId);
        departmentRepository.save(department);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/companies/{companyId}/branches")
    @PreAuthorize("isAuthenticated()")
    public List<MobileBranchResponse> listBranches(@PathVariable UUID companyId) {
        return branches.listForCompany(companyId).stream()
                .map(this::toBranch)
                .toList();
    }

    @PostMapping("/branches")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('org.company.write') or hasAnyRole('HR_MANAGER','COMPANY_ADMIN','SUPER_ADMIN')")
    public MobileBranchResponse createBranch(@Valid @RequestBody MobileBranchRequest request) {
        WorkforceDtos.BranchResponse created = branches.create(new WorkforceDtos.CreateBranchRequest(
                request.companyId(),
                request.name(),
                request.code(),
                firstNonBlank(request.addressLine1(), request.address()),
                request.city(),
                request.state(),
                request.country(),
                firstNonBlank(request.postalCode(), request.pincode()),
                decimal(request.latitude()),
                decimal(request.longitude()),
                firstNonNull(request.geoFenceRadius(), request.geoFenceRadiusMeters()),
                request.isHeadquarters()));
        return toBranch(created);
    }

    private MobileCompanyResponse toCompany(WorkforceDtos.CompanyResponse company) {
        return new MobileCompanyResponse(
                company.id(),
                company.name(),
                null,
                TenantContext.getTenantId(),
                null,
                company.active(),
                company.industry(),
                company.country(),
                company.timezone(),
                company.currency(),
                Instant.now());
    }

    private MobileDepartmentResponse toDepartment(WorkforceDtos.DepartmentResponse department) {
        return toDepartment(department, null, null);
    }

    private MobileDepartmentResponse toDepartment(
            WorkforceDtos.DepartmentResponse department,
            String colorHex,
            String iconKey) {
        return new MobileDepartmentResponse(
                department.id(),
                department.name(),
                department.code(),
                department.companyId(),
                department.parentDepartmentId(),
                department.departmentHeadEmployeeId(),
                department.active(),
                department.description(),
                colorHex,
                iconKey);
    }

    private MobileBranchResponse toBranch(WorkforceDtos.BranchResponse branch) {
        return new MobileBranchResponse(
                branch.id(),
                branch.name(),
                branch.code(),
                branch.companyId(),
                branch.addressLine(),
                null,
                branch.city(),
                branch.state(),
                branch.country(),
                branch.pincode(),
                asDouble(branch.latitude()),
                asDouble(branch.longitude()),
                branch.geoFenceRadiusMeters(),
                branch.headquarters(),
                branch.active());
    }

    private static <T> MobilePage<T> page(List<T> rows, int page, int size) {
        int safePage = Math.max(0, page);
        int safeSize = Math.max(1, Math.min(100, size));
        int from = Math.min(rows.size(), safePage * safeSize);
        int to = Math.min(rows.size(), from + safeSize);
        int totalPages = rows.isEmpty() ? 0 : (int) Math.ceil((double) rows.size() / safeSize);
        return new MobilePage<>(rows.subList(from, to), safePage, safeSize, rows.size(), totalPages, safePage + 1 >= totalPages);
    }

    private static BigDecimal decimal(Double value) {
        return value == null ? null : BigDecimal.valueOf(value);
    }

    private static Double asDouble(BigDecimal value) {
        return value == null ? null : value.doubleValue();
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return second;
    }

    private static Integer firstNonNull(Integer first, Integer second) {
        return first != null ? first : second;
    }

    public record MobilePage<T>(
            List<T> content,
            int page,
            int size,
            long totalElements,
            int totalPages,
            boolean last
    ) {
    }

    public record MobileCompanyResponse(
            UUID id,
            String name,
            String code,
            UUID tenantId,
            String domain,
            boolean isActive,
            String industry,
            String country,
            String timezone,
            String currency,
            Instant createdAt
    ) {
    }

    public record MobileDepartmentRequest(
            String name,
            String code,
            UUID companyId,
            UUID parentDepartmentId,
            String description,
            String colorHex,
            String iconKey
    ) {
    }

    public record MobileDepartmentResponse(
            UUID id,
            String name,
            String code,
            UUID companyId,
            UUID parentDepartmentId,
            UUID headEmployeeId,
            boolean isActive,
            String description,
            String colorHex,
            String iconKey
    ) {
    }

    public record MobileBranchRequest(
            String name,
            String code,
            UUID companyId,
            String address,
            String addressLine1,
            String addressLine2,
            String city,
            String state,
            String country,
            String postalCode,
            String pincode,
            Double latitude,
            Double longitude,
            Integer geoFenceRadius,
            Integer geoFenceRadiusMeters,
            Boolean isHeadquarters
    ) {
    }

    public record MobileBranchResponse(
            UUID id,
            String name,
            String code,
            UUID companyId,
            String addressLine1,
            String addressLine2,
            String city,
            String state,
            String country,
            String postalCode,
            Double latitude,
            Double longitude,
            Integer geoFenceRadius,
            boolean isHeadquarters,
            boolean isActive
    ) {
    }
}
