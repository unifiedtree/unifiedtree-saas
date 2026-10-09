package com.unifiedtree.saas.marketing;

import com.unifiedtree.saas.admin.support.PlatformAuditTrail;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.saas.marketing.MarketingAccessService.AuditSubject;
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

import java.util.LinkedHashMap;
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

    /** Marketing reports that it ended a person's Marketing session (UnifiedTree refused them). */
    static final String ACCESS_REVOKED = "MARKETING_SSO_ACCESS_REVOKED";

    /** How the Marketing service is named on the audit rows it writes. */
    static final String SERVICE = "marketing-service";

    private final MarketingAccessService access;
    private final MarketingUsageService usage;
    private final PlatformAuditTrail auditTrail;
    private final TenantScopedReader scoped;

    public MarketingInternalController(MarketingAccessService access, MarketingUsageService usage,
                                       PlatformAuditTrail auditTrail, TenantScopedReader scoped) {
        this.access = access;
        this.usage = usage;
        this.auditTrail = auditTrail;
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
        if (ACCESS_REVOKED.equals(action)) return auditAccessRevoked(req);
        // The person behind a Marketing action is recorded as their user in that workspace (null if not a member)
        UUID actor = access.actorUserId(req.accountId(), req.tenantId());
        // Only a resolved account's own email is recorded; the caller's actorEmail text is never trusted (null otherwise)
        String email = actor != null ? access.accountEmail(req.accountId()) : null;
        // JDBC on the workspace-bound transaction (its insert policy takes that workspace's rows only); a failure
        // answers 500 so Marketing can retry, instead of "recorded" with nothing written
        scoped.write(req.tenantId(), () -> {
            auditTrail.insertInTransaction(actor, email, null, "marketing-service", "marketing", action,
                    req.entityType(), req.entityId(), clip(req.summary(), 1000));
            return null;
        });
        return Map.of("recorded", true);
    }

    /**
     * Marketing ended someone's session because UnifiedTree no longer lets them in. No person did that: the actor is
     * the Marketing service (no user, no email; {@value #SERVICE} as the row's agent and in its details), and the
     * person who lost access is the record: their account, with its email read here by the account id (the caller's
     * actorEmail is never used). What Marketing named as the record moves into the details. When the account id is
     * missing or was never in that workspace nobody is named, and the row is written as Marketing sent it.
     */
    private Map<String, Object> auditAccessRevoked(AuditRequest req) {
        AuditSubject subject = access.auditSubject(req.accountId(), req.tenantId());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("by", SERVICE);
        if (subject != null) {
            details.put("accountId", subject.accountId().toString());
            details.put("email", subject.email());
            if (subject.workspaceUserId() != null) details.put("workspaceUserId", subject.workspaceUserId().toString());
            if (req.entityType() != null || req.entityId() != null) {
                details.put("reportedEntityType", req.entityType());
                details.put("reportedEntityId", req.entityId() == null ? null : req.entityId().toString());
            }
        }
        String entityType = subject != null ? "account" : req.entityType();
        UUID entityId = subject != null ? subject.accountId() : req.entityId();
        scoped.write(req.tenantId(), () -> {
            auditTrail.insertInTransaction(null, null, null, SERVICE, "marketing", ACCESS_REVOKED, entityType,
                    entityId, clip(req.summary(), 1000), details);
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
