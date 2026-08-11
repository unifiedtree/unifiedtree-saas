package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Statutory return file generators. Wave 5 (2026-08-11).
 *
 * <p>Ships EPFO ECR only. TDS 24Q + ESI + PT deferred.
 *
 * <p>Auth: reuses {@code payroll.runs.read} — anyone who can view the run
 * can generate its statutory files. Real client deployments will want a
 * dedicated permission (e.g. {@code payroll.statutory.generate}) so ECR
 * files aren't casually downloaded — reserve for a later refinement.
 */
@RestController
@RequestMapping("/v1/payroll/statutory")
public class StatutoryFileController {

    private final StatutoryFileService service;

    public StatutoryFileController(StatutoryFileService service) {
        this.service = service;
    }

    @GetMapping(value = "/pf/ecr", produces = "text/plain")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public ResponseEntity<byte[]> pfEcr(@RequestParam UUID runId) {
        byte[] bytes = service.generatePfEcr(TenantContext.getTenantId(), runId);
        String filename = "pf-ecr-" + runId + ".txt";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.TEXT_PLAIN)
                .body(bytes);
    }
}
