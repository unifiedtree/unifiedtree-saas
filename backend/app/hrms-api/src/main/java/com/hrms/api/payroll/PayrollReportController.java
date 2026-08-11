package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Payroll printable reports. Wave 4 (2026-08-11). Ships Salary Register PDF
 * only; Tax / PF-ESI / Variance / xlsx export deferred.
 *
 * <p>Auth: reuses {@code payroll.runs.read} — anyone who can view a run
 * can print its report.
 */
@RestController
@RequestMapping("/v1/payroll/reports")
public class PayrollReportController {

    private final PayrollReportService service;

    public PayrollReportController(PayrollReportService service) {
        this.service = service;
    }

    @GetMapping("/salary-register")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public ResponseEntity<byte[]> salaryRegister(@RequestParam UUID runId) {
        byte[] pdf = service.salaryRegisterPdf(TenantContext.getTenantId(), runId);
        String filename = "salary-register-" + runId + ".pdf";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }
}
