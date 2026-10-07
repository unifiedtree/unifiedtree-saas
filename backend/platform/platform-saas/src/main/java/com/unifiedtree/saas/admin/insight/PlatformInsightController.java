package com.unifiedtree.saas.admin.insight;

import com.unifiedtree.saas.admin.insight.PlatformInsightService.AuditEventRow;
import com.unifiedtree.saas.admin.insight.PlatformInsightService.Dashboard;
import com.unifiedtree.saas.admin.support.PageResult;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Platform dashboard and audit trail for the admin console. Read-only. */
@RestController
@RequestMapping("/v1/platform/admin")
public class PlatformInsightController {

    private final PlatformInsightService insight;

    public PlatformInsightController(PlatformInsightService insight) {
        this.insight = insight;
    }

    @GetMapping("/dashboard")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.tenant.read')")
    public Dashboard dashboard() {
        return insight.dashboard();
    }

    @GetMapping("/audit")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.audit.read')")
    public PageResult<AuditEventRow> audit(@RequestParam(required = false) UUID tenantId,
                                           @RequestParam(required = false) String module,
                                           @RequestParam(required = false) String action,
                                           @RequestParam(required = false) String search,
                                           @RequestParam(required = false) Integer page,
                                           @RequestParam(required = false) Integer size) {
        return insight.audit(tenantId, module, action, search, PageResult.page(page), PageResult.size(size));
    }
}
