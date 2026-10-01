package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * My pay beyond the payslip list (BW-55), always the caller's own:
 * <ul>
 *   <li>{@code GET /v1/payroll/payslips/me/schedule}: the next pay date
 *       (contract C0, usePaySchedule),</li>
 *   <li>{@code GET /v1/payroll/payslips/me/ytd}: this financial year's totals,</li>
 *   <li>{@code GET /v1/payroll/payslips/me/upcoming}: the month being prepared,
 *       without figures.</li>
 * </ul>
 * These literal paths are more specific than {@code /payslips/me/{runId}} in
 * PayrollRunController, so Spring routes them here (before this, "schedule"
 * was read as a run id and answered 400).
 */
@RestController
@RequestMapping("/v1/payroll/payslips/me")
public class MyPayController {

    private final MyPayService service;

    public MyPayController(MyPayService service) {
        this.service = service;
    }

    @GetMapping("/schedule")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public MyPayService.PayScheduleDto schedule(@AuthenticationPrincipal Jwt jwt) {
        return service.schedule(TenantContext.getTenantId(), ownEmployeeId(jwt));
    }

    @GetMapping("/ytd")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public MyPayService.YtdDto ytd(@AuthenticationPrincipal Jwt jwt) {
        return service.ytd(TenantContext.getTenantId(), ownEmployeeId(jwt));
    }

    @GetMapping("/upcoming")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public List<MyPayService.UpcomingDto> upcoming(@AuthenticationPrincipal Jwt jwt) {
        return service.upcoming(TenantContext.getTenantId(), ownEmployeeId(jwt));
    }

    /** The caller's employee id from the token; null for an account with no employee record. */
    static UUID ownEmployeeId(Jwt jwt) {
        if (jwt == null) return null;
        String id = jwt.getClaimAsString("employee_id");
        try {
            return id == null || id.isBlank() ? null : UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
