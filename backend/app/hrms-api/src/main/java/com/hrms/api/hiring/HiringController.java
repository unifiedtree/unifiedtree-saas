package com.hrms.api.hiring;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.hiring.dto.CandidateRequest;
import com.hrms.hiring.dto.CandidateResponse;
import com.hrms.hiring.dto.CandidateStageRequest;
import com.hrms.hiring.dto.JobRequisitionRequest;
import com.hrms.hiring.dto.JobRequisitionResponse;
import com.hrms.hiring.service.HiringService;
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
 * Recruitment: job requisition management and the candidate hiring pipeline.
 * Tenant isolation is enforced at the persistence layer (RLS + Hibernate filter);
 * the hiring manager's display name is enriched here in the API layer.
 */
@RestController
@RequestMapping("/v1/hiring")
@Tag(name = "Hiring", description = "Job requisitions and candidate pipeline")
@SecurityRequirement(name = "bearerAuth")
public class HiringController {

    private final HiringService hiringService;
    private final EmployeeRepository employeeRepository;

    public HiringController(HiringService hiringService,
                            EmployeeRepository employeeRepository) {
        this.hiringService = hiringService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Requisitions ────────────────────────────────────────────────────────

    @Operation(summary = "Create a job requisition")
    @PostMapping("/requisitions")
    @PreAuthorize("hasAuthority('hrms.hiring.write')")
    public ResponseEntity<JobRequisitionResponse> createRequisition(
            @Valid @RequestBody JobRequisitionRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = request.companyId();
        if (companyId == null) {
            UUID employeeId = extractEmployeeId(jwt);
            Employee employee = employeeRepository.findById(employeeId)
                    .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
            companyId = employee.getCompanyId();
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(hiringService.createRequisition(companyId, request)));
    }

    @Operation(summary = "List job requisitions")
    @GetMapping("/requisitions")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public ResponseEntity<PageResponse<JobRequisitionResponse>> listRequisitions(
            @RequestParam(required = false) UUID companyId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(hiringService.getRequisitions(companyId, pageable)));
    }

    @Operation(summary = "Get a single job requisition")
    @GetMapping("/requisitions/{id}")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public ResponseEntity<JobRequisitionResponse> getRequisition(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(hiringService.getRequisition(id)));
    }

    @Operation(summary = "Update a job requisition")
    @PutMapping("/requisitions/{id}")
    @PreAuthorize("hasAuthority('hrms.hiring.write')")
    public ResponseEntity<JobRequisitionResponse> updateRequisition(
            @PathVariable UUID id,
            @Valid @RequestBody JobRequisitionRequest request) {
        return ResponseEntity.ok(enrichOne(hiringService.updateRequisition(id, request)));
    }

    @Operation(summary = "Close a job requisition")
    @PostMapping("/requisitions/{id}/close")
    @PreAuthorize("hasAuthority('hrms.hiring.write')")
    public ResponseEntity<JobRequisitionResponse> closeRequisition(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(hiringService.closeRequisition(id)));
    }

    // ─── Candidates ──────────────────────────────────────────────────────────

    @Operation(summary = "Add a candidate to a requisition")
    @PostMapping("/requisitions/{id}/candidates")
    @PreAuthorize("hasAuthority('hrms.hiring.candidate.write')")
    public ResponseEntity<CandidateResponse> addCandidate(
            @PathVariable UUID id,
            @Valid @RequestBody CandidateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(hiringService.addCandidate(id, request));
    }

    @Operation(summary = "List candidates for a requisition")
    @GetMapping("/requisitions/{id}/candidates")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public ResponseEntity<List<CandidateResponse>> listCandidates(@PathVariable UUID id) {
        return ResponseEntity.ok(hiringService.getCandidates(id));
    }

    @Operation(summary = "Advance a candidate to a new pipeline stage")
    @PutMapping("/candidates/{id}/stage")
    @PreAuthorize("hasAuthority('hrms.hiring.candidate.write')")
    public ResponseEntity<CandidateResponse> updateStage(
            @PathVariable UUID id,
            @Valid @RequestBody CandidateStageRequest request) {
        return ResponseEntity.ok(hiringService.updateStage(id, request));
    }

    // ─── Hiring-manager identity enrichment ──────────────────────────────────
    // The hiring module has no dependency on hrms-employee, so the hiring
    // manager's name is resolved here (the API layer) and folded into the
    // response so requisition cards can show WHO owns the opening.

    private PageResponse<JobRequisitionResponse> enrichPage(PageResponse<JobRequisitionResponse> page) {
        List<UUID> managerIds = page.content().stream()
                .map(JobRequisitionResponse::hiringManagerId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = managerIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(managerIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<JobRequisitionResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.hiringManagerId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private JobRequisitionResponse enrichOne(JobRequisitionResponse r) {
        Employee employee = r.hiringManagerId() == null
                ? null
                : employeeRepository.findById(r.hiringManagerId()).orElse(null);
        return enrich(r, employee);
    }

    private JobRequisitionResponse enrich(JobRequisitionResponse r, Employee employee) {
        String managerName = employee != null
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        return new JobRequisitionResponse(
                r.id(), r.companyId(), r.title(), r.departmentId(), r.openings(),
                r.status(), r.employmentType(), r.location(), r.description(),
                r.hiringManagerId(), managerName, r.candidateCount(), r.createdAt());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
