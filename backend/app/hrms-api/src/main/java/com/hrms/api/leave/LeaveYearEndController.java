package com.hrms.api.leave;

import com.hrms.leave.dto.LeaveAccrualDtos.AccrualRunResult;
import com.hrms.leave.dto.LeaveAccrualDtos.CarryForwardPreview;
import com.hrms.leave.dto.LeaveAccrualDtos.CarryForwardResult;
import com.hrms.leave.dto.LeaveAccrualDtos.LedgerEntry;
import com.hrms.leave.service.LeaveAccrualService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Leave accrual, the year-end carry forward and the balance audit trail
 * (V143.23). Both jobs also run on their own every night (LeaveAccrualJob);
 * these endpoints let HR see what they do and run them now.
 */
@RestController
@RequestMapping("/v1/leave")
@Tag(name = "Leave year end", description = "Leave accrual, carry forward and the balance ledger")
@SecurityRequirement(name = "bearerAuth")
public class LeaveYearEndController {

    private final LeaveAccrualService accrual;

    public LeaveYearEndController(LeaveAccrualService accrual) {
        this.accrual = accrual;
    }

    @Operation(summary = "Credit monthly / quarterly leave up to today (runs nightly on its own)")
    @PostMapping("/accrual/run")
    @PreAuthorize("hasAuthority('hrms.leave.yearend.run')")
    public ResponseEntity<AccrualRunResult> runAccrual(@RequestParam(required = false) UUID leaveTypeId,
                                                       @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(accrual.accrueTenant(LeaveAccrualService.todayIst(), leaveTypeId, actor(jwt)));
    }

    @Operation(summary = "Preview the year-end carry forward from a leave year (changes nothing)")
    @GetMapping("/year-end/preview")
    @PreAuthorize("hasAuthority('hrms.leave.yearend.run')")
    public ResponseEntity<CarryForwardPreview> preview(@RequestParam int fromYear,
                                                       @RequestParam(required = false) UUID leaveTypeId) {
        return ResponseEntity.ok(accrual.previewCarryForward(fromYear, leaveTypeId, LeaveAccrualService.todayIst()));
    }

    @Operation(summary = "Run the year-end carry forward (unused days above the cap lapse; each line runs once)")
    @PostMapping("/year-end/carry-forward")
    @PreAuthorize("hasAuthority('hrms.leave.yearend.run')")
    public ResponseEntity<CarryForwardResult> carryForward(@RequestParam int fromYear,
                                                           @RequestParam(required = false) UUID leaveTypeId,
                                                           @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(accrual.runCarryForward(fromYear, leaveTypeId, actor(jwt), LeaveAccrualService.todayIst()));
    }

    @Operation(summary = "The leave balance audit trail: credits, carry forward, lapses and encashments")
    @GetMapping("/ledger")
    @PreAuthorize("hasAnyAuthority('hrms.leave.yearend.run','hrms.report.leave')")
    public ResponseEntity<List<LedgerEntry>> ledger(@RequestParam(required = false) UUID employeeId,
                                                    @RequestParam(required = false) UUID leaveTypeId,
                                                    @RequestParam(required = false) Integer year,
                                                    @RequestParam(required = false) String kind,
                                                    @RequestParam(defaultValue = "100") int limit) {
        return ResponseEntity.ok(accrual.ledger(employeeId, leaveTypeId, year, kind, limit));
    }

    @Operation(summary = "My own leave credits, carry forward and encashments")
    @GetMapping("/my/ledger")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<List<LedgerEntry>> myLedger(@AuthenticationPrincipal Jwt jwt,
                                                      @RequestParam(required = false) Integer year) {
        return ResponseEntity.ok(accrual.ledger(employeeId(jwt), null, year, null, 100));
    }

    static UUID employeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }

    private static String actor(Jwt jwt) {
        if (jwt == null) return "system";
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? empId : jwt.getSubject();
    }
}
