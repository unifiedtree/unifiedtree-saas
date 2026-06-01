package com.hrms.api.leave;

import com.hrms.core.dto.PageResponse;
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
import java.util.UUID;

@RestController
@RequestMapping("/v1/leave")
@Tag(name = "Leave", description = "Leave applications, approvals, balances, and policies")
@SecurityRequirement(name = "bearerAuth")
public class LeaveController {

    private final LeaveService leaveService;
    private final LeaveTypeService leaveTypeService;
    private final EmployeeRepository employeeRepository;

    public LeaveController(LeaveService leaveService,
                           LeaveTypeService leaveTypeService,
                           EmployeeRepository employeeRepository) {
        this.leaveService = leaveService;
        this.leaveTypeService = leaveTypeService;
        this.employeeRepository = employeeRepository;
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
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(leaveService.applyLeave(
                        employeeId,
                        companyId != null ? companyId : employee.getCompanyId(),
                        request,
                        employee.getManagerId()));
    }

    @Operation(summary = "Mobile leave overview - balances, recent requests, and approval count")
    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<LeaveOverviewResponse> overview(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "#{T(java.time.Year).now().value}") int year) {
        UUID employeeId = extractEmployeeId(jwt);
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
        return ResponseEntity.ok(leaveService.getMyBalances(extractEmployeeId(jwt), year));
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
        return ResponseEntity.ok(leaveService.getPendingApprovalsForManager(extractEmployeeId(jwt), pageable));
    }

    @Operation(summary = "L1 manager approval — approve escalates to HR, reject closes")
    @PostMapping("/{requestId}/l1-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveRequestResponse> decideL1(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(leaveService.approveL1(requestId, extractEmployeeId(jwt), approval));
    }

    // ─── L2 HR approval ─────────────────────────────────────────────────────

    @Operation(summary = "Get leave requests awaiting L2 HR approval")
    @GetMapping("/approvals/pending-l2")
    @PreAuthorize("@perm.check('hrms.leave.approve.l2')")
    public ResponseEntity<PageResponse<LeaveRequestResponse>> pendingL2Approvals(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(leaveService.getPendingL2Approvals(pageable));
    }

    @Operation(summary = "L2 HR final approval or rejection")
    @PostMapping("/{requestId}/l2-decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l2')")
    public ResponseEntity<LeaveRequestResponse> decideL2(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(leaveService.approveL2(requestId, extractEmployeeId(jwt), approval));
    }

    @Operation(summary = "Approve or reject a leave request (legacy single-step)")
    @PostMapping("/{requestId}/decision")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveRequestResponse> decide(
            @PathVariable UUID requestId,
            @Valid @RequestBody LeaveApprovalRequest approval,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(leaveService.approveLeave(requestId, extractEmployeeId(jwt), approval));
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

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

}
