package com.hrms.api.payroll;

import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Salary Structure page actions that work on many people at once:
 * <ul>
 *   <li><b>Bulk revise CTC</b> — options, preview and apply
 *       ({@code payroll.structure.bulk-revise}, a high-risk permission).</li>
 *   <li><b>Export</b> — every current structure with its components
 *       ({@code payroll.structure.read}, the permission that already lets a
 *       person read any single structure).</li>
 * </ul>
 * Every applied revision and every export is written to the audit log.
 */
@RestController
@RequestMapping("/v1/payroll/structures")
public class SalaryStructureBulkController {

    private static final Logger log = LoggerFactory.getLogger(SalaryStructureBulkController.class);

    private final SalaryBulkRevisionService revisions;
    private final SalaryStructureExportService exports;
    private final AuditService audit;

    public SalaryStructureBulkController(SalaryBulkRevisionService revisions, SalaryStructureExportService exports,
                                         AuditService audit) {
        this.revisions = revisions;
        this.exports = exports;
        this.audit = audit;
    }

    @GetMapping("/bulk-revise/options")
    @PreAuthorize("hasAuthority('payroll.structure.bulk-revise')")
    public SalaryBulkRevisionService.OptionsDto options() {
        return revisions.options(TenantContext.getTenantId());
    }

    @PostMapping("/bulk-revise/preview")
    @PreAuthorize("hasAuthority('payroll.structure.bulk-revise')")
    public SalaryBulkRevisionService.PreviewDto preview(@RequestBody SalaryBulkRevisionService.BulkReviseRequest req) {
        return revisions.preview(TenantContext.getTenantId(), req);
    }

    @PostMapping("/bulk-revise")
    @PreAuthorize("hasAuthority('payroll.structure.bulk-revise')")
    public SalaryBulkRevisionService.ApplyResultDto apply(@RequestBody SalaryBulkRevisionService.BulkReviseRequest req,
                                                          @AuthenticationPrincipal Jwt jwt) {
        SalaryBulkRevisionService.ApplyResultDto result =
                revisions.apply(TenantContext.getTenantId(), req, TenantContext.getUserId(), employeeId(jwt));
        // Committed: now the audit trail (its own transactions, so it can never undo the revision).
        try {
            String reason = req.reason() == null ? "" : req.reason().trim();
            audit.record("payroll", "SALARY_BULK_REVISION", "salary_revision_batch", result.batchId(),
                    "Bulk salary revision %s for %d %s, effective %s. Annual CTC %s → %s. Reason: %s".formatted(
                            result.change(), result.applied(), result.applied() == 1 ? "person" : "people",
                            SalaryRevisionPlanner.day(java.time.LocalDate.parse(result.effectiveFrom())),
                            SalaryRevisionPlanner.rupees(result.totalOldCtc()), SalaryRevisionPlanner.rupees(result.totalNewCtc()), reason));
            for (SalaryBulkRevisionService.AppliedDto a : result.structures()) {
                audit.record("payroll", "SALARY_REVISED", "salary_structure", a.structureId(),
                        "%s (%s): annual CTC %s → %s (%s), effective %s. Bulk revision %s. Reason: %s".formatted(
                                a.name(), a.employeeCode(), SalaryRevisionPlanner.rupees(a.oldCtc()), SalaryRevisionPlanner.rupees(a.newCtc()),
                                result.change(), SalaryRevisionPlanner.day(java.time.LocalDate.parse(result.effectiveFrom())),
                                result.batchId(), reason));
            }
        } catch (Exception ex) {
            log.warn("Audit for bulk salary revision {} failed: {}", result.batchId(), ex.getMessage());
        }
        return result;
    }

    /** Every current salary structure: JSON (default) or {@code ?format=csv}. */
    @GetMapping("/export")
    @PreAuthorize("hasAuthority('payroll.structure.read')")
    public ResponseEntity<?> export(@RequestParam(defaultValue = "json") String format) {
        SalaryStructureExportService.ExportDto data = exports.export(TenantContext.getTenantId());
        try {
            audit.record("payroll", "SALARY_STRUCTURES_EXPORTED", "salary_structure", null,
                    "Exported %d salary %s (%s)".formatted(data.rows().size(), data.rows().size() == 1 ? "structure" : "structures",
                            "csv".equalsIgnoreCase(format) ? "CSV" : "Excel"));
        } catch (Exception ex) {
            log.warn("Audit for salary structure export failed: {}", ex.getMessage());
        }
        if ("csv".equalsIgnoreCase(format)) {
            byte[] body = ("﻿" + SalaryStructureExportService.csv(data)).getBytes(StandardCharsets.UTF_8);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"salary-structures-" + data.generatedOn() + ".csv\"")
                    .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                    .body(body);
        }
        return ResponseEntity.ok(data);
    }

    private static UUID employeeId(Jwt jwt) {
        if (jwt == null) return null;
        String id = jwt.getClaimAsString("employee_id");
        try {
            return id == null ? null : UUID.fromString(id);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }
}
