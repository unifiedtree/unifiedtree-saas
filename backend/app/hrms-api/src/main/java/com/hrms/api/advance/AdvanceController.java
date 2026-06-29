package com.hrms.api.advance;

import com.hrms.advance.dto.AdvanceDecisionRequest;
import com.hrms.advance.dto.AdvanceRequestCreateRequest;
import com.hrms.advance.dto.AdvanceResponse;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.service.AdvanceService;
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
 * Salary advances: employee self-service requests, manager/HR approval, and
 * finance disbursement.
 */
@RestController
@RequestMapping("/v1/advance")
@Tag(name = "Advance", description = "Salary advance requests, approvals, and disbursement")
@SecurityRequirement(name = "bearerAuth")
public class AdvanceController {

    private final AdvanceService advanceService;
    private final EmployeeRepository employeeRepository;

    public AdvanceController(AdvanceService advanceService,
                            EmployeeRepository employeeRepository) {
        this.advanceService = advanceService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Raise a salary advance request")
    @PostMapping("/requests")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<AdvanceResponse> request(
            @Valid @RequestBody AdvanceRequestCreateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        UUID companyId = employee.getCompanyId();
        UUID approverId = employee.getManagerId();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(advanceService.requestAdvance(employeeId, companyId, request, approverId)));
    }

    @Operation(summary = "Get my salary advance requests")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('hrms.advance.request.self')")
    public ResponseEntity<PageResponse<AdvanceResponse>> myRequests(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(advanceService.getMyRequests(extractEmployeeId(jwt), pageable));
    }

    @Operation(summary = "Get a single salary advance request")
    @GetMapping("/requests/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.advance.read','hrms.advance.request.self')")
    public ResponseEntity<AdvanceResponse> getRequest(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(advanceService.getRequest(id)));
    }

    // ─── Approvals (manager / HR) ────────────────────────────────────────────

    @Operation(summary = "List salary advance requests awaiting approval")
    @GetMapping("/requests/approvals")
    @PreAuthorize("@perm.check('hrms.advance.approve')")
    public ResponseEntity<PageResponse<AdvanceResponse>> pendingApprovals(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(advanceService.getByStatus(AdvanceStatus.REQUESTED, pageable)));
    }

    @Operation(summary = "Approve or reject a salary advance request")
    @PostMapping("/requests/{id}/decision")
    @PreAuthorize("@perm.check('hrms.advance.approve')")
    public ResponseEntity<AdvanceResponse> decide(
            @PathVariable UUID id,
            @Valid @RequestBody AdvanceDecisionRequest decision,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(advanceService.decide(id, extractEmployeeId(jwt), decision)));
    }

    // ─── Disbursement (finance) ──────────────────────────────────────────────

    @Operation(summary = "Mark an approved advance as disbursed")
    @PostMapping("/requests/{id}/disburse")
    @PreAuthorize("@perm.check('hrms.advance.disburse')")
    public ResponseEntity<AdvanceResponse> disburse(@PathVariable UUID id) {
        return ResponseEntity.ok(enrichOne(advanceService.disburse(id)));
    }

    // ─── Requester identity enrichment ───────────────────────────────────────
    // The advance module has no dependency on hrms-employee, so the requester's
    // name / code are resolved here (the API layer) and folded into the response
    // so approver/finance cards can show WHOSE advance it is.

    private PageResponse<AdvanceResponse> enrichPage(PageResponse<AdvanceResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(AdvanceResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<AdvanceResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private AdvanceResponse enrichOne(AdvanceResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee);
    }

    private AdvanceResponse enrich(AdvanceResponse r, Employee employee) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new AdvanceResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.amount(), r.reason(), r.repaymentMonths(), r.monthlyDeduction(),
                r.status(), r.approverId(), r.approvedAt(), r.approverComment(),
                r.disbursedAt(), r.outstandingAmount(), r.createdAt());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
