package com.unifiedtree.saas.marketing;

import com.unifiedtree.audit.AuditService;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.saas.marketing.MarketingAccessService.MarketingEntitlement;
import com.unifiedtree.saas.marketing.MarketingAccessService.MarketingIdentity;
import com.unifiedtree.saas.marketing.MarketingAccessService.PrincipalMapping;
import com.unifiedtree.saas.marketing.MarketingUsageService.ChannelAccount;
import com.unifiedtree.saas.marketing.MarketingUsageService.UsageEvent;
import com.unifiedtree.saas.marketing.MarketingUsageService.UsageRecorded;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The server-to-server API Marketing Automation calls for PLATFORM decisions.
 * Marketing never connects to PostgreSQL; this is how it asks. Guarded by
 * {@link MarketingServiceTokenFilter} (shared service token, fails closed).
 *
 * <p>Contract version {@value MarketingAccessService#CONTRACT_VERSION}; every response
 * DTO carries it. Paths are versioned under /v1.
 */
@RestController
@RequestMapping("/v1/internal/marketing")
public class MarketingInternalController {

    private static final Set<String> AUDIT_ACTIONS_PREFIXES = Set.of("MARKETING_");

    private final MarketingAccessService access;
    private final MarketingUsageService usage;
    private final AuditService audit;
    private final TenantScopedReader scoped;

    public MarketingInternalController(MarketingAccessService access, MarketingUsageService usage,
                                       AuditService audit, TenantScopedReader scoped) {
        this.access = access;
        this.usage = usage;
        this.audit = audit;
        this.scoped = scoped;
    }

    public record RedeemRequest(@NotBlank String ticket) {}

    public record PrincipalRequest(@NotBlank String kind, @NotBlank String legacyMarketingUserId, UUID accountId,
                                   @NotNull UUID tenantId, @NotNull UUID companyId, String legacyRole,
                                   String legacyEmail) {}

    public record AuditRequest(@NotNull UUID tenantId, UUID accountId, String actorEmail, @NotBlank String action,
                               String entityType, UUID entityId, @NotBlank String summary) {}

    public record ChannelRequest(@NotNull UUID tenantId, @NotNull UUID companyId, @NotBlank String wabaId,
                                 String displayName) {}

    /** Redeem a single-use SSO ticket; returns who the person is and what they may do. */
    @PostMapping("/sso/redeem")
    public MarketingIdentity redeem(@Valid @RequestBody RedeemRequest req) {
        return access.redeem(req.ticket());
    }

    /** Re-check access, e.g. when the person switches company inside Marketing. */
    @GetMapping("/access")
    public MarketingIdentity access(@RequestParam UUID accountId, @RequestParam UUID tenantId,
                                    @RequestParam UUID companyId) {
        return access.verify(accountId, tenantId, companyId);
    }

    /** Has the company bought Marketing, on which plan, with which limits. */
    @GetMapping("/companies/{companyId}/entitlement")
    public MarketingEntitlement entitlement(@PathVariable UUID companyId, @RequestParam UUID tenantId) {
        return access.entitlement(tenantId, companyId);
    }

    @PutMapping("/principals")
    public PrincipalMapping recordPrincipal(@Valid @RequestBody PrincipalRequest req) {
        return access.recordPrincipal(req.kind(), req.legacyMarketingUserId(), req.accountId(), req.tenantId(),
                req.companyId(), req.legacyRole(), req.legacyEmail());
    }

    @GetMapping("/principals")
    public PrincipalMapping principal(@RequestParam UUID companyId, @RequestParam(required = false) UUID accountId) {
        return access.principal(accountId, companyId);
    }

    /** Write a Marketing action into the workspace's audit trail (UnifiedTree's single audit stream). */
    @PostMapping("/audit")
    public Map<String, Object> audit(@Valid @RequestBody AuditRequest req) {
        String action = req.action().trim().toUpperCase(java.util.Locale.ROOT);
        if (AUDIT_ACTIONS_PREFIXES.stream().noneMatch(action::startsWith)) {
            // Marketing may only write its own kind of event, never impersonate platform ones.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "action must start with MARKETING_");
        }
        // The person behind a Marketing action is recorded as their user in that workspace (null if not a member)
        UUID actor = access.actorUserId(req.accountId(), req.tenantId());
        scoped.write(req.tenantId(), () -> {
            audit.recordAs(actor, req.actorEmail(), null, "marketing-service", "marketing", action,
                    req.entityType(), req.entityId(), clip(req.summary(), 1000));
            return null;
        });
        return Map.of("recorded", true);
    }

    @PostMapping("/channels")
    public ChannelAccount connectChannel(@Valid @RequestBody ChannelRequest req) {
        return usage.connectChannel(req.tenantId(), req.companyId(), req.wabaId(), req.displayName());
    }

    /** Record one WhatsApp usage event (idempotent). Pooled billing stays off. */
    @PostMapping("/usage")
    public UsageRecorded usage(@RequestBody UsageEvent event) {
        return usage.record(event);
    }

    private static String clip(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
