package com.hrms.api.compliance;

import com.hrms.compliance.dto.ComplianceItemRequest;
import com.hrms.compliance.dto.ComplianceItemResponse;
import com.hrms.compliance.dto.FileFilingRequest;
import com.hrms.compliance.dto.PoshComplaintRequest;
import com.hrms.compliance.dto.PoshComplaintResponse;
import com.hrms.compliance.dto.PoshStatusRequest;
import com.hrms.compliance.dto.StatutoryFilingRequest;
import com.hrms.compliance.dto.StatutoryFilingResponse;
import com.hrms.compliance.service.ComplianceService;
import com.hrms.compliance.service.PoshService;
import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Statutory compliance: compliance calendar (obligations + due dates), the
 * statutory filings ledger (PF / ESI / TDS / PT / Gratuity), and the
 * access-restricted POSH complaints register.
 */
@RestController
@RequestMapping("/v1/compliance")
@Tag(name = "Compliance", description = "Compliance calendar, statutory filings, and POSH register")
@SecurityRequirement(name = "bearerAuth")
public class ComplianceController {

    private final ComplianceService complianceService;
    private final PoshService poshService;
    private final EmployeeRepository employeeRepository;

    public ComplianceController(ComplianceService complianceService,
                                PoshService poshService,
                                EmployeeRepository employeeRepository) {
        this.complianceService = complianceService;
        this.poshService = poshService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Compliance calendar ─────────────────────────────────────────────────

    @Operation(summary = "Create a compliance calendar item")
    @PostMapping("/items")
    @PreAuthorize("hasAuthority('hrms.compliance.write')")
    public ResponseEntity<ComplianceItemResponse> createItem(
            @Valid @RequestBody ComplianceItemRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = resolveCompanyId(request.companyId(), jwt);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichItem(complianceService.createItem(companyId, request)));
    }

    @Operation(summary = "List compliance calendar items")
    @GetMapping("/items")
    @PreAuthorize("hasAuthority('hrms.compliance.read')")
    public ResponseEntity<PageResponse<ComplianceItemResponse>> listItems(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(enrichItems(complianceService.listItems(companyId, pageable)));
    }

    @Operation(summary = "Mark a compliance item as done")
    @PostMapping("/items/{id}/done")
    @PreAuthorize("hasAuthority('hrms.compliance.write')")
    public ResponseEntity<ComplianceItemResponse> markItemDone(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichItem(complianceService.markItemDone(id)));
    }

    // ─── Statutory filings ───────────────────────────────────────────────────

    @Operation(summary = "Create a statutory filing record")
    @PostMapping("/filings")
    @PreAuthorize("hasAuthority('hrms.compliance.write')")
    public ResponseEntity<StatutoryFilingResponse> createFiling(
            @Valid @RequestBody StatutoryFilingRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = resolveCompanyId(request.companyId(), jwt);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(complianceService.createFiling(companyId, request));
    }

    @Operation(summary = "List statutory filings")
    @GetMapping("/filings")
    @PreAuthorize("hasAuthority('hrms.compliance.read')")
    public ResponseEntity<PageResponse<StatutoryFilingResponse>> listFilings(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(complianceService.listFilings(companyId, pageable));
    }

    @Operation(summary = "Record a statutory filing as filed")
    @PostMapping("/filings/{id}/file")
    @PreAuthorize("hasAuthority('hrms.compliance.write')")
    public ResponseEntity<StatutoryFilingResponse> fileFiling(
            @PathVariable UUID id,
            @RequestBody(required = false) FileFilingRequest request) {
        return ResponseEntity.ok(complianceService.fileFiling(id, request));
    }

    // ─── POSH register (sensitive) ───────────────────────────────────────────

    @Operation(summary = "Register a POSH complaint")
    @PostMapping("/posh")
    @PreAuthorize("hasAuthority('hrms.compliance.posh')")
    public ResponseEntity<PoshComplaintResponse> createComplaint(
            @Valid @RequestBody PoshComplaintRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = resolveCompanyId(request.companyId(), jwt);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(poshService.createComplaint(companyId, request));
    }

    @Operation(summary = "List POSH complaints")
    @GetMapping("/posh")
    @PreAuthorize("hasAuthority('hrms.compliance.posh')")
    public ResponseEntity<PageResponse<PoshComplaintResponse>> listComplaints(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 50) Pageable pageable) {
        return ResponseEntity.ok(poshService.listComplaints(companyId, pageable));
    }

    @Operation(summary = "Update a POSH complaint status")
    @PostMapping("/posh/{id}/status")
    @PreAuthorize("hasAuthority('hrms.compliance.posh')")
    public ResponseEntity<PoshComplaintResponse> updateComplaintStatus(
            @PathVariable UUID id,
            @Valid @RequestBody PoshStatusRequest request) {
        return ResponseEntity.ok(poshService.updateStatus(id, request));
    }

    // ─── Owner identity enrichment ───────────────────────────────────────────
    // The compliance module has no dependency on hrms-employee, so the calendar
    // item owner's name / code are resolved here (the API layer) and folded into
    // the response so the calendar can show WHO is accountable.

    private PageResponse<ComplianceItemResponse> enrichItems(PageResponse<ComplianceItemResponse> page) {
        List<UUID> ownerIds = page.content().stream()
                .map(ComplianceItemResponse::ownerId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> ownerMap = ownerIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(ownerIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<ComplianceItemResponse> enriched = page.content().stream()
                .map(r -> enrich(r, ownerMap.get(r.ownerId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private ComplianceItemResponse enrichItem(ComplianceItemResponse r) {
        Employee owner = r.ownerId() == null
                ? null
                : employeeRepository.findById(r.ownerId()).orElse(null);
        return enrich(r, owner);
    }

    private ComplianceItemResponse enrich(ComplianceItemResponse r, Employee owner) {
        String ownerName = owner != null
                ? (owner.getFirstName() + " " + owner.getLastName()).trim()
                : null;
        String ownerCode = owner != null ? owner.getEmployeeCode() : null;
        return new ComplianceItemResponse(
                r.id(), r.companyId(), r.title(), r.category(), r.dueDate(), r.status(),
                r.frequency(), r.ownerId(), ownerName, ownerCode, r.notes(), r.createdAt());
    }

    // ─── helpers ─────────────────────────────────────────────────────────────

    private UUID resolveCompanyId(UUID requested, Jwt jwt) {
        if (requested != null) {
            return requested;
        }
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        return employee.getCompanyId();
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
