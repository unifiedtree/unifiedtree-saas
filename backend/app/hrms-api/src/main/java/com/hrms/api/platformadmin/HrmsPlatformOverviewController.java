package com.hrms.api.platformadmin;

import com.hrms.employee.quota.SeatQuotaService;
import com.unifiedtree.saas.admin.support.PageResult;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * HRMS as a UnifiedTree PRODUCT, for the admin console: which workspaces have it,
 * their HRMS subscription, and seats bought vs used. Platform administration only —
 * no HRMS business screens or operations (those belong to the HRMS team).
 *
 * <p>Seats come from {@link SeatQuotaService#peekUsage} (hrms-employee), the HRMS seat
 * rule itself, read only: not {@code getUsage()}, which publishes a SeatOverageDetectedEvent
 * that messages the customer. It counts hrms.employees (row-level secured), so each
 * workspace is read inside {@link TenantScopedReader}; the list is paged, one workspace
 * transaction per row of the page.
 */
@RestController
@RequestMapping("/v1/platform/admin/hrms")
public class HrmsPlatformOverviewController {

    private static final String WHERE = """
              FROM platform.tenants t
              LEFT JOIN platform.tenant_modules tm ON tm.tenant_id = t.id AND tm.module_key = 'hrms'
              LEFT JOIN LATERAL (
                    SELECT status, plan_type, billing_cycle, current_period_end FROM platform.subscriptions
                     WHERE tenant_id = t.id AND (modules @> ARRAY['hrms'] OR plan_keys @> ARRAY['hr-employees'])
                     ORDER BY (status IN ('ACTIVE','TRIALING','PAST_DUE','GRACE','HALTED')) DESC, created_at DESC
                     LIMIT 1) s ON TRUE
             WHERE t.id <> ? AND (tm.tenant_id IS NOT NULL OR s.status IS NOT NULL)
            """;

    private final JdbcTemplate jdbc;
    private final TenantScopedReader scoped;
    private final SeatQuotaService seats;

    public HrmsPlatformOverviewController(JdbcTemplate jdbc, TenantScopedReader scoped, SeatQuotaService seats) {
        this.jdbc = jdbc;
        this.scoped = scoped;
        this.seats = seats;
    }

    public record HrmsWorkspace(UUID tenantId, String subdomain, String displayName, String workspaceStatus,
                                String hrmsStatus, Instant hrmsExpiresAt, String subscriptionStatus,
                                String planType, String billingCycle, Instant currentPeriodEnd, int seatsPurchased,
                                int seatsUsed, boolean overCap) {}

    @GetMapping("/workspaces")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.read')")
    public PageResult<HrmsWorkspace> workspaces(@RequestParam(required = false) Integer page,
                                                @RequestParam(required = false) Integer size) {
        int p = PageResult.page(page), n = PageResult.size(size);
        Long total = jdbc.queryForObject("SELECT count(*) " + WHERE, Long.class, TenantContext.PLATFORM_TENANT_ID);
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT t.id, t.subdomain, t.display_name, t.status AS ws_status,
                       tm.status AS hrms_status, tm.expires_at AS hrms_expires,
                       s.status AS sub_status, s.plan_type, s.billing_cycle, s.current_period_end
                """ + WHERE + " ORDER BY t.subdomain LIMIT ? OFFSET ?",
                TenantContext.PLATFORM_TENANT_ID, n, (long) p * n);
        List<HrmsWorkspace> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            UUID tenantId = (UUID) r.get("id");
            SeatQuotaService.Usage u = scoped.read(tenantId, () -> seats.peekUsage(tenantId));
            out.add(new HrmsWorkspace(tenantId, (String) r.get("subdomain"), (String) r.get("display_name"),
                    (String) r.get("ws_status"), (String) r.get("hrms_status"), ts(r.get("hrms_expires")),
                    (String) r.get("sub_status"), (String) r.get("plan_type"), (String) r.get("billing_cycle"),
                    ts(r.get("current_period_end")), u.purchased(), u.current(),
                    u.purchased() > 0 && u.current() > u.purchased()));
        }
        return PageResult.of(out, p, n, total == null ? 0 : total);
    }

    private static Instant ts(Object o) {
        return o instanceof Timestamp t ? t.toInstant() : null;
    }
}
