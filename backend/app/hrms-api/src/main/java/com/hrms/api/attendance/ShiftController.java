package com.hrms.api.attendance;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.EmployeeShiftResponse;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftPolicyResponse;
import com.hrms.attendance.service.EmployeeShiftService;
import com.hrms.attendance.service.ShiftChangeRequestService;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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

    public ShiftController(EmployeeShiftService shiftService,
                           ShiftChangeRequestService changeRequestService) {
        this.shiftService = shiftService;
        this.changeRequestService = changeRequestService;
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
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<ShiftPolicyResponse> create(@RequestParam("companyId") UUID companyId,
                                                       @RequestBody ShiftPolicyRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(shiftService.createShift(companyId, req));
    }

    @Operation(summary = "Update a shift definition")
    @PutMapping("/{shiftId}")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<ShiftPolicyResponse> update(@PathVariable UUID shiftId,
                                                      @RequestBody ShiftPolicyRequest req) {
        return ResponseEntity.ok(shiftService.updateShift(shiftId, req));
    }

    @Operation(summary = "Get an employee's current shift")
    @GetMapping("/employee/{employeeId}")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<EmployeeShiftResponse> current(@PathVariable UUID employeeId) {
        return ResponseEntity.ok(shiftService.getCurrentShift(employeeId));
    }

    @Operation(summary = "Assign (or reassign) an employee to a shift")
    @PostMapping("/employee/{employeeId}")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
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
    public ResponseEntity<List<ShiftChangeRequestResponse>> pendingChangeRequests() {
        return ResponseEntity.ok(changeRequestService.listPending());
    }

    @Operation(summary = "Approve or reject a shift-change request (HR/manager)")
    @PostMapping("/change-requests/{requestId}/decision")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<ShiftChangeRequestResponse> decideChange(@AuthenticationPrincipal Jwt jwt,
                                                                   @PathVariable UUID requestId,
                                                                   @RequestBody ShiftChangeDecisionRequest decision) {
        return ResponseEntity.ok(changeRequestService.decide(requestId, employeeId(jwt), decision));
    }
}
