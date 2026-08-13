package com.hrms.hiring.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.hiring.dto.CandidateRequest;
import com.hrms.hiring.dto.CandidateResponse;
import com.hrms.hiring.dto.CandidateStageRequest;
import com.hrms.hiring.dto.JobRequisitionRequest;
import com.hrms.hiring.dto.JobRequisitionResponse;
import com.hrms.hiring.entity.Candidate;
import com.hrms.hiring.entity.JobRequisition;
import com.hrms.hiring.enums.CandidateStage;
import com.hrms.hiring.enums.RequisitionStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class HiringService {

    private static final Logger log = LoggerFactory.getLogger(HiringService.class);

    private final JobRequisitionRepository requisitionRepository;
    private final CandidateRepository candidateRepository;

    public HiringService(JobRequisitionRepository requisitionRepository, CandidateRepository candidateRepository) {
        this.requisitionRepository = requisitionRepository;
        this.candidateRepository = candidateRepository;
    }

    // ── Requisitions ─────────────────────────────────────────────────────────

    @Transactional
    public JobRequisitionResponse createRequisition(UUID companyId, JobRequisitionRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        JobRequisition req = new JobRequisition();
        req.setTenantId(tenantId);
        req.setCompanyId(companyId);
        req.setTitle(request.title());
        req.setDepartmentId(request.departmentId());
        req.setOpenings(request.openings() != null && request.openings() > 0 ? request.openings() : 1);
        req.setEmploymentType(request.employmentType());
        req.setLocation(request.location());
        req.setDescription(request.description());
        req.setHiringManagerId(request.hiringManagerId());
        req.setStatus(RequisitionStatus.OPEN);
        req = requisitionRepository.save(req);

        log.info("Job requisition created id={} company={} title={}", req.getId(), companyId, req.getTitle());
        return toResponse(req, 0L);
    }

    @Transactional(readOnly = true)
    public PageResponse<JobRequisitionResponse> getRequisitions(UUID companyId, Pageable pageable) {
        // Tenant isolation is enforced by RLS on hiring_mgmt.job_requisitions
        // (V070) — the connection's app.tenant_id GUC filters rows for us.
        // Keep the RLS binding paranoia here regardless: if a caller reached
        // this method WITHOUT a tenant bound, we would return every tenant's
        // requisitions (RLS falls open on missing GUC in some configurations).
        // A missing tenant is a caller bug, not a valid list request.
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw new BusinessRuleException(
                    "No tenant context — the request is not scoped to a workspace",
                    "TENANT_MISSING");
        }
        Page<JobRequisition> page;
        try {
            page = companyId != null
                    ? requisitionRepository.findByCompanyIdOrderByCreatedAtDesc(companyId, pageable)
                    : requisitionRepository.findAllByOrderByCreatedAtDesc(pageable);
        } catch (RuntimeException e) {
            // Common cause historically: a client-supplied ?sort=<unknownProperty>
            // makes Spring Data build ORDER BY nonexistent_column and Hibernate
            // fails hard. Log the pageable so we can see the offending sort in
            // the tail rather than a bare stacktrace.
            log.error("List requisitions failed (companyId={} pageable={})", companyId, pageable, e);
            throw e;
        }
        return toPage(page);
    }

    @Transactional(readOnly = true)
    public JobRequisitionResponse getRequisition(UUID requisitionId) {
        JobRequisition req = requisitionRepository.findById(requisitionId)
                .orElseThrow(() -> new ResourceNotFoundException("JobRequisition", requisitionId));
        return toResponse(req, candidateRepository.countByRequisitionId(requisitionId));
    }

    @Transactional
    public JobRequisitionResponse updateRequisition(UUID requisitionId, JobRequisitionRequest request) {
        JobRequisition req = requisitionRepository.findById(requisitionId)
                .orElseThrow(() -> new ResourceNotFoundException("JobRequisition", requisitionId));
        req.setTitle(request.title());
        req.setDepartmentId(request.departmentId());
        if (request.openings() != null && request.openings() > 0) {
            req.setOpenings(request.openings());
        }
        req.setEmploymentType(request.employmentType());
        req.setLocation(request.location());
        req.setDescription(request.description());
        req.setHiringManagerId(request.hiringManagerId());
        req = requisitionRepository.save(req);
        log.info("Job requisition {} updated", requisitionId);
        return toResponse(req, candidateRepository.countByRequisitionId(requisitionId));
    }

    @Transactional
    public JobRequisitionResponse closeRequisition(UUID requisitionId) {
        JobRequisition req = requisitionRepository.findById(requisitionId)
                .orElseThrow(() -> new ResourceNotFoundException("JobRequisition", requisitionId));
        if (req.getStatus() == RequisitionStatus.CLOSED) {
            throw new BusinessRuleException(
                    "Requisition is already closed",
                    "HIRING_ALREADY_CLOSED");
        }
        req.setStatus(RequisitionStatus.CLOSED);
        req = requisitionRepository.save(req);
        log.info("Job requisition {} closed", requisitionId);
        return toResponse(req, candidateRepository.countByRequisitionId(requisitionId));
    }

    // ── Candidates ───────────────────────────────────────────────────────────

    @Transactional
    public CandidateResponse addCandidate(UUID requisitionId, CandidateRequest request) {
        JobRequisition req = requisitionRepository.findById(requisitionId)
                .orElseThrow(() -> new ResourceNotFoundException("JobRequisition", requisitionId));
        if (req.getStatus() == RequisitionStatus.CLOSED) {
            throw new BusinessRuleException(
                    "Cannot add candidates to a closed requisition",
                    "HIRING_REQUISITION_CLOSED");
        }
        UUID tenantId = TenantContext.getTenantId();

        Candidate candidate = new Candidate();
        candidate.setTenantId(tenantId);
        candidate.setRequisitionId(requisitionId);
        candidate.setFullName(request.fullName());
        candidate.setEmail(request.email());
        candidate.setPhone(request.phone());
        candidate.setSource(request.source());
        candidate.setExpectedCtc(request.expectedCtc());
        candidate.setNotes(request.notes());
        candidate.setStage(CandidateStage.APPLIED);
        candidate = candidateRepository.save(candidate);

        log.info("Candidate {} added to requisition {}", candidate.getId(), requisitionId);
        return toCandidate(candidate);
    }

    @Transactional(readOnly = true)
    public List<CandidateResponse> getCandidates(UUID requisitionId) {
        if (!requisitionRepository.existsById(requisitionId)) {
            throw new ResourceNotFoundException("JobRequisition", requisitionId);
        }
        return candidateRepository.findByRequisitionIdOrderByCreatedAtAsc(requisitionId).stream()
                .map(this::toCandidate)
                .toList();
    }

    @Transactional
    public CandidateResponse updateStage(UUID candidateId, CandidateStageRequest request) {
        Candidate candidate = candidateRepository.findById(candidateId)
                .orElseThrow(() -> new ResourceNotFoundException("Candidate", candidateId));
        CandidateStage from = candidate.getStage();
        CandidateStage to   = request.stage();
        if (to == null) {
            throw new BusinessRuleException("Target stage is required", "STAGE_MISSING");
        }
        assertTransitionAllowed(from, to);
        candidate.setStage(to);
        candidate = candidateRepository.save(candidate);
        log.info("Candidate {} advanced {} -> {}", candidateId, from, to);
        return toCandidate(candidate);
    }

    /**
     * Enforce the hiring-pipeline state machine:
     * <ul>
     *   <li>APPLIED → SCREENING → INTERVIEW → OFFER → HIRED (forward only;
     *       skipping a stage is rejected, and so is reverting to an earlier
     *       one — a candidate who "goes back to screening" is a fresh
     *       re-apply, not a stage change).</li>
     *   <li>REJECTED and WITHDRAWN are terminal: reachable from any funnel
     *       stage (including HIRED, e.g. offer rescinded post-hire), but no
     *       transition leaves them.</li>
     *   <li>Same-stage saves are a no-op success (idempotent PATCH).</li>
     * </ul>
     * Invalid transitions surface as HTTP 409 STAGE_TRANSITION_INVALID.
     */
    private static void assertTransitionAllowed(CandidateStage from, CandidateStage to) {
        if (from == to) return;                                   // idempotent

        // Terminal stages don't move — once REJECTED / WITHDRAWN, that's final.
        if (from == CandidateStage.REJECTED || from == CandidateStage.WITHDRAWN) {
            throw new BusinessRuleException(
                    "Cannot change a candidate's stage after " + from,
                    "STAGE_TRANSITION_INVALID");
        }
        // Any funnel stage may drop out to REJECTED / WITHDRAWN.
        if (to == CandidateStage.REJECTED || to == CandidateStage.WITHDRAWN) return;

        // Forward-only funnel progression by exactly one step.
        boolean fromInFunnel = from.ordinal() <= CandidateStage.HIRED.ordinal();
        boolean toInFunnel   = to.ordinal()   <= CandidateStage.HIRED.ordinal();
        if (!fromInFunnel || !toInFunnel) {
            throw new BusinessRuleException(
                    "Transition " + from + " -> " + to + " is not allowed",
                    "STAGE_TRANSITION_INVALID");
        }
        if (to.ordinal() != from.ordinal() + 1) {
            throw new BusinessRuleException(
                    "Cannot skip stages: " + from + " -> " + to
                            + " (must advance one step at a time)",
                    "STAGE_TRANSITION_INVALID");
        }
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<JobRequisitionResponse> toPage(Page<JobRequisition> page) {
        List<JobRequisitionResponse> content = page.getContent().stream()
                .map(r -> toResponse(r, safeCandidateCount(r.getId())))
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    /**
     * The candidate-count aggregation is a nice-to-have in the list view;
     * losing it must not 500 the whole list. This wrapper turns any repo
     * failure (e.g. a transient RLS misbinding on the child table) into a 0
     * count with a warning log.
     */
    private long safeCandidateCount(UUID requisitionId) {
        try {
            return candidateRepository.countByRequisitionId(requisitionId);
        } catch (Exception e) {
            log.warn("candidate count failed for requisition {} — using 0", requisitionId, e);
            return 0L;
        }
    }

    private JobRequisitionResponse toResponse(JobRequisition r, long candidateCount) {
        // Every field except the primary key is defensively unwrapped:
        // legacy rows written before some columns had NOT NULL guards can hold
        // nulls that would otherwise NPE inside the record constructor's
        // implicit Integer unboxing (openings) or downstream JSON serializers.
        int openings = r.getOpenings() == null ? 0 : r.getOpenings();
        return new JobRequisitionResponse(
                r.getId(), r.getCompanyId(), r.getTitle(), r.getDepartmentId(),
                openings, r.getStatus(), r.getEmploymentType(), r.getLocation(),
                r.getDescription(), r.getHiringManagerId(), null, candidateCount, r.getCreatedAt());
    }

    private CandidateResponse toCandidate(Candidate c) {
        return new CandidateResponse(
                c.getId(), c.getRequisitionId(), c.getFullName(), c.getEmail(),
                c.getPhone(), c.getStage(), c.getSource(), c.getExpectedCtc(),
                c.getNotes(), c.getCreatedAt());
    }
}
