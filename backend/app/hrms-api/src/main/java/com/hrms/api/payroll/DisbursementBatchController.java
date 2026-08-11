package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Payroll disbursement batches — POST → NEFT file download → Mark Paid.
 * Wave 2 (2026-08-11).
 *
 * <ul>
 *   <li>Read → {@code hrms.disbursement.read}</li>
 *   <li>Build/generate/post → {@code hrms.disbursement.build}</li>
 *   <li>Mark Paid / Cancel  → {@code hrms.disbursement.post}</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/payroll/disbursement/batches")
public class DisbursementBatchController {

    private final DisbursementBatchService service;

    public DisbursementBatchController(DisbursementBatchService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hrms.disbursement.read')")
    public List<DisbursementBatchService.BatchDto> list(
            @RequestParam(required = false) UUID runId,
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) String status) {
        return service.list(TenantContext.getTenantId(), runId, companyId, status);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.disbursement.read')")
    public DisbursementBatchService.BatchDetailDto get(@PathVariable UUID id) {
        return service.get(TenantContext.getTenantId(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.disbursement.build')")
    public DisbursementBatchService.BatchDetailDto build(
            @Valid @RequestBody DisbursementBatchService.BuildBatchRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.buildFromRun(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @PostMapping("/{id}/post")
    @PreAuthorize("hasAuthority('hrms.disbursement.build')")
    public DisbursementBatchService.BatchDto post(@PathVariable UUID id,
                                                 @AuthenticationPrincipal Jwt jwt) {
        return service.post(TenantContext.getTenantId(), id, actorId(jwt));
    }

    /** Downloads the NEFT/RTGS CSV. Also flips DRAFT→POSTED so the operator
     *  can't accidentally download twice from different UI paths without
     *  the batch reflecting that a file exists. */
    @GetMapping("/{id}/file")
    @PreAuthorize("hasAuthority('hrms.disbursement.build')")
    public ResponseEntity<byte[]> downloadFile(@PathVariable UUID id,
                                              @AuthenticationPrincipal Jwt jwt) {
        service.post(TenantContext.getTenantId(), id, actorId(jwt));  // side-effect: mark posted
        byte[] bytes = service.generateNeftFile(TenantContext.getTenantId(), id);
        String filename = "payroll-batch-" + id + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(bytes);
    }

    @PostMapping("/{id}/mark-paid")
    @PreAuthorize("hasAuthority('hrms.disbursement.post')")
    public DisbursementBatchService.BatchDto markPaid(
            @PathVariable UUID id,
            @Valid @RequestBody DisbursementBatchService.MarkPaidRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.markPaid(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('hrms.disbursement.post')")
    public DisbursementBatchService.BatchDto cancel(@PathVariable UUID id,
                                                   @AuthenticationPrincipal Jwt jwt) {
        return service.cancel(TenantContext.getTenantId(), id, actorId(jwt));
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
