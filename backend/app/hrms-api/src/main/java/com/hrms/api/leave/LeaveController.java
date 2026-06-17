package com.hrms.api.leave;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.leave.dto.LeaveApprovalRequest;
import com.hrms.leave.dto.LeaveBalanceResponse;
import com.hrms.leave.dto.LeaveOverviewResponse;
import com.hrms.leave.dto.LeaveRequestRequest;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.dto.LeaveTypeRequest;
import com.hrms.leave.dto.LeaveTypeResponse;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
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

@RestController
@RequestMapping("/v1/leave")
@Tag(name = "Leave", description = "Leave applications, approvals, balances, and policies")
@SecurityRequirement(name = "bearerAuth")
public class LeaveController {

    private final LeaveService leaveService;
    private final LeaveTypeService leaveTypeService;
    private final EmployeeRepository employeeRepository;
    private final WorkforceDepartmentRepository departmentRepository;
    private final ApproverFallbackResolver approverFallbackResolver;

    public LeaveController(LeaveService leaveService,
                           LeaveTypeService leaveTypeService,
                           EmployeeRepository employeeRepository,
                           WorkforceDepartmentRepository departmentRepository,
                           ApproverFallbackResolver approverFallbackResolver) {
        this.leaveService = leaveService;
        this.leaveTypeService = leaveTypeService;
        this.employeeRepository = employeeRepository;
        this.departmentRepository = departmentRepository;
        this.approverFallbackResolver = approverFallbackResolver;
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "Apply for leave")
    @PostMapping("/apply")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<LeaveRequestResponse> apply(
            @Valid @RequestBody LeaveRequestRequest request,
            @RequestParam(required = false) UUID companyId,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        // Approver resolution chain (audit P0-1). The approval queue filters by
        // approver_id, so a null approver makes the request invisible to everyone —
        // the worst customer-facing bug on a fresh tenant. Resolve in order and
        // NEVER persist null:
        //   L1: the employee's explicit reporting manager
        //   L2: the employee's department head (resolved live, so a head set AFTER
        //       the employee was created still routes correctly)
        //   L3: any active HR_MANAGER in the tenant   ┐ terminal fallback so a tenant
        //   L4: any active SUPER_ADMIN in the tenant   ┘ that hasn't set up org structure
        //       still routes leave somewhere a human will see it
        // If even L4 fails, fail loudly at apply time so HR fixes the org structure
        // rather than the request silently rotting.
        UUID approverId = employee.getManagerId();
        if (approverId == null && employee.getDepartmentId() != null) {
            approverId = departmentRepository.findById(employee.getDepartmentId())
                    .map(com.hrms.employee.workforce.entity.Department::getDepartmentHeadEmployeeId)
                    .orElse(null);
        }
        if (approverId == null) {
            approverId = approverFallbackResolver.resolveTerminalApprover(employee.getTenantId())
                    .orElseThrow(() -> new BusinessRuleException(
                            "No approver available — assign this employee a reporting manager, set a "
                                    + "department head, or add an HR manager before applying for leave",
                            "NO_APPROVER_AVAILABLE"));
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(leaveService.applyLeave(
                        employeeId,
                        companyId != null ? companyId : employee.getCompanyId(),
                        request,
                        approverId));
    }

    @Operation(summary = "Mobile leave overview - balances, recent requests, and approval count")
    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<LeaveOverviewResponse> overview(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        UUID employeeId = extractEmployeeId(jwt);
        ensureBalancesForEmployee(employeeId, year);
        List<LeaveBalanceResponse> balances = leaveService.getMyBalances(employeeId, year);
        PageResponse<LeaveRequestResponse> recent = leaveService.getMyLeaves(employeeId, Pageable.ofSize(5));
        long pendingApprovals = leaveService
                .getPendingApprovalsForManager(employeeId, Pageable.ofSize(1))
                .totalElements();
        return ResponseEntity.ok(new LeaveOverviewResponse(balances, recent.content(), pendingApprovals));
    }

    @Operation(summary = "Get my leave requests")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> myLeaves(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(leaveService.getMyLeaves(extractEmployeeId(jwt), pageable));
    }

    @Operation(summary = "Get my leave balances for a given year")
    @GetMapping("/my/balances")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<List<LeaveBalanceResponse>> myBalances(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        UUID employeeId = extractEmployeeId(jwt);
        ensureBalancesForEmployee(employeeId, year);
        return ResponseEntity.ok(leaveService.getMyBalances(employeeId, year));
    }

    /**
     * Read-time lazy creation of leave_balances rows. Without this, a freshly
     * onboarded employee whose hire-time init step never ran sees an empty
     * "Apply for Leave" screen ("No allocations yet") and cannot apply at all —
     * the mobile UI has no way to select a leave type when balances is [].
     * Idempotent: initLeaveBalances checks for existing rows per type before
     * inserting. Swallows exceptions so a transient init failure cannot 500 the
     * read; the worst case is the screen renders empty, same as the old code.
     */
    private void ensureBalancesForEmployee(UUID employeeId, int year) {
        try {
            employeeRepository.findById(employeeId).ifPresent(e -> {
                if (e.getCompanyId() != null && e.getTenantId() != null) {
                    leaveService.initLeaveBalances(employeeId, e.getCompanyId(), e.getTenantId(), year);
                }
            });
        } catch (Exception ex) {
            // Best-effort init; never break the read path.
        }
    }

    @Operation(summary = "Cancel a leave request")
    @PostMapping("/{requestId}/cancel")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<Void> cancel(
            @PathVariable UUID requestId,
            @RequestParam String reason,
            @AuthenticationPrincipal Jwt jwt) {
        leaveService.cancelLeave(requestId, extractEmployeeId(jwt), reason);
        return ResponseEntity.noContent().build();
    }

    // ─── L1 Manager approval ────────────────────────────────────────────────

    @Operation(summary = "Get pending L1 leave approvals for the current manager")
    @GetMapping("/approvals/pending")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> pendingApprovals(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(
                leaveService.getPendingApprovalsForManager(extractEmployeeId(jwt), pageable)));
    }

