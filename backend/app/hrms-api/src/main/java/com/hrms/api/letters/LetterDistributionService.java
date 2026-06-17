package com.hrms.api.letters;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import com.hrms.letters.domain.DistributionJob;
import com.hrms.letters.domain.DistributionRecipient;
import com.hrms.letters.dto.CreateDistributionRequest;
import com.hrms.letters.dto.DistributionJobDto;
import com.hrms.letters.dto.RecipientFilter;
import com.hrms.letters.repository.DistributionJobRepository;
import com.hrms.letters.repository.DistributionRecipientRepository;
import com.hrms.letters.repository.LetterTemplateRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Bulk letter distribution: synchronous job + recipient-row creation (recipients
 * snapshotted at creation time), then async per-recipient generate + email.
 * Mirrors InvitationService's sync-create + afterCommit + @Async dispatch.
 */
@Service
public class LetterDistributionService {

    static final int MAX_RECIPIENTS = 500;

    private final DistributionJobRepository jobRepo;
    private final DistributionRecipientRepository recipientRepo;
    private final LetterTemplateRepository templateRepo;
    private final WorkforceEmployeeRepository employeeRepo;
    private final LetterDistributionProcessor processor;
    private final AuditService auditService;

    public LetterDistributionService(DistributionJobRepository jobRepo,
                                     DistributionRecipientRepository recipientRepo,
                                     LetterTemplateRepository templateRepo,
                                     WorkforceEmployeeRepository employeeRepo,
                                     LetterDistributionProcessor processor,
                                     AuditService auditService) {
        this.jobRepo = jobRepo;
        this.recipientRepo = recipientRepo;
        this.templateRepo = templateRepo;
        this.employeeRepo = employeeRepo;
        this.processor = processor;
        this.auditService = auditService;
    }

    @Transactional
    public DistributionJobDto createDistribution(CreateDistributionRequest req, UUID createdBy) {
        templateRepo.findActiveById(req.templateId())
                .orElseThrow(() -> new HrmsException("Letter template not found: " + req.templateId(),
                        HttpStatus.BAD_REQUEST, "TEMPLATE_NOT_FOUND"));
        UUID tenantId = TenantContext.requireTenantId();

        List<WorkforceEmployee> employees = resolveRecipients(req.recipientFilter());
        if (employees.isEmpty()) {
            throw new HrmsException("No employees match the selected recipients",
                    HttpStatus.BAD_REQUEST, "NO_RECIPIENTS");
        }
        if (employees.size() > MAX_RECIPIENTS) {
            throw new HrmsException("This distribution targets " + employees.size() + " employees, over the "
                    + MAX_RECIPIENTS + " per-job cap. Split it into multiple jobs.",
                    HttpStatus.BAD_REQUEST, "TOO_MANY_RECIPIENTS");
        }

        DistributionJob job = new DistributionJob();
        job.setTenantId(tenantId);
        job.setTemplateId(req.templateId());
        job.setTitle(req.title());
        job.setCustomMessage(req.customMessage());
        job.setSubjectOverride(req.subjectOverride());
        job.setCreatedBy(createdBy);
        job.setStatus("PENDING");

        List<DistributionRecipient> recipients = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        int sendable = 0;
        for (WorkforceEmployee e : employees) {
            if (!seen.add(e.getId())) continue; // de-dupe (UNIQUE job_id, employee_id)
            DistributionRecipient r = new DistributionRecipient();
            r.setTenantId(tenantId);
            r.setEmployeeId(e.getId());
            String email = e.getEmail();
            if (email == null || email.isBlank()) {
                r.setEmail("");
                r.setSendStatus("SKIPPED");
                r.setErrorMessage("No email address on file");
            } else {
                r.setEmail(email);
                r.setSendStatus("PENDING");
                sendable++;
            }
            recipients.add(r);
        }
        job.setTotalRecipients(recipients.size());
        jobRepo.save(job);
        UUID jobId = job.getId();
        recipients.forEach(r -> r.setJobId(jobId));
        recipientRepo.saveAll(recipients);

        // Audit is best-effort: a failure here (e.g. the platform audit.events
        // inet/varchar mapping bug) must never roll back the distribution.
        try {
            auditService.record("letters", "DISTRIBUTION_CREATED", "distribution_job", jobId,
                    "Created distribution '" + job.getTitle() + "': " + recipients.size()
                            + " recipients (" + sendable + " sendable)");
        } catch (Exception ignore) {
            // swallow — distribution creation succeeds regardless of audit write
        }

        // Fire async processing only after commit, so the worker sees the rows.
        fireAsync(jobId, tenantId, createdBy);
        return DistributionJobDto.summary(job);
    }

