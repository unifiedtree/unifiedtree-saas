package com.unifiedtree.saas.admin.billing;

import com.unifiedtree.saas.admin.billing.InvoiceService.DraftInput;
import com.unifiedtree.saas.admin.billing.InvoiceService.Invoice;
import com.unifiedtree.saas.admin.billing.PlatformBillingService.BillingProfile;
import com.unifiedtree.saas.admin.billing.PlatformBillingService.BillingSettings;
import com.unifiedtree.saas.admin.billing.PlatformBillingService.PaymentRow;
import com.unifiedtree.saas.admin.billing.PlatformBillingService.SubscriptionRow;
import com.unifiedtree.saas.admin.support.Operator;
import com.unifiedtree.saas.admin.support.PageResult;
import com.unifiedtree.saas.admin.support.PlatformAuditTrail;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Subscriptions, payments, invoices, billing profiles and settings for the admin console. */
@RestController
@RequestMapping("/v1/platform/admin")
public class PlatformBillingController {

    private final PlatformBillingService billing;
    private final InvoiceService invoices;
    private final PlatformAuditTrail audit;

    public PlatformBillingController(PlatformBillingService billing, InvoiceService invoices,
                                     PlatformAuditTrail audit) {
        this.billing = billing;
        this.invoices = invoices;
        this.audit = audit;
    }

    public record VoidRequest(@NotBlank String reason) {}

    @GetMapping("/subscriptions")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.subscription.read')")
    public PageResult<SubscriptionRow> subscriptions(@RequestParam(required = false) UUID tenantId,
                                                     @RequestParam(required = false) UUID companyId,
                                                     @RequestParam(required = false) String status,
                                                     @RequestParam(required = false) String planKey,
                                                     @RequestParam(required = false) Integer page,
                                                     @RequestParam(required = false) Integer size) {
        return billing.subscriptions(tenantId, companyId, status, planKey, PageResult.page(page), PageResult.size(size));
    }

    @GetMapping("/payments")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.read')")
    public PageResult<PaymentRow> payments(@RequestParam(required = false) UUID tenantId,
                                           @RequestParam(required = false) String status,
                                           @RequestParam(required = false) Integer page,
                                           @RequestParam(required = false) Integer size) {
        return billing.payments(tenantId, status, PageResult.page(page), PageResult.size(size));
    }

    // ── Invoices ────────────────────────────────────────────────────────────

    @GetMapping("/invoices")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.read')")
    public PageResult<Invoice> invoices(@RequestParam(required = false) UUID tenantId,
                                        @RequestParam(required = false) UUID companyId,
                                        @RequestParam(required = false) String status,
                                        @RequestParam(required = false) Integer page,
                                        @RequestParam(required = false) Integer size) {
        return invoices.list(tenantId, companyId, status, PageResult.page(page), PageResult.size(size));
    }

    @GetMapping("/invoices/{id}")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.read')")
    public Invoice invoice(@PathVariable UUID id) {
        return invoices.get(id);
    }

    @PostMapping("/invoices")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.manage')")
    public Invoice createDraft(@RequestBody DraftInput body, @AuthenticationPrincipal Jwt jwt,
                               HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        Invoice draft = invoices.createDraft(body, op.label());
        audit.record(op, http, "INVOICE_DRAFTED", "invoice", draft.id(),
                "Draft invoice for workspace %s total %s".formatted(draft.tenantId(), draft.total()));
        return draft;
    }

    @PostMapping("/payments/{paymentId}/invoice")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.manage')")
    public Invoice draftFromPayment(@PathVariable UUID paymentId, @AuthenticationPrincipal Jwt jwt,
                                    HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        Invoice draft = invoices.draftFromPayment(paymentId, op.label());
        audit.record(op, http, "INVOICE_DRAFTED", "invoice", draft.id(),
                "Draft invoice from payment %s total %s".formatted(paymentId, draft.total()));
        return draft;
    }

    @PostMapping("/invoices/{id}/issue")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.manage')")
    public Invoice issue(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        Invoice issued = invoices.issue(id);
        audit.record(op, http, "INVOICE_ISSUED", "invoice", id,
                "Issued %s (%s) total %s".formatted(issued.invoiceNumber(), issued.status(), issued.total()));
        return issued;
    }

    @PostMapping("/invoices/{id}/void")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.manage')")
    public Invoice voidInvoice(@PathVariable UUID id, @RequestBody VoidRequest body,
                               @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        Invoice voided = invoices.voidInvoice(id, body.reason());
        audit.record(op, http, "INVOICE_VOIDED", "invoice", id,
                "Voided %s. Reason: %s".formatted(voided.invoiceNumber(), body.reason().strip()));
        return voided;
    }

    // ── Billing profiles and settings ───────────────────────────────────────

    @GetMapping("/workspaces/{tenantId}/companies/{companyId}/billing-profile")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.read')")
    public BillingProfile billingProfile(@PathVariable UUID tenantId, @PathVariable UUID companyId) {
        return billing.billingProfile(tenantId, companyId);
    }

    @PutMapping("/workspaces/{tenantId}/companies/{companyId}/billing-profile")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.manage')")
    public BillingProfile saveBillingProfile(@PathVariable UUID tenantId, @PathVariable UUID companyId,
                                             @RequestBody BillingProfile body, @AuthenticationPrincipal Jwt jwt,
                                             HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        BillingProfile saved = billing.saveBillingProfile(tenantId, companyId, body, op.label());
        audit.record(op, http, "BILLING_PROFILE_UPDATED", "company", companyId,
                "Billing profile of company %s in workspace %s updated".formatted(companyId, tenantId));
        return saved;
    }

    @GetMapping("/settings/billing")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.read')")
    public BillingSettings settings() {
        return billing.settings();
    }

    @PutMapping("/settings/billing")
    @PreAuthorize("@platformAdmin.check(authentication) and hasAuthority('platform.billing.manage')")
    public BillingSettings saveSettings(@RequestBody BillingSettings body, @AuthenticationPrincipal Jwt jwt,
                                        HttpServletRequest http) {
        Operator op = Operator.of(jwt);
        BillingSettings saved = billing.saveSettings(body);
        audit.record(op, http, "BILLING_SETTINGS_UPDATED", "billing_settings", null,
                "Seller/invoice settings updated (prefix %s, GST %s%%, due %d days)".formatted(
                        saved.invoicePrefix(), saved.defaultGstRatePct(), saved.invoiceDueDays()));
        return saved;
    }
}
