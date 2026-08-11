package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Bank profiles — CRUD for the debit accounts used when generating NEFT/RTGS
 * disbursement batches. Wave 2 (2026-08-11).
 *
 * <ul>
 *   <li>Read → {@code hrms.bank_profile.read}</li>
 *   <li>Manage (create/update/delete) → {@code hrms.bank_profile.manage}</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/payroll/bank-profiles")
public class BankProfileController {

    private final BankProfileService service;

    public BankProfileController(BankProfileService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hrms.bank_profile.read')")
    public List<BankProfileService.BankProfileDto> list(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) Boolean activeOnly) {
        return service.list(TenantContext.getTenantId(), companyId, activeOnly);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.bank_profile.read')")
    public BankProfileService.BankProfileDto get(@PathVariable UUID id) {
        return service.get(TenantContext.getTenantId(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.bank_profile.manage')")
    public BankProfileService.BankProfileDto create(
            @Valid @RequestBody BankProfileService.CreateBankProfileRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.create(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.bank_profile.manage')")
    public BankProfileService.BankProfileDto update(
            @PathVariable UUID id,
            @Valid @RequestBody BankProfileService.UpdateBankProfileRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.update(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.bank_profile.manage')")
    public void delete(@PathVariable UUID id) {
        service.delete(TenantContext.getTenantId(), id);
    }

    /** JWT subject is the account UUID. Null-safe for tests that skip auth. */
    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
