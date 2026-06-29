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
        Page<JobRequisition> page = companyId != null
                ? requisitionRepository.findByCompanyIdOrderByCreatedAtDesc(companyId, pageable)
                : requisitionRepository.findAllByOrderByCreatedAtDesc(pageable);
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
        candidate.setStage(request.stage());
        candidate = candidateRepository.save(candidate);
        log.info("Candidate {} advanced to stage {}", candidateId, request.stage());
        return toCandidate(candidate);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<JobRequisitionResponse> toPage(Page<JobRequisition> page) {
        List<JobRequisitionResponse> content = page.getContent().stream()
                .map(r -> toResponse(r, candidateRepository.countByRequisitionId(r.getId())))
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private JobRequisitionResponse toResponse(JobRequisition r, long candidateCount) {
        return new JobRequisitionResponse(
                r.getId(), r.getCompanyId(), r.getTitle(), r.getDepartmentId(),
                r.getOpenings(), r.getStatus(), r.getEmploymentType(), r.getLocation(),
                r.getDescription(), r.getHiringManagerId(), null, candidateCount, r.getCreatedAt());
    }

    private CandidateResponse toCandidate(Candidate c) {
        return new CandidateResponse(
                c.getId(), c.getRequisitionId(), c.getFullName(), c.getEmail(),
                c.getPhone(), c.getStage(), c.getSource(), c.getExpectedCtc(),
                c.getNotes(), c.getCreatedAt());
    }
}