    @Operation(summary = "L1 manager approval — approve escalates to HR, reject closes")
    @PostMapping("/{requestId}/l1-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveRequestResponse> decideL1(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(leaveService.approveL1(requestId, extractEmployeeId(jwt), approval)));
    }

    // ─── L2 HR approval ─────────────────────────────────────────────────────

    @Operation(summary = "Get leave requests awaiting L2 HR approval")
    @GetMapping("/approvals/pending-l2")
    @PreAuthorize("@perm.check('hrms.leave.approve.l2')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> pendingL2Approvals(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(leaveService.getPendingL2Approvals(pageable)));
    }

    @Operation(summary = "L2 HR final approval or rejection")
    @PostMapping("/{requestId}/l2-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l2')")
    public ResponseEntity<LeaveRequestResponse> decideL2(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(leaveService.approveL2(requestId, extractEmployeeId(jwt), approval)));
    }

    @Operation(summary = "Approve or reject a leave request (legacy single-step)")
    @PostMapping("/{requestId}/decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveRequestResponse> decide(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(enrichOne(leaveService.approveLeave(requestId, extractEmployeeId(jwt), approval)));
    }

    // ─── Leave type admin ────────────────────────────────────────────────────

    @Operation(summary = "Create a leave type for a company")
    @PostMapping("/types")
    @PreAuthorize("hasAuthority('leave.type.write')")
    public ResponseEntity<LeaveTypeResponse> createType(
            @Valid @RequestBody LeaveTypeRequest request,
            @RequestParam UUID companyId) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(leaveTypeService.createLeaveType(companyId, request));
    }

    @Operation(summary = "List leave types for a company")
    @GetMapping("/types")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<LeaveTypeResponse>> listTypes(@RequestParam UUID companyId) {
        return ResponseEntity.ok(leaveTypeService.listLeaveTypes(companyId));
    }

    @Operation(summary = "Update a leave type")
    @PutMapping("/types/{id}")
    @PreAuthorize("hasAuthority('leave.type.write')")
    public ResponseEntity<LeaveTypeResponse> updateType(
            @PathVariable UUID id,
            @Valid @RequestBody LeaveTypeRequest request) {
        return ResponseEntity.ok(leaveTypeService.updateLeaveType(id, request));
    }

    @Operation(summary = "Deactivate (soft-delete) a leave type")
    @DeleteMapping("/types/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('leave.type.write')")
    public void deactivateType(@PathVariable UUID id) {
        leaveTypeService.deactivateLeaveType(id);
    }

    // ─── Requester identity enrichment ───────────────────────────────────────
    // The leave module has no dependency on hrms-employee, so the requester's
    // name / code / department are resolved here (the API layer) and folded into
    // the response DTO so manager/admin approval cards can show WHOSE request it is.

    private PageResponse<LeaveRequestResponse> enrichPage(PageResponse<LeaveRequestResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(LeaveRequestResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        Map<UUID, String> departmentNames = departmentNames(employeeMap.values());
        List<LeaveRequestResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId()), departmentNames))
                .toList();
        return new PageResponse<>(
                enriched, page.page(), page.size(), page.totalElements(), page.totalPages(), page.last());
    }

    private LeaveRequestResponse enrichOne(LeaveRequestResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        Map<UUID, String> departmentNames = employee != null
                ? departmentNames(List.of(employee))
                : Map.of();
        return enrich(r, employee, departmentNames);
    }

    private LeaveRequestResponse enrich(LeaveRequestResponse r,
                                        Employee employee,
                                        Map<UUID, String> departmentNames) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String departmentName = employee != null && employee.getDepartmentId() != null
                ? departmentNames.get(employee.getDepartmentId())
                : null;
        return new LeaveRequestResponse(
                r.id(),
                r.employeeId(),
                employeeName,
                employeeCode,
                departmentName,
                r.leaveTypeId(),
                r.leaveTypeName(),
                r.startDate(),
                r.endDate(),
                r.totalDays(),
                r.reason(),
                r.status(),
                r.approverComment(),
                r.approvedAt(),
                r.createdAt());
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

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

}
