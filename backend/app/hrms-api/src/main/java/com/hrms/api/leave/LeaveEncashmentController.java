package com.hrms.api.leave;

import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentCreateRequest;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentDecisionRequest;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentOption;
import com.hrms.leave.dto.LeaveAccrualDtos.EncashmentResponse;
import com.hrms.leave.dto.LeaveAccrualDtos.PayableEncashment;
import com.hrms.leave.service.LeaveEncashmentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Leave encashment (V143.23). Employees ask for their own
 * ({@code leave.request.self}, the same permission as applying for leave);
 * HR sees everyone's, raises one for an employee and decides
 * ({@code hrms.leave.encash.approve}). Approved days are paid as an earning by
 * the next payroll run (LeaveEncashmentService payroll hook).
 */
@RestController
@RequestMapping("/v1/leave/encashments")
@Tag(name = "Leave encashment", description = "Cash in unused leave, with HR approval")
@SecurityRequirement(name = "bearerAuth")
public class LeaveEncashmentController {

    private final LeaveEncashmentService encashments;

    public LeaveEncashmentController(LeaveEncashmentService encashments) {
        this.encashments = encashments;
    }

    // ── Employee ─────────────────────────────────────────────────────────────

    @Operation(summary = "What I can encash this year, per encashable leave type")
    @GetMapping("/my/options")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<List<EncashmentOption>> myOptions(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(encashments.options(LeaveYearEndController.employeeId(jwt)));
    }

    @Operation(summary = "My encashment requests")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<List<EncashmentResponse>> mine(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(encashments.listMine(LeaveYearEndController.employeeId(jwt)));
    }

    @Operation(summary = "Ask to encash unused days (held from the balance until decided)")
    @PostMapping
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<EncashmentResponse> create(@AuthenticationPrincipal Jwt jwt,
                                                     @RequestBody EncashmentCreateRequest request) {
        UUID me = LeaveYearEndController.employeeId(jwt);
        return ResponseEntity.status(HttpStatus.CREATED).body(encashments.create(me, request, me, false));
    }

    @Operation(summary = "Cancel my request that hasn't been decided; the days go back")
    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('leave.request.self')")
    public ResponseEntity<EncashmentResponse> cancel(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(encashments.cancel(id, LeaveYearEndController.employeeId(jwt)));
    }

    // ── HR ───────────────────────────────────────────────────────────────────

    @Operation(summary = "Encashment requests: status=PENDING (default) or DECIDED")
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.leave.encash.approve')")
    public ResponseEntity<List<EncashmentResponse>> list(@RequestParam(defaultValue = "PENDING") String status,
                                                         @RequestParam(defaultValue = "200") int limit) {
        return ResponseEntity.ok(encashments.list(!"DECIDED".equalsIgnoreCase(status), limit));
    }

    @Operation(summary = "What an employee can encash this year")
    @GetMapping("/options/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.leave.encash.approve')")
    public ResponseEntity<List<EncashmentOption>> options(@PathVariable UUID employeeId) {
        return ResponseEntity.ok(encashments.options(employeeId));
    }

    @Operation(summary = "Raise an encashment for an employee (still needs a decision)")
    @PostMapping("/for/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.leave.encash.approve')")
    public ResponseEntity<EncashmentResponse> createFor(@PathVariable UUID employeeId,
                                                        @RequestBody EncashmentCreateRequest request,
                                                        @AuthenticationPrincipal Jwt jwt) {
        UUID me = LeaveYearEndController.employeeId(jwt);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(encashments.create(employeeId, request, me, !employeeId.equals(me)));
    }

    @Operation(summary = "Approve or reject an encashment (not your own)")
    @PostMapping("/{id}/decision")
    @PreAuthorize("hasAuthority('hrms.leave.encash.approve')")
    public ResponseEntity<EncashmentResponse> decide(@PathVariable UUID id,
                                                     @RequestBody EncashmentDecisionRequest decision,
                                                     @AuthenticationPrincipal Jwt jwt) {
        // An empty body must not quietly reject the request: the decision is required.
        if (decision == null || decision.approved() == null) {
            throw new com.hrms.core.exception.BusinessRuleException("Say whether the encashment is approved.", "ENCASH_DECISION_REQUIRED");
        }
        return ResponseEntity.ok(encashments.decide(id, LeaveYearEndController.employeeId(jwt),
                decision.approved(), decision.note()));
    }

    @Operation(summary = "Approved encashments waiting for the next payroll run")
    @GetMapping("/payable")
    @PreAuthorize("hasAnyAuthority('hrms.leave.encash.approve','payroll.runs.manage')")
    public ResponseEntity<List<PayableEncashment>> payable(@RequestParam List<UUID> employeeIds) {
        return ResponseEntity.ok(encashments.payableFor(employeeIds));
    }
}
