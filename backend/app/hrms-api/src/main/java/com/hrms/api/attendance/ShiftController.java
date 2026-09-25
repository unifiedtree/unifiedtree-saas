package com.hrms.api.attendance;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.EmployeeShiftResponse;
import com.hrms.attendance.dto.ShiftDtos.ShiftAssignmentHistoryItem;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyResponse;
import com.hrms.attendance.service.EmployeeShiftService;
import com.hrms.attendance.service.ShiftChangeRequestService;
import com.hrms.attendance.service.ShiftHistoryService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Shift-timings management.
 *
 * <p>Reads are open to any authenticated user ({@code attendance.checkin.self})
 * so the onboarding picker + profile can list/show shifts. Mutations (create a
 * shift, assign a shift to an employee) require the same authority HR/admins use
 * for attendance regularization ({@code attendance.regularization.approve}).
 */
@RestController
@RequestMapping("/v1/shifts")
public class ShiftController {

    private final EmployeeShiftService shiftService;
    private final ShiftChangeRequestService changeRequestService;
    private final TeamEmployeeScope teamScope;
    private final ShiftHistoryService historyService;

    public ShiftController(EmployeeShiftService shiftService,
                           ShiftChangeRequestService changeRequestService,
                           TeamEmployeeScope teamScope,
                           ShiftHistoryService historyService) {
        this.shiftService = shiftService;
        this.changeRequestService = changeRequestService;
        this.teamScope = teamScope;
        this.historyService = historyService;
    }

    /**
     * Whose shift requests this approver may see and decide: HR/admin the whole
     * company (null = no filter), a manager their team — the rule attendance
     * correction approvals use. Every DEPT_MANAGER used to see and decide every
     * request in the company.
     */
    private java.util.Set<UUID> approverScope(Jwt jwt) {
        if (AttendanceController.isAdmin(jwt)) return null;
        try {
            return teamScope.resolve(jwt, null).stream()
                    .map(com.hrms.employee.entity.Employee::getId)
                    .collect(java.util.stream.Collectors.toSet());
        } catch (IllegalArgumentException noEmployeeRecord) {
            return java.util.Set.of();
        }
    }

    private static UUID employeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    @Operation(summary = "List a company's shift definitions (seeds defaults if none exist)")
    @GetMapping
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<List<ShiftPolicyResponse>> list(@RequestParam("companyId") UUID companyId) {
        return ResponseEntity.ok(shiftService.listShifts(companyId));
    }

    @Operation(summary = "Create a shift definition")
    @PostMapping
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public ResponseEntity<ShiftPolicyResponse> create(@RequestParam("companyId") UUID companyId,
                                                       @Valid @RequestBody ShiftPolicyRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(shiftService.createShift(companyId, req));
    }

    @Operation(summary = "Update a shift definition")
    @PutMapping("/{shiftId}")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public ResponseEntity<ShiftPolicyResponse> update(@PathVariable UUID shiftId,
                                                      @Valid @RequestBody ShiftPolicyRequest req) {
        return ResponseEntity.ok(shiftService.updateShift(shiftId, req));
    }

    @Operation(summary = "Soft-delete a shift definition (409 SHIFT_IN_USE if any employee is still assigned)")
    @DeleteMapping("/{shiftId}")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public ResponseEntity<Void> delete(@PathVariable UUID shiftId) {
        shiftService.deleteShift(shiftId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Get an employee's current shift")
    @GetMapping("/employee/{employeeId}")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<EmployeeShiftResponse> current(@AuthenticationPrincipal Jwt jwt,
                                                         @PathVariable UUID employeeId) {
        // Same rule as the history: yourself, your team, or a workforce admin.
        assertCanReadShiftHistory(jwt, employeeId);
        return ResponseEntity.ok(shiftService.getCurrentShift(employeeId));
    }

    @Operation(summary = "An employee's shift history: every assignment, newest first, with who made it and their note")
    @GetMapping("/employee/{employeeId}/history")
    @PreAuthorize("hasAnyAuthority('attendance.workforce.admin','attendance.team.read','attendance.checkin.self')")
    public ResponseEntity<List<ShiftAssignmentHistoryItem>> history(@AuthenticationPrincipal Jwt jwt,
                                                                    @PathVariable UUID employeeId) {
        assertCanReadShiftHistory(jwt, employeeId);
        return ResponseEntity.ok(historyService.history(employeeId));
    }

    /**
     * Whose shift history the caller may read: their own; anyone's with
     * {@code attendance.workforce.admin} (they assign shifts to anyone); else
     * only their team's, by the rule the My team page uses.
     */
    private void assertCanReadShiftHistory(Jwt jwt, UUID target) {
        if (target.equals(employeeId(jwt))) return;
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        boolean workforceAdmin = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> "attendance.workforce.admin".equals(a.getAuthority()));
        if (workforceAdmin) return;
        boolean teamReader = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> "attendance.team.read".equals(a.getAuthority()));
        if (teamReader) {
            try {
                if (teamScope.resolve(jwt, null).stream().anyMatch(e -> target.equals(e.getId()))) return;
            } catch (IllegalArgumentException noEmployeeRecord) {
                // falls through to the refusal
            }
        }
        throw new org.springframework.security.access.AccessDeniedException(
                "You can see the shift history of your own team only.");
    }

