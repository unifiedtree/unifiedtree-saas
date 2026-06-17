package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
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
 * Payroll run lifecycle + payslip endpoints (Prompt 13a).
 *
 * <ul>
 *   <li>Run management (create / process) → {@code payroll.runs.manage}</li>
 *   <li>Lock / reopen → {@code payroll.runs.lock}</li>
 *   <li>Reads (runs, employees, payslips) → {@code payroll.runs.read}</li>
 *   <li>Self-service payslips → {@code payroll.payslip.read.self}</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/payroll")
public class PayrollRunController {

    private final PayrollRunService service;

    public PayrollRunController(PayrollRunService service) {
        this.service = service;
    }

    // ── Runs ──────────────────────────────────────────────────────────────────

    @GetMapping("/runs")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.RunDto> list(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) Integer year,
            @RequestParam(required = false) String status) {
        return service.listRuns(TenantContext.getTenantId(), companyId, year, status);
    }

    @GetMapping("/runs/{id}")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public PayrollRunService.RunDto get(@PathVariable UUID id) {
        return service.getRun(TenantContext.getTenantId(), id);
    }

    @PostMapping("/runs")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('payroll.runs.manage')")
    public PayrollRunService.RunDto create(@RequestBody PayrollRunService.CreateRunRequest req,
                                           @AuthenticationPrincipal Jwt jwt) {
        return service.createDraftRun(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @GetMapping("/runs/{id}/eligible-employees")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.EligibleEmployeeDto> eligible(@PathVariable UUID id) {
        return service.listEligibleEmployees(TenantContext.getTenantId(), id);
    }

    @GetMapping("/runs/{id}/employees")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.RunEmployeeDto> employees(@PathVariable UUID id) {
        return service.listRunEmployees(TenantContext.getTenantId(), id);
    }

    /** Employees skipped during processing for lacking a current salary structure (FIX P1-4). */
    @GetMapping("/runs/{id}/skipped")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.EligibleEmployeeDto> skipped(@PathVariable UUID id) {
        return service.listSkippedEmployees(TenantContext.getTenantId(), id);
    }

    @PostMapping("/runs/{id}/process")
    @PreAuthorize("hasAuthority('payroll.runs.manage')")
    public PayrollRunService.RunDto process(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return service.processRun(TenantContext.getTenantId(), id, actorId(jwt));
    }

    @PostMapping("/runs/{id}/lock")
    @PreAuthorize("hasAuthority('payroll.runs.lock')")
    public PayrollRunService.RunDto lock(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return service.lockRun(TenantContext.getTenantId(), id, actorId(jwt));
    }

    @PostMapping("/runs/{id}/reopen")
    @PreAuthorize("hasAuthority('payroll.runs.lock')")
    public void reopen(@PathVariable UUID id) {
        service.reopenRun(TenantContext.getTenantId(), id);
    }

    // ── Payslips (HR/Finance view) ──────────────────────────────────────────────

    @GetMapping("/runs/{id}/employees/{empId}/payslip")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public PayrollRunService.PayslipDto payslip(@PathVariable UUID id, @PathVariable UUID empId) {
        return service.getPayslip(TenantContext.getTenantId(), id, empId);
    }

    @GetMapping("/runs/{id}/employees/{empId}/payslip.pdf")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public ResponseEntity<byte[]> payslipPdf(@PathVariable UUID id, @PathVariable UUID empId) {
        byte[] pdf = service.generatePayslipPdf(TenantContext.getTenantId(), id, empId);
        return pdfResponse(pdf, "payslip-" + empId + ".pdf");
    }

    // ── Self-service payslips ────────────────────────────────────────────────────

    @GetMapping("/payslips/me")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public List<PayrollRunService.MyPayslipDto> myPayslips(@AuthenticationPrincipal Jwt jwt) {
        return service.listMyPayslips(TenantContext.getTenantId(), employeeId(jwt));
    }

    @GetMapping("/payslips/me/{runId}.pdf")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public ResponseEntity<byte[]> myPayslipPdf(@PathVariable UUID runId, @AuthenticationPrincipal Jwt jwt) {
        byte[] pdf = service.generateMyPayslipPdf(TenantContext.getTenantId(), employeeId(jwt), runId);
        return pdfResponse(pdf, "payslip-" + runId + ".pdf");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static ResponseEntity<byte[]> pdfResponse(byte[] pdf, String filename) {
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .body(pdf);
    }

    private static UUID employeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        return employeeId != null ? UUID.fromString(employeeId) : UUID.fromString(jwt.getSubject());
    }

    private static UUID actorId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (Exception e) {
            String employeeId = jwt.getClaimAsString("employee_id");
            return employeeId != null ? UUID.fromString(employeeId) : null;
        }
    }
}
