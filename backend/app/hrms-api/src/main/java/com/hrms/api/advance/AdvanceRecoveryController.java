package com.hrms.api.advance;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Advance recovery — schedule + ledger reads, and admin actions (foreclose,
 * write-off, skip-month). Wave 2 (2026-08-11).
 *
 * <p>Sits alongside the existing {@code AdvanceController} — that one handles
 * request/approve/disburse; this one is everything AFTER disbursal. Split
 * so the JPA-styled AdvanceController stays focused and the raw-JDBC
 * recovery layer doesn't get tangled with it.
 */
@RestController
@RequestMapping("/v1/advance")
public class AdvanceRecoveryController {

    private final AdvanceRecoveryService service;
    private final com.hrms.advance.service.AdvanceService advances;

    public AdvanceRecoveryController(AdvanceRecoveryService service, com.hrms.advance.service.AdvanceService advances) {
        this.service = service;
        this.advances = advances;
    }

    @GetMapping("/{id}/schedule")
    @PreAuthorize("hasAuthority('hrms.advance.read')")
    public List<AdvanceRecoveryService.ScheduleRowDto> schedule(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        requireVisible(id, jwt);
        return service.listSchedule(TenantContext.getTenantId(), id);
    }

    @GetMapping("/{id}/ledger")
    @PreAuthorize("hasAuthority('hrms.advance.read')")
    public List<AdvanceRecoveryService.LedgerRowDto> ledger(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        requireVisible(id, jwt);
        return service.listLedger(TenantContext.getTenantId(), id);
    }

    @GetMapping("/{id}/summary")
    @PreAuthorize("hasAuthority('hrms.advance.read')")
    public AdvanceRecoveryService.RecoverySummaryDto summary(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        requireVisible(id, jwt);
        return service.summary(TenantContext.getTenantId(), id);
    }

    @PostMapping("/{id}/foreclose")
    @PreAuthorize("hasAuthority('hrms.advance.foreclose')")
    public AdvanceRecoveryService.RecoverySummaryDto foreclose(
            @PathVariable UUID id,
            @Valid @RequestBody AdvanceRecoveryService.ForecloseRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        requireVisible(id, jwt);
        return service.foreclose(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PostMapping("/{id}/write-off")
    @PreAuthorize("hasAuthority('hrms.advance.foreclose')")
    public AdvanceRecoveryService.RecoverySummaryDto writeOff(
            @PathVariable UUID id,
            @Valid @RequestBody AdvanceRecoveryService.WriteOffRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        requireVisible(id, jwt);
        return service.writeOff(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PostMapping("/{id}/skip-month")
    @PreAuthorize("hasAuthority('hrms.advance.approve')")
    public AdvanceRecoveryService.RecoverySummaryDto skipMonth(
            @PathVariable UUID id,
            @Valid @RequestBody AdvanceRecoveryService.SkipMonthRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        var advance = advances.getRequest(id);
        if (!canReadAll(jwt) && !java.util.Objects.equals(advance.approverId(), employeeId(jwt))) {
            throw new org.springframework.security.access.AccessDeniedException("This advance is not routed to you for approval.");
        }
        return service.skipMonth(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    private void requireVisible(UUID id, Jwt jwt) {
        var advance = advances.getRequest(id);
        UUID employeeId = employeeId(jwt);
        if (!canReadAll(jwt) && !java.util.Objects.equals(advance.employeeId(), employeeId)
                && !java.util.Objects.equals(advance.approverId(), employeeId)) {
            throw new org.springframework.security.access.AccessDeniedException("Not permitted to view this advance.");
        }
    }

    private static boolean canReadAll(Jwt jwt) {
        var permissions = jwt.getClaimAsStringList("permissions");
        return permissions != null && permissions.contains("hrms.advance.disburse");
    }

    private static UUID employeeId(Jwt jwt) {
        String employee = jwt.getClaimAsString("employee_id");
        return UUID.fromString(employee == null ? jwt.getSubject() : employee);
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
