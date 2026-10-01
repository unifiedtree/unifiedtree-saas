package com.hrms.api.attendance;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * "Mark attendance" for several people (V143.53 redesign, BW-17;
 * {@link ManualEntryBulkService}), and "Recent manual entries" (BW-18,
 * {@link ManualEntryLog}).
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance manual entry", description = "Mark attendance for several people; recent manual entries")
@SecurityRequirement(name = "bearerAuth")
public class ManualEntryBulkController {

    private final ManualEntryBulkService bulk;
    private final ManualEntryLog recent;
    private final AttendanceController attendance;

    public ManualEntryBulkController(ManualEntryBulkService bulk, ManualEntryLog recent, AttendanceController attendance) {
        this.bulk = bulk;
        this.recent = recent;
        this.attendance = attendance;
    }

    @Operation(summary = "Mark attendance for several people at once (one transaction, a result per person)")
    @PostMapping("/manual-entry/bulk")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public ManualEntryBulkService.BulkResult markSeveral(@RequestBody ManualEntryBulkService.BulkRequest request,
                                                        @AuthenticationPrincipal Jwt jwt) {
        UUID actor = AttendanceReviewService.callerEmployeeId(jwt);
        ManualEntryBulkService.BulkResult result = bulk.apply(request, actor);
        // Audited after the commit, one event per person (as the single entry is).
        result.results().stream().filter(r -> "SAVED".equals(r.outcome()))
                .forEach(r -> attendance.auditManualEntry(r.employeeId(), r.attendance(), request.reason()));
        return result;
    }

    @Operation(summary = "Recent manual entries in your team scope: who entered them and why")
    @GetMapping("/manual-entries")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public java.util.List<ManualEntryLog.Entry> manualEntries(
            @RequestParam(required = false) java.time.LocalDate from,
            @RequestParam(required = false) java.time.LocalDate to,
            @RequestParam(required = false) Integer limit,
            @AuthenticationPrincipal Jwt jwt) {
        return recent.recent(jwt, from, to, limit);
    }
}
