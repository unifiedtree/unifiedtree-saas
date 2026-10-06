package com.unifiedtree.saas.billing;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * GET /v1/workspace/plan/breakdown — the current cycle split by company (Settings → Billing).
 * Under /v1/workspace/plan so it stays reachable while modules are paused. Needs
 * workspace.billing.manage (owner / super admin), like the billing page.
 */
@RestController
public class BillingBreakdownController {

    private final BillingBreakdownService breakdowns;

    public BillingBreakdownController(BillingBreakdownService breakdowns) {
        this.breakdowns = breakdowns;
    }

    @GetMapping("/v1/workspace/plan/breakdown")
    public BillingBreakdownService.Breakdown breakdown(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing JWT");
        List<String> perms = jwt.getClaimAsStringList("permissions");
        if (perms == null || !(perms.contains("workspace.billing.manage") || perms.contains("*"))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the owner can see billing");
        }
        String tenant = jwt.getClaimAsString("tenant_id");
        if (tenant == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "JWT missing tenant_id");
        return breakdowns.forTenant(UUID.fromString(tenant));
    }
}
