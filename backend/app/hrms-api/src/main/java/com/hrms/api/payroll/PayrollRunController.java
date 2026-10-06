package com.hrms.api.payroll;

import com.hrms.api.access.RecordCompanyGuard;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;
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

    /** Company access: a record addressed by id must be in a company the caller may work in (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private RecordCompanyGuard recordGuard;

    /** Company access: an optional companyId left out means the caller's current company, not every company (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private CompanyAccessService companyAccess;

    private final PayrollRunService service;

    /** The audit log (Settings -> Audit logs). Optional, so tests can build the controller bare. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.unifiedtree.audit.AuditService auditService;

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
        companyId = CompanyAccessService.listCompanyId(companyAccess, companyId);
        return service.listRuns(TenantContext.getTenantId(), companyId, year, status);
    }

    @GetMapping("/runs/{id}")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public PayrollRunService.RunDto get(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        return service.getRun(TenantContext.getTenantId(), id);
    }

    @PostMapping("/runs")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('payroll.runs.manage')")
    public PayrollRunService.RunDto create(@Valid @RequestBody PayrollRunService.CreateRunRequest req,
                                           @AuthenticationPrincipal Jwt jwt) {
        PayrollRunService.RunDto run = service.createDraftRun(TenantContext.getTenantId(), req, actorId(jwt));
        audit("CREATE", run, "Created", null);
        return run;
    }

    @GetMapping("/runs/{id}/eligible-employees")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.EligibleEmployeeDto> eligible(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        return service.listEligibleEmployees(TenantContext.getTenantId(), id);
    }

    @GetMapping("/runs/{id}/employees")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.RunEmployeeDto> employees(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        return service.listRunEmployees(TenantContext.getTenantId(), id);
    }

    /** Employees skipped during processing for lacking a current salary structure (FIX P1-4). */
    @GetMapping("/runs/{id}/skipped")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.EligibleEmployeeDto> skipped(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        return service.listSkippedEmployees(TenantContext.getTenantId(), id);
    }

    /** Totals per salary component across the run's payslips (any run size). */
    @GetMapping("/runs/{id}/component-totals")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.ComponentTotalDto> componentTotals(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        return service.componentTotals(TenantContext.getTenantId(), id);
    }

    /**
     * PF, ESI, PT and LWF owed per month, added up from locked and paid runs,
     * with the matching Compliance → Statutory Filings entry when there is one.
     */
    @GetMapping("/statutory-dues")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public List<PayrollRunService.StatutoryDueDto> statutoryDues(@RequestParam(defaultValue = "3") int months) {
        return service.statutoryDues(TenantContext.getTenantId(), months);
    }

    @PostMapping("/runs/{id}/process")
    @PreAuthorize("hasAuthority('payroll.runs.manage')")
    public PayrollRunService.RunDto process(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        PayrollRunService.RunDto run = service.processRun(TenantContext.getTenantId(), id, actorId(jwt));
        audit("PAYROLL_PROCESSED", run, "Processed", null);
        return run;
    }

    @PostMapping("/runs/{id}/lock")
    @PreAuthorize("hasAuthority('payroll.runs.lock')")
    public PayrollRunService.RunDto lock(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        PayrollRunService.RunDto run = service.lockRun(TenantContext.getTenantId(), id, actorId(jwt));
        audit("PAYROLL_LOCKED", run, "Locked", null);
        return run;
    }

    /**
     * Reopen a LOCKED run to DRAFT. Wave 6 (2026-08-11): controlled reopen
     * with a mandatory reason (audited into runs.notes). PAID runs cannot
     * be reopened — see the service for the exact guard.
     */
    @PostMapping("/runs/{id}/reopen")
    @PreAuthorize("hasAuthority('payroll.runs.lock')")
    public PayrollRunService.RunDto reopen(@PathVariable UUID id,
                                          @jakarta.validation.Valid @RequestBody ReopenRequest req,
                                          @AuthenticationPrincipal Jwt jwt) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        PayrollRunService.RunDto run = service.reopenRun(TenantContext.getTenantId(), id, req.reason(), actorId(jwt));
        audit("PAYROLL_REOPENED", run, "Reopened", "Reason: " + req.reason().trim());
        return run;
    }

    /**
     * One audit row for a run that changed: "Created the Nov 2026 payroll run
     * for Acme Pvt Ltd". Best effort: the change is already saved, and the
     * audit service swallows its own write errors.
     */
    private void audit(String action, PayrollRunService.RunDto run, String verb, String note) {
        if (auditService == null || run == null) return;
        try {
            String period = java.time.Month.of(run.periodMonth())
                    .getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH) + " " + run.periodYear();
            String company = run.companyName() == null || run.companyName().isBlank() ? "" : " for " + run.companyName();
            auditService.record("payroll", action, "PAYROLL_RUN", run.id(),
                    verb + " the " + period + " payroll run" + company + (note == null ? "" : ". " + note));
        } catch (RuntimeException e) {
            // Never fails the request.
        }
    }

    public record ReopenRequest(
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 500) String reason) {}

    // ── Payslips (HR/Finance view) ──────────────────────────────────────────────

    @GetMapping("/runs/{id}/employees/{empId}/payslip")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public PayrollRunService.PayslipDto payslip(@PathVariable UUID id, @PathVariable UUID empId) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        return service.getPayslip(TenantContext.getTenantId(), id, empId);
    }

    @GetMapping("/runs/{id}/employees/{empId}/payslip.pdf")
    @PreAuthorize("hasAuthority('payroll.runs.read')")
    public ResponseEntity<byte[]> payslipPdf(@PathVariable UUID id, @PathVariable UUID empId) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.PAYROLL_RUN, id);
        byte[] pdf = service.generatePayslipPdf(TenantContext.getTenantId(), id, empId);
        return pdfResponse(pdf, "payslip-" + empId + ".pdf");
    }

    /**
     * The payslip template with example figures and the workspace's letterhead (Settings → Branding
     * shows it beside the letterhead upload). Payroll readers and whoever may change the branding.
     */
    @GetMapping("/payslips/template-preview")
    @PreAuthorize("hasAnyAuthority('payroll.runs.read','settings.branding.write')")
    public PayslipTemplatePreview payslipTemplatePreview(@RequestParam(required = false) UUID companyId) {
        return new PayslipTemplatePreview(service.payslipTemplatePreview(TenantContext.getTenantId(), companyId));
    }

    public record PayslipTemplatePreview(String html) {}

    // ── Self-service payslips ────────────────────────────────────────────────────

    @GetMapping("/payslips/me")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public List<PayrollRunService.MyPayslipDto> myPayslips(@AuthenticationPrincipal Jwt jwt) {
        return service.listMyPayslips(TenantContext.getTenantId(), employeeId(jwt));
    }

    /**
     * The caller's own payslip lines for one locked or paid run. Always the
     * caller's own: another person's run, or a run with no payslip for the
     * caller, is a 404.
     */
    @GetMapping("/payslips/me/{runId}")
    @PreAuthorize("hasAuthority('payroll.payslip.read.self')")
    public PayrollRunService.PayslipDto myPayslip(@PathVariable UUID runId, @AuthenticationPrincipal Jwt jwt) {
        return service.getMyPayslip(TenantContext.getTenantId(), ownEmployeeId(jwt), runId);
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

    /** The caller's employee id from the token; null for an account with no employee record. */
    private static UUID ownEmployeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        try {
            return employeeId == null || employeeId.isBlank() ? null : UUID.fromString(employeeId);
        } catch (IllegalArgumentException e) {
            return null;
        }
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
