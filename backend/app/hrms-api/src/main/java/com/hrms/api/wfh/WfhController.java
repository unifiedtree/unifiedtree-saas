package com.hrms.api.wfh;

import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.dto.WfhDecisionRequest;
import com.hrms.leave.dto.WfhRequestRequest;
import com.hrms.leave.dto.WfhRequestResponse;
import com.hrms.leave.service.WfhService;
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

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST endpoints for the Work From Home request/approve flow. Structure and
 * approver-resolution chain mirror {@link com.hrms.api.leave.LeaveController}
 * 1:1 so behaviour stays predictable across the two request types (leave and
 * WFH show up side-by-side in the mobile Requests screen).
 */
@RestController
@RequestMapping("/v1/wfh")
@Tag(name = "WFH", description = "Work From Home applications and approvals")
@SecurityRequirement(name = "bearerAuth")
public class WfhController {

    private final WfhService service;
    private final EmployeeRepository employeeRepository;
    private final WorkforceDepartmentRepository departmentRepository;
    private final ApproverFallbackResolver approverFallbackResolver;

    public WfhController(WfhService service,
                         EmployeeRepository employeeRepository,
                         WorkforceDepartmentRepository departmentRepository,
                         ApproverFallbackResolver approverFallbackResolver) {
        this.service = service;
        this.employeeRepository = employeeRepository;
        this.departmentRepository = departmentRepository;
        this.approverFallbackResolver = approverFallbackResolver;
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Apply for Work From Home")
    @PostMapping
    @PreAuthorize("hasAuthority('wfh.request.self')")
    public ResponseEntity<WfhRequestResponse> apply(
            @Valid @RequestBody WfhRequestRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new ResourceNotFoundException("Employee", employeeId));

        // Approver resolution — identical chain to LeaveController.apply so the
        // two request types route the same way. See audit P0-1: never persist
        // a null approver, otherwise a fresh tenant's WFH request is invisible
        // to every approval queue.
        UUID approverId = employee.getManagerId();
        if (approverId == null && employee.getDepartmentId() != null) {
            approverId = departmentRepository.findById(employee.getDepartmentId())
                    .map(Department::getDepartmentHeadEmployeeId)
                    .orElse(null);
        }
        if (approverId == null) {
            approverId = approverFallbackResolver.resolveTerminalApprover(employee.getTenantId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "No approver available — assign this employee a reporting manager, set a "
                                    + "department head, or add an HR manager before applying for WFH",
                            "NO_APPROVER_AVAILABLE"));
        }
        // Validate the resolved approver is a real, active, same-tenant employee.
        Employee resolvedApprover = employeeRepository.findById(approverId).orElse(null);
        if (!isValidApprover(resolvedApprover, employee)) {
            approverId = approverFallbackResolver.resolveTerminalApprover(employee.getTenantId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "Resolved approver is not a valid active employee in this tenant; "
                                    + "assign a reporting manager or department head before applying.",
                            "APPROVER_INVALID"));
            resolvedApprover = employeeRepository.findById(approverId).orElse(null);
            if (!isValidApprover(resolvedApprover, employee)) {
                throw new BusinessRuleException(
                        "No valid active approver could be resolved for this employee; "
                                + "please contact HR to set up the approval chain.",
                        "APPROVER_INVALID");
            }
        }

        WfhRequestResponse created = service.apply(employeeId, request, approverId);
        return ResponseEntity.status(HttpStatus.CREATED).body(enrichOne(created));
    }

    @Operation(summary = "Get my WFH requests")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('wfh.request.self')")
    public ResponseEntity<PageResponse<WfhRequestResponse>> myRequests(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(service.getMyRequests(extractEmployeeId(jwt), pageable)));
    }

    @Operation(summary = "Cancel a WFH request")
    @PostMapping("/{requestId}/cancel")
    @PreAuthorize("hasAuthority('wfh.request.self')")
    public ResponseEntity<Void> cancel(
            @PathVariable UUID requestId,
            @AuthenticationPrincipal Jwt jwt) {
        service.cancel(requestId, extractEmployeeId(jwt));
        return ResponseEntity.noContent().build();
    }

    // ─── Manager approval ────────────────────────────────────────────────────

    @Operation(summary = "Pending WFH approvals — broadens to tenant-wide if caller is admin/HR (has leave.approve.l2)")
    @GetMapping("/pending-approvals")
    @PreAuthorize("hasAuthority('wfh.approve')")
    public ResponseEntity<PageResponse<WfhRequestResponse>> pendingApprovals(
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth,
            @PageableDefault(size = 20) Pageable pageable) {
        boolean adminOrHr = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> "hrms.leave.approve.l2".equals(a.getAuthority()));
        PageResponse<WfhRequestResponse> page = adminOrHr
                ? service.getAllPending(pageable)
                : service.getPendingApprovalsForManager(extractEmployeeId(jwt), pageable);
        return ResponseEntity.ok(enrichPage(page));
    }

    @Operation(summary = "Approve a WFH request")
    @PostMapping("/{requestId}/approve")
    @PreAuthorize("hasAuthority('wfh.approve')")
    public ResponseEntity<WfhRequestResponse> approve(
            @PathVariable UUID requestId,
            @RequestBody(required = false) @Valid WfhDecisionRequest body,
            @AuthenticationPrincipal Jwt jwt) {
        String comment = body != null ? body.comment() : null;
        return ResponseEntity.ok(enrichOne(
                service.decide(requestId, extractEmployeeId(jwt), ApprovalStatus.APPROVED, comment)));
    }

    @Operation(summary = "Reject a WFH request")
    @PostMapping("/{requestId}/reject")
    @PreAuthorize("hasAuthority('wfh.approve')")
    public ResponseEntity<WfhRequestResponse> reject(
            @PathVariable UUID requestId,
            @RequestBody(required = false) @Valid WfhDecisionRequest body,
            @AuthenticationPrincipal Jwt jwt) {
        // Rejection reason is UX-mandatory — the mobile Reject modal forces the
        // approver to type one before the button enables. Enforce it here too so
        // an API caller can't reject with no explanation.
        String comment = body != null ? body.comment() : null;
        if (comment == null || comment.isBlank()) {
            throw new BusinessRuleException(
                    "A rejection reason is required.", "WFH_REJECT_REASON_REQUIRED");
        }
        return ResponseEntity.ok(enrichOne(
                service.decide(requestId, extractEmployeeId(jwt), ApprovalStatus.REJECTED, comment)));
    }

    // ─── Requester identity enrichment ───────────────────────────────────────
    // Copy of LeaveController's enrichment: the leave module has no dependency
    // on hrms-employee, so the requester's name/code/department are resolved
    // here at the API layer and folded into the response DTO.

    private PageResponse<WfhRequestResponse> enrichPage(PageResponse<WfhRequestResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(WfhRequestResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Map<UUID, String> departmentNames = departmentNames(employeeMap.values());
        List<WfhRequestResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId()), departmentNames))
                .toList();
        return new PageResponse<>(
                enriched, page.page(), page.size(), page.totalElements(), page.totalPages(), page.last());
    }

    private WfhRequestResponse enrichOne(WfhRequestResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        Map<UUID, String> departmentNames = employee != null
                ? departmentNames(List.of(employee))
                : Map.of();
        return enrich(r, employee, departmentNames);
    }

    private WfhRequestResponse enrich(WfhRequestResponse r,
                                      Employee employee,
                                      Map<UUID, String> departmentNames) {
        String employeeName = employee != null
                ? (safe(employee.getFirstName()) + " " + safe(employee.getLastName())).trim()
                : null;
        if (employeeName != null && employeeName.isBlank()) employeeName = null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String departmentName = employee != null && employee.getDepartmentId() != null
                ? departmentNames.get(employee.getDepartmentId())
                : null;
        return new WfhRequestResponse(
                r.id(),
                r.employeeId(),
                employeeName,
                employeeCode,
                departmentName,
                r.fromDate(),
                r.toDate(),
                r.reason(),
                r.status(),
                r.approverId(),
                r.decisionNote(),
                r.decidedAt(),
                r.createdAt());
    }

    private static String safe(String s) {
        return s == null ? "" : s.trim();
    }

    private Map<UUID, String> departmentNames(java.util.Collection<Employee> employees) {
        List<UUID> departmentIds = employees.stream()
                .map(Employee::getDepartmentId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (departmentIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        departmentRepository.findAllById(departmentIds)
                .forEach(department -> names.put(department.getId(), department.getName()));
        return names;
    }

    /**
     * Same predicate as LeaveController.isValidApprover — a resolved approver
     * must belong to the same tenant as the applicant and must not be in a
     * terminal / inactive employment state.
     */
    private boolean isValidApprover(Employee approver, Employee applicant) {
        if (approver == null || applicant == null) return false;
        if (approver.getTenantId() == null || !approver.getTenantId().equals(applicant.getTenantId())) {
            return false;
        }
        EmploymentStatus status = approver.getEmploymentStatus();
        if (status == null) return true; // legacy rows: assume active
        switch (status) {
            case EXITED:
            case TERMINATED:
            case RESIGNED:
            case RETIRED:
            case SUSPENDED:
                return false;
            default:
                return true;
        }
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
