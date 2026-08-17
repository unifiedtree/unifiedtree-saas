package com.hrms.api.quota;

import com.hrms.employee.quota.SeatQuotaService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves the seat-usage widget on the workspace overview.
 *
 * <p>Same numbers the {@link com.hrms.employee.quota.SeatQuotaEnforcer}
 * enforces on create, so the UI can render "12 / 15 seats used" without any
 * second source of truth.
 */
@RestController
@RequestMapping("/v1/workspace/seats")
public class SeatQuotaController {

    private final SeatQuotaService seatQuota;

    public SeatQuotaController(SeatQuotaService seatQuota) {
        this.seatQuota = seatQuota;
    }

    @GetMapping("/usage")
    @PreAuthorize("isAuthenticated()")
    public SeatQuotaService.Usage usage() {
        return seatQuota.getUsageForCurrentTenant();
    }
}
