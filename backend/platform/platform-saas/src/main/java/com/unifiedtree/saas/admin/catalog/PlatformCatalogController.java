package com.unifiedtree.saas.admin.catalog;

import com.unifiedtree.saas.admin.catalog.PlatformCatalogService.ModuleRow;
import com.unifiedtree.saas.admin.catalog.PlatformCatalogService.PlanRow;
import com.unifiedtree.saas.admin.catalog.PlatformCatalogService.PriceChange;
import com.unifiedtree.saas.admin.catalog.PlatformCatalogService.PriceVersion;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService;
import com.unifiedtree.saas.admin.support.Operator;
import com.unifiedtree.saas.admin.support.PlatformAuditTrail;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.CompanyModuleRow;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.Entitlement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
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
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Products, plans, prices and per-company entitlements for the admin console.
 * Changes need their own permission and a reason, and are written to the audit trail.
 */
@RestController
@RequestMapping("/v1/platform/admin")
public class PlatformCatalogController {

    private final PlatformCatalogService catalog;
    private final CompanyEntitlementService entitlements;
    private final PlatformDirectoryService directory;
    private final PlatformAuditTrail audit;

    public PlatformCatalogController(PlatformCatalogService catalog, CompanyEntitlementService entitlements,
                                     PlatformDirectoryService directory, PlatformAuditTrail audit) {
        this.catalog = catalog;
        this.entitlements = entitlements;
        this.directory = directory;
        this.audit = audit;
    }

    public record PriceChangeRequest(@NotNull BigDecimal unitPrice, String priceModel, BigDecimal annualDiscountPct,
                                     @NotBlank String reason) {}

    public record EntitlementChangeRequest(@NotBlank String status, Instant endsAt, @NotBlank String reason) {}

    public record CompanyEntitlements(UUID tenantId, UUID companyId, List<Entitlement> effective,
                                      List<CompanyModuleRow> rows) {}

    // ── Catalogue ───────────────────────────────────────────────────────────

    @GetMapping("/catalog/modules")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.catalog.read')")
    public List<ModuleRow> modules() {
        return catalog.modules();
    }

    @GetMapping("/catalog/plans")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.catalog.read')")
    public List<PlanRow> plans() {
        return catalog.plans();
    }

    @GetMapping("/catalog/plans/{planKey}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.catalog.read')")
    public PlanRow plan(@PathVariable String planKey) {
        return catalog.plan(planKey);
    }

    @GetMapping("/catalog/plans/{planKey}/prices")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.catalog.read')")
    public List<PriceVersion> prices(@PathVariable String planKey) {
        return catalog.priceHistory(planKey);
    }

    @PostMapping("/catalog/plans/{planKey}/prices")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.catalog.manage')")
    @Transactional
    public PriceChange changePrice(@PathVariable String planKey, @Valid @RequestBody PriceChangeRequest req,
                                   @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        PriceChange change = catalog.changePrice(planKey, req.unitPrice(), req.priceModel(),
                req.annualDiscountPct(), req.reason(), op.label());
        audit.recordInTransaction(op, http, "PLAN_PRICE_CHANGE", "module_plan", null,
                "Plan %s price %s -> %s %s (%s). Reason: %s".formatted(planKey,
                        change.previous() == null ? "none" : change.previous().unitPrice(),
                        change.current().unitPrice(), change.current().priceModel(),
                        change.razorpayPlansCleared() + " cached Razorpay plan(s) cleared", req.reason().strip()));
        return change;
    }

    // ── Company entitlements ────────────────────────────────────────────────

    @GetMapping("/workspaces/{tenantId}/companies/{companyId}/entitlements")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.company.read')")
    public CompanyEntitlements companyEntitlements(@PathVariable UUID tenantId, @PathVariable UUID companyId) {
        directory.requireCompany(tenantId, companyId);
        return new CompanyEntitlements(tenantId, companyId, entitlements.resolveAll(tenantId, companyId),
                entitlements.rows(companyId));
    }

    /** Switch a product on (ACTIVE) or off (SUSPENDED) for one company, with a reason. */
    @PutMapping("/workspaces/{tenantId}/companies/{companyId}/entitlements/{moduleKey}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.entitlement.manage')")
    @Transactional
    public Entitlement setEntitlement(@PathVariable UUID tenantId, @PathVariable UUID companyId,
                                      @PathVariable String moduleKey,
                                      @Valid @RequestBody EntitlementChangeRequest req,
                                      @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        directory.requireCompany(tenantId, companyId);
        Operator op = Operator.of(jwt);
        String status = req.status().trim().toUpperCase(java.util.Locale.ROOT);
        entitlements.setManual(tenantId, companyId, moduleKey, status, req.endsAt(), req.reason(), op.label());
        audit.recordInTransaction(op, http, "ENTITLEMENT_OVERRIDE", "company", companyId,
                "Workspace %s company %s: %s set to %s%s by operator. Reason: %s".formatted(tenantId, companyId,
                        moduleKey, status, req.endsAt() == null ? "" : " until " + req.endsAt(), req.reason().strip()));
        return entitlements.resolve(tenantId, companyId, moduleKey);
    }

    /** Remove the operator's override; the subscription or workspace decides again. */
    @DeleteMapping("/workspaces/{tenantId}/companies/{companyId}/entitlements/{moduleKey}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.entitlement.manage')")
    @Transactional
    public Map<String, Object> clearEntitlement(@PathVariable UUID tenantId, @PathVariable UUID companyId,
                                                @PathVariable String moduleKey,
                                                @RequestParam(required = false) String reason,
                                                @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        // Same rule as switching a product on or off: every manual change says why
        if (reason == null || reason.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "reason is required");
        }
        directory.requireCompany(tenantId, companyId);
        Operator op = Operator.of(jwt);
        boolean cleared = entitlements.clearManual(companyId, moduleKey);
        if (cleared) {
            audit.recordInTransaction(op, http, "ENTITLEMENT_OVERRIDE_CLEARED", "company", companyId,
                    "Workspace %s company %s: manual %s override removed. Reason: %s"
                            .formatted(tenantId, companyId, moduleKey, reason.strip()));
        }
        return Map.of("cleared", cleared, "effective", entitlements.resolve(tenantId, companyId, moduleKey));
    }
}
