package com.hrms.api.quota;

import com.hrms.employee.quota.SeatQuotaService;
import com.unifiedtree.security.tenant.CompanyContext;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Serves the seat-usage widget on the workspace overview.
 *
 * <p>Same numbers the {@link com.hrms.employee.quota.SeatQuotaEnforcer} logs on create, so the UI
 * can render "12 / 15 seats used" without a second source of truth.
 *
 * <p>Soft seat limit (contract with the HRMS lane, 6 Oct 2026): every old field stays, plus
 * {@code seatsBought}, {@code seatsUsed}, {@code overBy} (seats used beyond the bought ones),
 * {@code extraBilledAtCycleEnd} (always true: going over is allowed and billed at the cycle end),
 * {@code cycleEndsOn} (the paid cycle's last day, IST; null on a trial or without a paid
 * subscription) and {@code companyId} (the current company; numbers are still the business's
 * until subscriptions are per company).
 */
@RestController
@RequestMapping("/v1/workspace/seats")
public class SeatQuotaController {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final SeatQuotaService seatQuota;
    private final JdbcTemplate jdbc;

    public SeatQuotaController(SeatQuotaService seatQuota, JdbcTemplate jdbc) {
        this.seatQuota = seatQuota;
        this.jdbc = jdbc;
    }

    @GetMapping("/usage")
    @PreAuthorize("isAuthenticated()")
    public SeatUsage usage() {
        SeatQuotaService.Usage u = seatQuota.getUsageForCurrentTenant();
        UUID tenantId = com.hrms.core.tenant.TenantContext.getTenantId();
        return SeatUsage.of(u, cycleEndsOn(tenantId), CompanyContext.getCompanyId());
    }

    /** The paid cycle's last day for the business's current subscription; null on a trial / none. */
    LocalDate cycleEndsOn(UUID tenantId) {
        if (tenantId == null) return null;
        try {
            List<Timestamp> ends = jdbc.query("""
                    SELECT current_period_end FROM platform.subscriptions
                     WHERE tenant_id = ?
                       AND status IN ('ACTIVE', 'PAST_DUE', 'HALTED')
                       AND COALESCE(plan_type, 'PAID') <> 'TRIAL'
                       AND (trial_ends_at IS NULL OR trial_ends_at <= now())
                     ORDER BY created_at DESC
                     LIMIT 1
                    """, (rs, n) -> rs.getTimestamp(1), tenantId);
            return ends.isEmpty() || ends.get(0) == null ? null : ends.get(0).toInstant().atZone(IST).toLocalDate();
        } catch (DataAccessException e) {
            return null;   // the cycle date is a nicety; never fail the seat widget over it
        }
    }

    public record SeatUsage(
            int purchased, int current, int currentExcludingAdmin, int remaining,
            int seatsBought, int seatsUsed, int overBy, boolean extraBilledAtCycleEnd,
            LocalDate cycleEndsOn, UUID companyId) {

        static SeatUsage of(SeatQuotaService.Usage u, LocalDate cycleEndsOn, UUID companyId) {
            int bought = Math.max(0, u.purchased());
            return new SeatUsage(u.purchased(), u.current(), u.currentExcludingAdmin(), u.remaining(),
                    bought, u.current(), Math.max(0, u.current() - bought), true, cycleEndsOn, companyId);
        }
    }
}