    @Operation(summary = "Assign (or reassign) an employee to a shift")
    @PostMapping("/employee/{employeeId}")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public ResponseEntity<EmployeeShiftResponse> assign(@PathVariable UUID employeeId,
                                                        @RequestBody AssignShiftRequest req) {
        return ResponseEntity.ok(shiftService.assignShift(employeeId, req));
    }

    // ── Shift-change requests (employee → HR approve) ────────────────────────

    @Operation(summary = "Request a shift change (employee)")
    @PostMapping("/change-requests")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<ShiftChangeRequestResponse> requestChange(@AuthenticationPrincipal Jwt jwt,
                                                                    @RequestBody CreateShiftChangeRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(changeRequestService.create(employeeId(jwt), req));
    }

    @Operation(summary = "My shift-change requests")
    @GetMapping("/change-requests/my")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<List<ShiftChangeRequestResponse>> myChangeRequests(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(changeRequestService.listMine(employeeId(jwt)));
    }

    @Operation(summary = "Pending shift-change requests (HR/manager)")
    @GetMapping("/change-requests/pending")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<List<ShiftChangeRequestResponse>> pendingChangeRequests(@AuthenticationPrincipal Jwt jwt) {
        java.util.Set<UUID> scope = approverScope(jwt);
        List<ShiftChangeRequestResponse> pending = changeRequestService.listPending();
        return ResponseEntity.ok(scope == null ? pending
                : pending.stream().filter(r -> scope.contains(r.employeeId())).toList());
    }

    @Operation(summary = "Shift-change requests decided in the last N days (HR/manager): who decided, when, and their note")
    @GetMapping("/change-requests/decided")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<List<ShiftChangeRequestResponse>> decidedChangeRequests(@AuthenticationPrincipal Jwt jwt,
                                                                                  @RequestParam(defaultValue = "30") int days) {
        if (days < 1 || days > ShiftChangeRequestService.MAX_DECIDED_DAYS) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "Choose between 1 and " + ShiftChangeRequestService.MAX_DECIDED_DAYS + " days", "SHIFT_CHANGE_RANGE_INVALID");
        }
        java.util.Set<UUID> scope = approverScope(jwt);
        List<ShiftChangeRequestResponse> decided = changeRequestService.listDecided(days);
        return ResponseEntity.ok(scope == null ? decided
                : decided.stream().filter(r -> scope.contains(r.employeeId())).toList());
    }

    @Operation(summary = "Approve or reject a shift-change request (HR/manager)")
    @PostMapping("/change-requests/{requestId}/decision")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<ShiftChangeRequestResponse> decideChange(@AuthenticationPrincipal Jwt jwt,
                                                                   @PathVariable UUID requestId,
                                                                   @RequestBody ShiftChangeDecisionRequest decision) {
        java.util.Set<UUID> scope = approverScope(jwt);
        if (scope != null) {
            UUID requester = changeRequestService.requesterOf(requestId);
            if (requester != null && !scope.contains(requester)) {
                throw new org.springframework.security.access.AccessDeniedException(
                        "This shift change request is not from your team.");
            }
        }
        return ResponseEntity.ok(changeRequestService.decide(requestId, employeeId(jwt), decision));
    }
}