    @Transactional
    public int retryFailed(UUID jobId) {
        DistributionJob job = jobRepo.findById(jobId)
                .orElseThrow(() -> new HrmsException("Distribution not found: " + jobId,
                        HttpStatus.NOT_FOUND, "DISTRIBUTION_NOT_FOUND"));
        List<DistributionRecipient> failed = recipientRepo.findByJobIdAndSendStatus(jobId, "FAILED");
        if (failed.isEmpty()) return 0;
        for (DistributionRecipient r : failed) {
            r.setSendStatus("PENDING");
            r.setErrorMessage(null);
            r.setSendAttemptedAt(null);
        }
        recipientRepo.saveAll(failed);
        job.setStatus("PROCESSING");
        jobRepo.save(job);

        fireAsync(jobId, job.getTenantId(), TenantContext.getUserId());
        return failed.size();
    }

    @Transactional(readOnly = true)
    public PageResponse<DistributionJobDto> list(Pageable pageable) {
        return PageResponse.from(jobRepo.findAllByOrderByCreatedAtDesc(pageable), DistributionJobDto::summary);
    }

    @Transactional(readOnly = true)
    public DistributionJobDto get(UUID jobId) {
        DistributionJob job = jobRepo.findById(jobId)
                .orElseThrow(() -> new HrmsException("Distribution not found: " + jobId,
                        HttpStatus.NOT_FOUND, "DISTRIBUTION_NOT_FOUND"));
        return DistributionJobDto.withRecipients(job, recipientRepo.findByJobId(jobId));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void fireAsync(UUID jobId, UUID tenantId, UUID actorUserId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { processor.process(jobId, tenantId, actorUserId); }
            });
        } else {
            processor.process(jobId, tenantId, actorUserId);
        }
    }

    private List<WorkforceEmployee> resolveRecipients(RecipientFilter f) {
        if (f == null || f.type() == null) return List.of();
        if (RecipientFilter.CUSTOM_LIST.equals(f.type())) {
            if (f.employeeIds() == null || f.employeeIds().isEmpty()) return List.of();
            return employeeRepo.findAllById(f.employeeIds()).stream()
                    .filter(WorkforceEmployee::isActive).toList();
        }
        List<String> values = f.values() == null ? List.of() : f.values();
        if (!RecipientFilter.ALL_EMPLOYEES.equals(f.type()) && values.isEmpty()) return List.of();

        Specification<WorkforceEmployee> spec = (root, q, cb) -> cb.isTrue(root.get("active"));
        switch (f.type()) {
            case RecipientFilter.ALL_EMPLOYEES -> { /* active only */ }
            case RecipientFilter.BY_COMPANY ->
                    spec = spec.and((root, q, cb) -> root.get("companyId").in(toUuids(values)));
            case RecipientFilter.BY_DEPARTMENT ->
                    spec = spec.and((root, q, cb) -> root.get("departmentId").in(toUuids(values)));
            case RecipientFilter.BY_DESIGNATION ->
                    spec = spec.and((root, q, cb) -> root.get("designationId").in(toUuids(values)));
            case RecipientFilter.BY_EMPLOYMENT_TYPE ->
                    spec = spec.and((root, q, cb) -> root.get("employmentType").in(toEmploymentTypes(values)));
            default -> throw new HrmsException("Unknown recipient filter type: " + f.type(),
                    HttpStatus.BAD_REQUEST, "BAD_FILTER_TYPE");
        }
        return employeeRepo.findAll(spec);
    }

    private static List<UUID> toUuids(List<String> values) {
        try {
            return values.stream().map(UUID::fromString).toList();
        } catch (IllegalArgumentException ex) {
            throw new HrmsException("Recipient filter values must be valid IDs",
                    HttpStatus.BAD_REQUEST, "BAD_FILTER_VALUE");
        }
    }

    private static List<WorkforceEmployee.EmploymentType> toEmploymentTypes(List<String> values) {
        try {
            return values.stream().map(WorkforceEmployee.EmploymentType::valueOf).toList();
        } catch (IllegalArgumentException ex) {
            throw new HrmsException("Unknown employment type in recipient filter",
                    HttpStatus.BAD_REQUEST, "BAD_EMPLOYMENT_TYPE");
        }
    }
}
