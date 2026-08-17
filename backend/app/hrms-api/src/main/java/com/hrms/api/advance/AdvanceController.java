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
    private final AdvanceRecoveryService advanceRecoveryService;
    private final com.hrms.api.leave.ApproverFallbackResolver approverFallback;

    public AdvanceController(AdvanceService advanceService,
                            EmployeeRepository employeeRepository,
                            AdvanceRecoveryService advanceRecoveryService,
                            com.hrms.api.leave.ApproverFallbackResolver approverFallback) {
        this.advanceService = advanceService;
        this.employeeRepository = employeeRepository;
        this.advanceRecoveryService = advanceRecoveryService;
        this.approverFallback = approverFallback;
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
        // B3 FIX (audit 2026-08-15): reject an advance request whose approver
        // would be null (no manager configured) OR self (manager==requester —
        // the direct-manager pointer is stale). Fall back to a terminal
        // approver (HR/SUPER_ADMIN) so the request routes to a real inbox
        // instead of a dead-lettered null. If even that resolves to self,
        // reject cleanly with a 400 — never let an employee self-approve.
        if (approverId == null || approverId.equals(employeeId)) {
            UUID fallback = approverFallback.resolveTerminalApprover(
                    com.hrms.core.tenant.TenantContext.getTenantId()).orElse(null);
            if (fallback == null || fallback.equals(employeeId)) {
                throw new com.hrms.core.exception.BusinessRuleException(
                        "No eligible approver found for this workspace. "
                        + "Ask your admin to configure a reporting manager or HR before raising an advance.",
                        "ADVANCE_NO_APPROVER");
            }
            approverId = fallback;
        }
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
    public ResponseEntity<AdvanceResponse> getRequest(@PathVariable UUID id,
                                                      @AuthenticationPrincipal Jwt jwt) {
        AdvanceResponse adv = enrichOne(advanceService.getRequest(id));
        // Object-level authz (prevent intra-tenant IDOR): self-permission callers may
        // read ONLY their own request; the admin read permission may read any.
        if (!callerHasPermission(jwt, "hrms.advance.read")
                && !java.util.Objects.equals(adv.employeeId(), extractEmployeeId(jwt))) {
            throw new org.springframework.security.access.AccessDeniedException("Not permitted to view this advance request");
        }
        return ResponseEntity.ok(adv);
    }

    private boolean callerHasPermission(Jwt jwt, String permission) {
        java.util.List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains(permission);
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
        UUID approver = extractEmployeeId(jwt);
        // B3 FIX (audit 2026-08-15): self-approval guard. An employee whose
        // reporting_manager_id is themselves (or who forges the approver on the
        // way in) could approve their own advance and skip to disbursement.
        AdvanceResponse existing = advanceService.getRequest(id);
        if (approver != null && approver.equals(existing.employeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You cannot approve your own advance request.");
        }
        return ResponseEntity.ok(enrichOne(advanceService.decide(id, approver, decision)));
    }

    // ─── Disbursement (finance) ──────────────────────────────────────────────

    @Operation(summary = "Mark an approved advance as disbursed")
    @PostMapping("/requests/{id}/disburse")
    @PreAuthorize("@perm.check('hrms.advance.disburse')")
    public ResponseEntity<AdvanceResponse> disburse(@PathVariable UUID id,
                                                    @AuthenticationPrincipal Jwt jwt) {
        // B3 FIX (audit 2026-08-15): disburser must not equal the requester.
        AdvanceResponse existing = advanceService.getRequest(id);
        UUID caller = jwt == null ? null : extractEmployeeId(jwt);
        if (caller != null && caller.equals(existing.employeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You cannot disburse your own advance.");
        }
        AdvanceResponse result = advanceService.disburse(id);
        // B3 CRIT FIX (audit 2026-08-15): AdvanceService.disburse never seeded
        // the recovery schedule, so every disbursed advance stayed outstanding
        // forever — payroll never had a PENDING installment to consume. Seed
        // it here starting the month AFTER disbursement (first payroll cycle
        // that runs post-disbursement will pick up installment #1).
        try {
            java.time.LocalDate startMonth = java.time.LocalDate.now().plusMonths(1);
            advanceRecoveryService.initSchedule(
                    com.hrms.core.tenant.TenantContext.getTenantId(),
                    id, startMonth.getMonthValue(), startMonth.getYear());
        } catch (RuntimeException e) {
            // Do NOT fail the disburse response — the finance team already
            // clicked the button, the advance is disbursed. Log loud so ops
            // can seed manually via /v1/advance-recovery/{id}/init.
            org.slf4j.LoggerFactory.getLogger(AdvanceController.class).error(
                    "initSchedule failed for advance {} — MUST SEED MANUALLY: {}", id, e.getMessage());
        }
        return ResponseEntity.ok(enrichOne(result));
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
                ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim()
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
