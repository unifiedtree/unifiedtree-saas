package com.hrms.api.letters;

import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import com.hrms.letters.domain.DistributionJob;
import com.hrms.letters.domain.DistributionRecipient;
import com.hrms.letters.domain.LetterTemplate;
import com.hrms.letters.dto.GenerateLetterRequest;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.hrms.letters.repository.DistributionJobRepository;
import com.hrms.letters.repository.DistributionRecipientRepository;
import com.hrms.letters.repository.LetterTemplateRepository;
import com.hrms.letters.service.LetterEmailService;
import com.hrms.letters.service.LetterGenerationService;
import com.unifiedtree.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Async worker for bulk letter distribution. Separate bean (not a method on the
 * service) so Spring's @Async proxy is honored — mirrors InvitationEmailSender.
 *
 * <p>Per recipient it renders a PERSONALIZED letter (reusing
 * {@link LetterGenerationService#generate}), fetches that recipient's PDF, and
 * emails it with a distribution wrapper. Each recipient + the job status are
 * saved in their own short transactions so the detail page can poll live
 * progress and partial failures are isolated.
 */
@Component
public class LetterDistributionProcessor {

    private static final Logger log = LoggerFactory.getLogger(LetterDistributionProcessor.class);

    private final LetterGenerationService generationService;
    private final LetterEmailService emailService;
    private final LetterTemplateRepository templateRepo;
    private final WorkforceEmployeeRepository employeeRepo;
    private final DistributionJobRepository jobRepo;
    private final DistributionRecipientRepository recipientRepo;
    private final AuditService auditService;

    public LetterDistributionProcessor(LetterGenerationService generationService,
                                       LetterEmailService emailService,
                                       LetterTemplateRepository templateRepo,
                                       WorkforceEmployeeRepository employeeRepo,
                                       DistributionJobRepository jobRepo,
                                       DistributionRecipientRepository recipientRepo,
                                       AuditService auditService) {
        this.generationService = generationService;
        this.emailService = emailService;
        this.templateRepo = templateRepo;
        this.employeeRepo = employeeRepo;
        this.jobRepo = jobRepo;
        this.recipientRepo = recipientRepo;
        this.auditService = auditService;
    }

    @Async("letterDistributionExecutor")
    public void process(UUID jobId, UUID tenantId, UUID actorUserId) {
        // Re-bind tenant on this pool thread (ThreadLocals do not cross the pool
        // boundary). shared-security TenantContext drives TenantAwareDataSource's
        // SET LOCAL app.tenant_id (RLS) and AuditService; hrms-core TenantContext
        // drives BaseEntity @PrePersist on the GeneratedLetter inserts.
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        if (actorUserId != null) {
            com.unifiedtree.security.tenant.TenantContext.setUserId(actorUserId);
        }
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        try {
            processInternal(jobId);
        } catch (Exception e) {
            log.error("Distribution job {} processing failed", jobId, e);
        } finally {
            com.unifiedtree.security.tenant.TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    private void processInternal(UUID jobId) {
        DistributionJob job = jobRepo.findById(jobId).orElse(null);
        if (job == null) {
            log.warn("Distribution job {} not found — skipping", jobId);
            return;
        }
        job.setStatus("PROCESSING");
        jobRepo.save(job);

        String templateName = templateRepo.findActiveById(job.getTemplateId())
                .map(LetterTemplate::getName).orElse("Letter");

        for (DistributionRecipient r : recipientRepo.findByJobIdAndSendStatus(jobId, "PENDING")) {
            processOne(job, templateName, r);
        }

        // Terminal status from the full recipient set (SKIPPED counts as neither).
        List<DistributionRecipient> all = recipientRepo.findByJobId(jobId);
        int sent   = (int) all.stream().filter(x -> "SENT".equals(x.getSendStatus())).count();
        int failed = (int) all.stream().filter(x -> "FAILED".equals(x.getSendStatus())).count();
        job.setSentCount(sent);
        job.setFailedCount(failed);
        job.setStatus(failed == 0 ? "COMPLETED" : (sent == 0 ? "FAILED" : "PARTIAL_FAILURE"));
        job.setCompletedAt(Instant.now());
        jobRepo.save(job);
        log.info("Distribution job {} done: status={} sent={} failed={}",
                jobId, job.getStatus(), sent, failed);
    }

    private void processOne(DistributionJob job, String templateName, DistributionRecipient r) {
        r.setSendStatus("GENERATING");
        r.setSendAttemptedAt(Instant.now());
        recipientRepo.save(r);
        try {
            WorkforceEmployee emp = employeeRepo.findById(r.getEmployeeId())
                    .orElseThrow(() -> new IllegalStateException("Employee not found: " + r.getEmployeeId()));
            // Personalized render + PDF + persisted generated_letter for THIS employee.
            GeneratedLetterDto gen = generationService.generate(
                    new GenerateLetterRequest(job.getTemplateId(), r.getEmployeeId(), null, false, null),
                    job.getCreatedBy());
            byte[] pdf = generationService.getPdf(gen.id());
            emailService.send(r.getEmail(), null,
                    buildSubject(job, emp), buildEmailHtml(job, emp), pdf, buildFilename(templateName, emp));
            r.setGeneratedLetterId(gen.id());
            r.setSendStatus("SENT");
            r.setSentAt(Instant.now());
            r.setErrorMessage(null);
            recipientRepo.save(r);
            safeAudit("DISTRIBUTION_SENT", r.getId(), "Sent '" + job.getTitle() + "' to " + r.getEmail());
        } catch (Exception e) {
            String msg = truncate(rootMessage(e));
            r.setSendStatus("FAILED");
            r.setErrorMessage(msg);
            recipientRepo.save(r);
            log.warn("Distribution send failed: job={} recipient={} err={}", job.getId(), r.getId(), msg);
            safeAudit("DISTRIBUTION_SEND_FAILED", r.getId(),
                    "Failed to send '" + job.getTitle() + "' to " + r.getEmail() + ": " + msg);
        }
    }

    private void safeAudit(String action, UUID entityId, String summary) {
        // Best-effort: an audit write failure (e.g. the platform audit.events
        // inet/varchar mapping bug) must never flip a SENT recipient to FAILED.
        try {
            auditService.record("letters", action, "distribution_recipient", entityId, summary);
        } catch (Exception ignore) {
            // swallow
        }
    }

    private String buildSubject(DistributionJob job, WorkforceEmployee emp) {
        if (job.getSubjectOverride() != null && !job.getSubjectOverride().isBlank()) {
            return job.getSubjectOverride();
        }
        return safeFirst(emp) + ", you have a new document";
    }

    private String buildEmailHtml(DistributionJob job, WorkforceEmployee emp) {
        // customMessage is authored by a trusted HR admin and inserted as HTML so
        // rich-text formatting survives. Full HTML sanitization (jsoup) is a
        // follow-up if authoring is ever opened to less-trusted roles.
        String message = job.getCustomMessage() != null ? job.getCustomMessage() : "";
        return ("""
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">
                  <p>Hi %s,</p>
                  <div>%s</div>
                  <p>Please find your document attached.</p>
                  <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
                  <p style="font-size:12px;color:#64748b">This is an automated message.</p>
                </div>
                """).formatted(escapeHtml(safeFirst(emp)), message);
    }

    private String buildFilename(String templateName, WorkforceEmployee emp) {
        String base = templateName + "_" + nz(emp.getFirstName()) + "_" + nz(emp.getLastName());
        return base.replaceAll("[^A-Za-z0-9_-]", "_") + ".pdf";
    }

    private static String safeFirst(WorkforceEmployee emp) {
        return (emp.getFirstName() != null && !emp.getFirstName().isBlank()) ? emp.getFirstName() : "there";
    }
    private static String nz(String s) { return s == null ? "" : s; }
    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
    private static String rootMessage(Throwable e) {
        Throwable c = e;
        while (c.getCause() != null && c.getCause() != c) c = c.getCause();
        return c.getMessage() != null ? c.getMessage() : c.getClass().getSimpleName();
    }
    private static String truncate(String s) {
        if (s == null) return null;
        return s.length() > 1000 ? s.substring(0, 1000) : s;
    }
}
