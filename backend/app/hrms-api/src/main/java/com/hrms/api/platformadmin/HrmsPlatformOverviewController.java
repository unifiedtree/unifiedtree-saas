package com.hrms.api.platformadmin;

import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
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
 * <p>Seats mirror {@code SeatQuotaService.seatCap()} / {@code activeEmployees()}
 * (hrms-employee), read-only. Deliberately NOT {@code SeatQuotaService.getUsage()}:
 * that publishes a SeatOverageDetectedEvent which sends the customer an over-cap
 * warning, and an operator opening this page must not message customers. If the
 * seat rule changes there, change it here too.
 */
@RestController
@RequestMapping("/v1/platform/admin/hrms")
public class HrmsPlatformOverviewController {

    static final int TRIAL_FALLBACK_CAP = 5;   // SeatQuotaService.TRIAL_FALLBACK_CAP

    private final JdbcTemplate jdbc;
    private final TenantScopedReader scoped;

    public HrmsPlatformOverviewController(JdbcTemplate jdbc, TenantScopedReader scoped) {
        this.jdbc = jdbc;
        this.scoped = scoped;
    }

    public record HrmsWorkspace(UUID tenantId, String subdomain, String displayName, String workspaceStatus,
                                String hrmsStatus, Instant hrmsExpiresAt, String subscriptionStatus,
                                String planType, String billingCycle, Instant currentPeriodEnd, int seatsPurchased,
                                int seatsUsed, boolean overCap) {}

    @GetMapping("/workspaces")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.read')")
    public List<HrmsWorkspace> workspaces() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT t.id, t.subdomain, t.display_name, t.status AS ws_status, t.plan_type AS ws_plan_type,
                       tm.status AS hrms_status, tm.expires_at AS hrms_expires,
                       s.status AS sub_status, s.plan_type, s.billing_cycle, s.current_period_end
                  FROM platform.tenants t
                  LEFT JOIN platform.tenant_modules tm ON tm.tenant_id = t.id AND tm.module_key = 'hrms'
                  LEFT JOIN LATERAL (
                        SELECT status, plan_type, billing_cycle, current_period_end FROM platform.subscriptions
                         WHERE tenant_id = t.id AND (modules @> ARRAY['hrms'] OR plan_keys @> ARRAY['hr-employees'])
                         ORDER BY (status IN ('ACTIVE','TRIALING','PAST_DUE','GRACE','HALTED')) DESC, created_at DESC
                         LIMIT 1) s ON TRUE
                 WHERE t.id <> ? AND (tm.tenant_id IS NOT NULL OR s.status IS NOT NULL)
                 ORDER BY t.subdomain
                """, TenantContext.PLATFORM_TENANT_ID);
        List<HrmsWorkspace> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            UUID tenantId = (UUID) r.get("id");
            int purchased = seatCap(tenantId, (String) r.get("ws_plan_type"));
            // hrms.employees is row-level secured: count inside the workspace.
            Integer used = scoped.read(tenantId, () -> jdbc.queryForObject(
                    "SELECT count(*)::int FROM hrms.employees WHERE tenant_id = ? AND is_active = true",
                    Integer.class, tenantId));
            int u = used == null ? 0 : used;
            out.add(new HrmsWorkspace(tenantId, (String) r.get("subdomain"), (String) r.get("display_name"),
                    (String) r.get("ws_status"), (String) r.get("hrms_status"), ts(r.get("hrms_expires")),
                    (String) r.get("sub_status"), (String) r.get("plan_type"), (String) r.get("billing_cycle"),
                    ts(r.get("current_period_end")), purchased, u, purchased > 0 && u > purchased));
        }
        return out;
    }

    /** Mirrors SeatQuotaService.seatCap(): billed seats, else the module's seats, else the trial floor. */
    private int seatCap(UUID tenantId, String workspacePlanType) {
        Integer billed = jdbc.queryForObject("""
                SELECT max(seats) FROM platform.subscriptions
                 WHERE tenant_id = ? AND status IN ('TRIALING','ACTIVE','PAST_DUE','HALTED','GRACE')
                """, Integer.class, tenantId);
        if (billed != null && billed > 0) return billed;
        Integer module = jdbc.queryForObject("""
                SELECT max(NULLIF(to_jsonb(tm)->>'seats', '')::integer) FROM platform.tenant_modules tm
                 WHERE tenant_id = ? AND status = 'ACTIVE'
                """, Integer.class, tenantId);
        if (module != null && module > 0) return module;
        return "TRIAL".equalsIgnoreCase(workspacePlanType) ? TRIAL_FALLBACK_CAP : 0;
    }

    private static Instant ts(Object o) {
        return o instanceof Timestamp t ? t.toInstant() : null;
    }
}
