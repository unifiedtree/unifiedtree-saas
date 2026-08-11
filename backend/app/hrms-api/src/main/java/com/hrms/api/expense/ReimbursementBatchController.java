package com.hrms.api.expense;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Reimbursement batches — Finance's monthly payout pipeline for expenses.
 * Wave 3 (2026-08-11). Mirrors the DisbursementBatchController shape used
 * for payroll so the mental model transfers between the two flows.
 *
 * <ul>
 *   <li>Read → {@code hrms.reimb_batch.read}</li>
 *   <li>Build/post → {@code hrms.reimb_batch.build}</li>
 *   <li>Mark Paid / Cancel → {@code hrms.reimb_batch.post}</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/expense/reimbursement-batches")
public class ReimbursementBatchController {

    private final ReimbursementBatchService service;

    public ReimbursementBatchController(ReimbursementBatchService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hrms.reimb_batch.read')")
    public List<ReimbursementBatchService.BatchDto> list(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) String status) {
        return service.list(TenantContext.getTenantId(), companyId, status);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.reimb_batch.read')")
    public ReimbursementBatchService.BatchDetailDto get(@PathVariable UUID id) {
        return service.get(TenantContext.getTenantId(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.reimb_batch.build')")
    public ReimbursementBatchService.BatchDetailDto build(
            @Valid @RequestBody ReimbursementBatchService.BuildBatchRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.build(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @PostMapping("/{id}/post")
    @PreAuthorize("hasAuthority('hrms.reimb_batch.build')")
    public ReimbursementBatchService.BatchDto post(@PathVariable UUID id,
                                                  @AuthenticationPrincipal Jwt jwt) {
        return service.post(TenantContext.getTenantId(), id, actorId(jwt));
    }

    @PostMapping("/{id}/mark-paid")
    @PreAuthorize("hasAuthority('hrms.reimb_batch.post')")
    public ReimbursementBatchService.BatchDto markPaid(
            @PathVariable UUID id,
            @Valid @RequestBody ReimbursementBatchService.MarkPaidRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.markPaid(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('hrms.reimb_batch.post')")
    public ReimbursementBatchService.BatchDto cancel(@PathVariable UUID id,
                                                    @AuthenticationPrincipal Jwt jwt) {
        return service.cancel(TenantContext.getTenantId(), id, actorId(jwt));
    }

    /** Companion to cancel — releases APPROVED_FOR_PAY claims back to APPROVED. */
    @PostMapping("/{id}/revert-claims")
    @PreAuthorize("hasAuthority('hrms.reimb_batch.post')")
    public Map<String, Object> revertClaims(@PathVariable UUID id,
                                           @AuthenticationPrincipal Jwt jwt) {
        int n = service.revertClaimsToApproved(TenantContext.getTenantId(), id, actorId(jwt));
        return Map.of("claimsReverted", n);
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
