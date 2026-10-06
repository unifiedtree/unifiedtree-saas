package com.hrms.api.leave;

import com.hrms.api.access.RecordCompanyGuard;
import com.hrms.leave.dto.LeaveEntitlementDtos.ApplyPreview;
import com.hrms.leave.dto.LeaveEntitlementDtos.ApplyResult;
import com.hrms.leave.service.LeaveAccrualService;
import com.hrms.leave.service.LeaveEntitlementService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * "Apply to all employees" on a leave type (4 Oct 2026): give everyone still
 * working in the type's company the days the type gives, for this leave year.
 * Editing a type never changes balances people already have; this is the
 * explicit step that does, after a preview. See {@link LeaveEntitlementService}.
 *
 * <p>Same permission as editing the type ({@code leave.type.write}: OWNER,
 * SUPER_ADMIN, ADMIN and HR_MANAGER among the built-in roles).
 */
@RestController
@RequestMapping("/v1/leave/types")
@Tag(name = "Leave", description = "Leave applications, approvals, balances, and policies")
@SecurityRequirement(name = "bearerAuth")
public class LeaveTypeApplyController {

    /** Company access: a record addressed by id must be in a company the caller may work in (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private RecordCompanyGuard recordGuard;

    private final LeaveEntitlementService entitlements;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.unifiedtree.audit.AuditService auditService;

    public LeaveTypeApplyController(LeaveEntitlementService entitlements) {
        this.entitlements = entitlements;
    }

    @Operation(summary = "Preview giving everyone this leave type's days for this leave year (changes nothing)")
    @GetMapping("/{id}/apply-to-all/preview")
    @PreAuthorize("hasAuthority('leave.type.write')")
    public ResponseEntity<ApplyPreview> preview(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.LEAVE_TYPE, id);
        return ResponseEntity.ok(entitlements.preview(id, LeaveAccrualService.todayIst()));
    }

    @Operation(summary = "Give everyone this leave type's days for this leave year; days = the days a year that were previewed")
    @PostMapping("/{id}/apply-to-all")
    @PreAuthorize("hasAuthority('leave.type.write')")
    public ResponseEntity<ApplyResult> apply(@PathVariable UUID id,
                                             @RequestParam(required = false) Double days,
                                             @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.LEAVE_TYPE, id);
        ApplyResult result = entitlements.apply(id, days, actor(jwt), LeaveAccrualService.todayIst());
        if (auditService != null && (result.changed() > 0 || result.added() > 0)) {
            try {
                auditService.record("leave", "LEAVE_TYPE_APPLIED_TO_ALL", "LEAVE_TYPE", id,
                        "%s: everyone set to %s days a year for %d (%d changed, %d added, %d below zero)".formatted(
                                result.leaveTypeName(), days(result.annualEntitlement()), result.year(),
                                result.changed(), result.added(), result.belowZero()));
            } catch (Exception e) {
                // Audit is best effort (AuditService also swallows its own write errors).
            }
        }
        return ResponseEntity.ok(result);
    }

    private static String days(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    private static String actor(Jwt jwt) {
        if (jwt == null) return "system";
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? empId : jwt.getSubject();
    }
}
