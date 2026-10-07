package com.unifiedtree.saas.marketing;

import com.unifiedtree.saas.admin.directory.PlatformDirectoryService;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService.CompanyRow;
import com.unifiedtree.saas.admin.support.Operator;
import com.unifiedtree.saas.admin.support.PageResult;
import com.unifiedtree.saas.admin.support.PlatformAuditTrail;
import com.unifiedtree.saas.marketing.MarketingUsageService.ChannelAccount;
import com.unifiedtree.saas.marketing.MarketingUsageService.UsageSummary;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * The PLATFORM half of the admin console's Marketing Automation section: which
 * companies have Marketing, how their people are mapped to Marketing users, which
 * WABAs they own commercially, and recorded usage. The Marketing-ENGINE half
 * (templates, quick replies, AI models, queues) is served by Marketing's own API
 * through the console's BFF — this controller never reads MongoDB.
 */
@RestController
@RequestMapping("/v1/platform/admin/marketing")
public class PlatformMarketingAdminController {

    private final PlatformDirectoryService directory;
    private final MarketingUsageService usage;
    private final JdbcTemplate jdbc;
    private final PlatformAuditTrail audit;
    private final MarketingAccessService access;

    public PlatformMarketingAdminController(PlatformDirectoryService directory, MarketingUsageService usage,
                                            JdbcTemplate jdbc, PlatformAuditTrail audit,
                                            MarketingAccessService access) {
        this.directory = directory;
        this.usage = usage;
        this.jdbc = jdbc;
        this.audit = audit;
        this.access = access;
    }

    public record IdentityMapRow(UUID id, String kind, String legacyMarketingUserId, String legacyRole,
                                 String legacyEmail, UUID accountId, String accountEmail, UUID tenantId,
                                 String workspaceSubdomain, UUID companyId, String status, String source,
                                 String quarantineReason, Instant mappedAt, Instant createdAt) {}

    public record BillingModeRequest(@NotBlank String billingMode, BigDecimal monthlySpendLimit) {}

    public record RetireRequest(@NotBlank String reason) {}

    /** Companies with Marketing switched on (any source), with channel counts. */
    @GetMapping("/companies")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.read')")
    public PageResult<CompanyRow> companies(@RequestParam(required = false) UUID tenantId,
                                            @RequestParam(required = false) String search,
                                            @RequestParam(required = false) Integer page,
                                            @RequestParam(required = false) Integer size) {
        return directory.companies(tenantId, search, null, MarketingAccessService.MODULE,
                PageResult.page(page), PageResult.size(size));
    }

    @GetMapping("/identity-map")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.read')")
    public PageResult<IdentityMapRow> identityMap(@RequestParam(required = false) String status,
                                                  @RequestParam(required = false) UUID tenantId,
                                                  @RequestParam(required = false) Integer page,
                                                  @RequestParam(required = false) Integer size) {
        int p = PageResult.page(page), s = PageResult.size(size);
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (status != null && !status.isBlank()) {
            where.append(" AND m.status = ?");
            args.add(status.trim().toUpperCase(Locale.ROOT));
        }
        if (tenantId != null) { where.append(" AND m.tenant_id = ?"); args.add(tenantId); }
        Long total = jdbc.queryForObject("SELECT count(*) FROM platform.marketing_identity_map m" + where,
                Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(s);
        pageArgs.add((long) p * s);
        List<IdentityMapRow> rows = jdbc.query("""
                SELECT m.*, a.email AS account_email, t.subdomain
                  FROM platform.marketing_identity_map m
                  LEFT JOIN platform.accounts a ON a.id = m.account_id
                  LEFT JOIN platform.tenants t ON t.id = m.tenant_id
                """ + where + " ORDER BY m.updated_at DESC LIMIT ? OFFSET ?",
                (rs, i) -> new IdentityMapRow(rs.getObject("id", UUID.class), rs.getString("kind"),
                        rs.getString("legacy_marketing_user_id"), rs.getString("legacy_role"),
                        rs.getString("legacy_email"), rs.getObject("account_id", UUID.class),
                        rs.getString("account_email"), rs.getObject("tenant_id", UUID.class), rs.getString("subdomain"),
                        rs.getObject("company_id", UUID.class), rs.getString("status"), rs.getString("source"),
                        rs.getString("quarantine_reason"), ts(rs.getTimestamp("mapped_at")),
                        ts(rs.getTimestamp("created_at"))),
                pageArgs.toArray());
        return PageResult.of(rows, p, s, total == null ? 0 : total);
    }

    /**
     * Retire an identity mapping: that Marketing user no longer stands for the company (owner) or person (member).
     * For when Marketing lost the user (a database restore) or a link was wrong; the next Sign in with UnifiedTree then
     * creates a fresh principal. Nothing is deleted, and a retired mapping is never re-pointed by the service.
     */
    @PostMapping("/identity-map/{id}/retire")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.manage')")
    @Transactional
    public Map<String, Object> retireMapping(@PathVariable UUID id, @Valid @RequestBody RetireRequest req,
                                             @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        String reason = req.reason().strip();
        if (reason.length() < 5) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "reason must be at least 5 characters");
        }
        // One transaction with its audit row (a bare JdbcTemplate update outside one would never commit)
        Map<String, Object> row = access.retireMapping(id);
        audit.recordInTransaction(Operator.of(jwt), http, "MARKETING_IDENTITY_RETIRED", "marketing_identity", id,
                "%s mapping of Marketing user %s (company %s) retired. Reason: %s".formatted(
                        row.get("kind"), row.get("legacy_marketing_user_id"), row.get("company_id"), reason));
        return Map.of("id", id, "status", "RETIRED");
    }

    @GetMapping("/channels")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.read')")
    public List<ChannelAccount> channels(@RequestParam(required = false) UUID tenantId,
                                         @RequestParam(required = false) UUID companyId) {
        return usage.channels(tenantId, companyId);
    }

    /** Change a channel's billing mode. Anything but DIRECT_CUSTOMER is refused while pooled billing is off. */
    @PutMapping("/channels/{channelId}/billing-mode")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.manage')")
    @Transactional
    public ChannelAccount setBillingMode(@PathVariable UUID channelId, @Valid @RequestBody BillingModeRequest req,
                                         @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        ChannelAccount saved = usage.setBillingMode(channelId, req.billingMode(), req.monthlySpendLimit());
        audit.recordInTransaction(Operator.of(jwt), http, "MARKETING_BILLING_MODE", "marketing_channel", channelId,
                "WABA %s billing mode %s, spend limit %s".formatted(saved.wabaId(), saved.billingMode(),
                        saved.monthlySpendLimit()));
        return saved;
    }

    @GetMapping("/usage")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.read')")
    public UsageSummary usage(@RequestParam(required = false) UUID tenantId,
                              @RequestParam(required = false) UUID companyId,
                              @RequestParam(required = false) Instant from,
                              @RequestParam(required = false) Instant to) {
        return usage.summary(tenantId, companyId, from, to);
    }

    @GetMapping("/billing-status")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.marketing.read')")
    public Map<String, Object> billingStatus() {
        boolean pooled = usage.pooledEnabled();
        return Map.of("pooledBillingEnabled", pooled,
                "mode", pooled ? "UNIFIEDTREE_POOLED available" : "DIRECT_CUSTOMER only",
                "note", pooled ? "Pooled billing is switched on."
                        : "Meta bills each customer directly. Pooled billing needs Meta partner / line-of-credit "
                        + "approval, then a manual switch in platform.billing_settings.");
    }

    private static Instant ts(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
