package com.hrms.hiring.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.hiring.dto.CandidateRequest;
import com.hrms.hiring.dto.CandidateConversionFacts;
import com.hrms.hiring.dto.CandidateResponse;
import com.hrms.hiring.dto.CandidateStageRequest;
import com.hrms.hiring.dto.JobRequisitionRequest;
import com.hrms.hiring.dto.JobRequisitionResponse;
import com.hrms.hiring.dto.HiringOfferRequest;
import com.hrms.hiring.dto.HiringOfferResponse;
import com.hrms.hiring.entity.Candidate;
import com.hrms.hiring.entity.JobRequisition;
import com.hrms.hiring.entity.HiringOffer;
import com.hrms.hiring.enums.CandidateStage;
import com.hrms.hiring.enums.RequisitionStatus;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
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
    private final HiringOfferRepository offerRepository;
    private final CandidateStageLog stageLog;
    private final OfferEmailBook offerEmails;

    public HiringService(JobRequisitionRepository requisitionRepository, CandidateRepository candidateRepository, HiringOfferRepository offerRepository) {
        this(requisitionRepository, candidateRepository, offerRepository, CandidateStageLog.NONE, OfferEmailBook.NONE);
    }

    /**
     * @param stageLog    the candidate's stage history (V143.59), written in the transaction of each move
     * @param offerEmails the candidate email stored on an offer (V143.59)
     */
    @org.springframework.beans.factory.annotation.Autowired
    public HiringService(JobRequisitionRepository requisitionRepository, CandidateRepository candidateRepository,
                         HiringOfferRepository offerRepository, CandidateStageLog stageLog, OfferEmailBook offerEmails) {
        this.requisitionRepository = requisitionRepository;
        this.candidateRepository = candidateRepository;
        this.offerRepository = offerRepository;
        this.stageLog = stageLog == null ? CandidateStageLog.NONE : stageLog;
        this.offerEmails = offerEmails == null ? OfferEmailBook.NONE : offerEmails;
    }


    @Transactional(readOnly = true)
    public PageResponse<HiringOfferResponse> getOffers(UUID companyId, Pageable pageable) {
        Page<HiringOffer> page = companyId != null
                ? offerRepository.findByCompanyIdOrderByCreatedAtDesc(companyId, pageable)
                : offerRepository.findAllByOrderByCreatedAtDesc(pageable);
        return new PageResponse<>(toOffers(page.getContent()),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    /** {@link #getOffers(UUID, Pageable)} kept to offers made in [start, end) (calendar everywhere, 7 Oct 2026); null = that list. */
    @Transactional(readOnly = true)
    public PageResponse<HiringOfferResponse> getOffers(UUID companyId, java.time.Instant start, java.time.Instant end,
                                                       Pageable pageable) {
        if (start == null || end == null) return getOffers(companyId, pageable);
        Page<HiringOffer> page = companyId != null
                ? offerRepository.findByCompanyIdCreatedIn(companyId, start, end, pageable)
                : offerRepository.findCreatedIn(start, end, pageable);
        return new PageResponse<>(toOffers(page.getContent()),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional
    public HiringOfferResponse createOffer(UUID companyId, HiringOfferRequest request) {
        if (request.status() != null && request.status() != OfferStatus.DRAFT)
            throw new BusinessRuleException("Create a draft before issuing an offer", "OFFER_TRANSITION_INVALID");
        validateOfferLinks(companyId, request);
        String candidateEmail = candidateEmailFor(request);
        UUID tenantId = TenantContext.getTenantId();
        HiringOffer offer = new HiringOffer();
        offer.setTenantId(tenantId);
        offer.setCompanyId(companyId);
        applyOffer(offer, request);
        if (offer.getStatus() == OfferStatus.SENT && offer.getSentAt() == null) offer.setSentAt(java.time.Instant.now());
        if (request.candidateId() != null) {
            candidateRepository.findById(request.candidateId()).ifPresent(c -> {
                if (c.getStage() == CandidateStage.INTERVIEW) {
                    c.setStage(CandidateStage.OFFER);
                    stageLog.record(c.getId(), CandidateStage.INTERVIEW, CandidateStage.OFFER, CandidateStageLog.Kind.OFFER_CREATED);
                }
            });
        }
        HiringOffer saved = offerRepository.save(offer);
        if (candidateEmail != null && !candidateEmail.isEmpty()) storeOfferEmail(saved.getId(), candidateEmail);
        return toOffer(saved);
    }

    @Transactional
    public HiringOfferResponse updateOfferStatus(UUID id, OfferStatus status) {
        HiringOffer offer = offerRepository.findForUpdate(id)
                .orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id));
        if (status == null) throw new BusinessRuleException("Offer status is required", "OFFER_STATUS_MISSING");
        if (status == offer.getStatus()) return toOffer(offer);
        boolean allowed = switch (offer.getStatus()) {
            case DRAFT -> status == OfferStatus.SENT || status == OfferStatus.WITHDRAWN;
            case SENT -> status == OfferStatus.ACCEPTED || status == OfferStatus.DECLINED || status == OfferStatus.WITHDRAWN;
            default -> false;
        };
        if (!allowed) throw new BusinessRuleException("This offer cannot move to " + status, "OFFER_TRANSITION_INVALID");
        offer.setStatus(status);
        if (status == OfferStatus.SENT && offer.getSentAt() == null) offer.setSentAt(java.time.Instant.now());
        if ((status == OfferStatus.ACCEPTED || status == OfferStatus.DECLINED) && offer.getRespondedAt() == null) offer.setRespondedAt(java.time.Instant.now());
        if (status == OfferStatus.ACCEPTED && offer.getCandidateId() != null) {
            candidateRepository.findById(offer.getCandidateId()).ifPresent(c -> {
                CandidateStage before = c.getStage();
                c.setStage(CandidateStage.HIRED);
                if (before != CandidateStage.HIRED)
                    stageLog.record(c.getId(), before, CandidateStage.HIRED, CandidateStageLog.Kind.OFFER_ACCEPTED);
            });
        }
        return toOffer(offerRepository.save(offer));
    }

    @Transactional(readOnly = true)
    public HiringOfferResponse getOffer(UUID id) {
        return toOffer(offerRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id)));
    }

    @Transactional
    public HiringOfferResponse updateOffer(UUID id, HiringOfferRequest request) {
        HiringOffer offer = offerRepository.findForUpdate(id)
                .orElseThrow(() -> new ResourceNotFoundException("HiringOffer", id));
        if (offer.getStatus() != OfferStatus.DRAFT ||
                (request.status() != null && request.status() != OfferStatus.DRAFT))
            throw new BusinessRuleException("Only drafts can be edited", "OFFER_NOT_DRAFT");
        if (request.companyId() != null && !offer.getCompanyId().equals(request.companyId()))
            throw new BusinessRuleException("An offer cannot move to another company", "OFFER_COMPANY_MISMATCH");
        validateOfferLinks(offer.getCompanyId(), request);
        String candidateEmail = candidateEmailFor(request);
        applyOffer(offer, request);
        HiringOffer saved = offerRepository.save(offer);
        // Left out = unchanged (older clients never send it); empty = removed.
        if (candidateEmail != null) storeOfferEmail(saved.getId(), candidateEmail.isEmpty() ? null : candidateEmail);
        return toOffer(saved);
    }

    /**
     * The request's candidate email, trimmed: null when left out, "" when sent
     * empty. An offer linked to a candidate may only carry that candidate's
     * recorded email, the same rule the send applies.
     */
    private String candidateEmailFor(HiringOfferRequest request) {
        if (request.candidateEmail() == null) return null;
        String email = request.candidateEmail().trim();
        if (email.isEmpty() || request.candidateId() == null) return email;
        Candidate candidate = candidateRepository.findById(request.candidateId())
                .orElseThrow(() -> new ResourceNotFoundException("Candidate", request.candidateId()));
        if (candidate.getEmail() == null || !email.equalsIgnoreCase(candidate.getEmail().trim()))
            throw new BusinessRuleException("Use the linked candidate's recorded email address", "OFFER_EMAIL_MISMATCH");
        return email;
    }

    /**
     * Stores the email. While V143.59 is not applied it is not kept: the offer
     * then shows the linked candidate's email (or none), and "Send offer
     * email" asks for the address as it did before.
     */
    private void storeOfferEmail(UUID offerId, String email) {
        if (!offerEmails.save(offerId, email))
            log.warn("Offer {}: candidate email not stored, the offer email table is not there yet (V143.59)", offerId);
    }

    private void validateOfferLinks(UUID companyId, HiringOfferRequest request) {
        if (request.requisitionId() != null) {
            JobRequisition requisition = requisitionRepository.findById(request.requisitionId())
                    .orElseThrow(() -> new ResourceNotFoundException("JobRequisition", request.requisitionId()));
            if (!companyId.equals(requisition.getCompanyId()))
                throw new BusinessRuleException("Requisition belongs to another company", "OFFER_COMPANY_MISMATCH");
        }
        if (request.candidateId() != null) {
            Candidate candidate = candidateRepository.findById(request.candidateId())
                    .orElseThrow(() -> new ResourceNotFoundException("Candidate", request.candidateId()));
            if (!candidate.getRequisitionId().equals(request.requisitionId()))
                throw new BusinessRuleException("Candidate must belong to the selected requisition", "OFFER_CANDIDATE_MISMATCH");
        }
    }

    private void applyOffer(HiringOffer offer, HiringOfferRequest request) {
        offer.setRequisitionId(request.requisitionId());
        offer.setCandidateId(request.candidateId());
        offer.setCandidateName(request.candidateName().trim());
        offer.setRoleTitle(request.roleTitle().trim());
        offer.setOfferedCtc(request.offeredCtc());
        offer.setJoiningDate(request.joiningDate());
        offer.setStatus(request.status() == null ? OfferStatus.DRAFT : request.status());
        offer.setNotes(request.notes());
        offer.setOfferTerms(request.offerTerms());
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

    /**
     * {@link #getRequisitions(UUID, Pageable)} kept to requisitions opened in
     * [start, end) (calendar everywhere, 7 Oct 2026); null = that list.
     */
    @Transactional(readOnly = true)
    public PageResponse<JobRequisitionResponse> getRequisitions(UUID companyId, java.time.Instant start, java.time.Instant end,
                                                                Pageable pageable) {
        if (start == null || end == null) return getRequisitions(companyId, pageable);
        // The same paranoia as above: never list without a tenant bound.
        if (TenantContext.getTenantId() == null) {
            throw new BusinessRuleException(
                    "No tenant context — the request is not scoped to a workspace",
                    "TENANT_MISSING");
        }
        return toPage(companyId != null
                ? requisitionRepository.findByCompanyIdCreatedIn(companyId, start, end, pageable)
                : requisitionRepository.findCreatedIn(start, end, pageable));
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
        stageLog.record(candidate.getId(), null, CandidateStage.APPLIED, CandidateStageLog.Kind.ADDED);

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

    /** Candidates across every requisition, optionally for one company and one stage (oldest first). */
    @Transactional(readOnly = true)
    public List<CandidateResponse> getCandidatesAcrossRequisitions(UUID companyId, CandidateStage stage) {
        return candidateRepository.findAcrossRequisitions(companyId, stage).stream()
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
        if (from != to) stageLog.record(candidateId, from, to, CandidateStageLog.Kind.STAGE_CHANGE);
        log.info("Candidate {} advanced {} -> {}", candidateId, from, to);
        return toCandidate(candidate);
    }

    // ── Candidate → employee conversion ─────────────────────────────────────

    /**
     * Lock a HIRED, not-yet-converted candidate and return the facts the
     * employee record is built from. Must run inside the caller's transaction
     * (the lock is what makes a double-click create one employee, not two).
     */
    @Transactional
    public CandidateConversionFacts beginConversion(UUID candidateId) {
        Candidate c = candidateRepository.findForUpdate(candidateId)
                .orElseThrow(() -> new ResourceNotFoundException("Candidate", candidateId));
        if (c.getConvertedEmployeeId() != null) {
            throw new com.hrms.core.exception.HrmsException(
                    "This candidate has already been converted to an employee",
                    org.springframework.http.HttpStatus.CONFLICT, "CANDIDATE_ALREADY_CONVERTED");
        }
        if (c.getStage() != CandidateStage.HIRED) {
            throw new BusinessRuleException(
                    "Only a HIRED candidate can be converted to an employee (current stage: " + c.getStage() + ")",
                    "CANDIDATE_NOT_HIRED");
        }
        JobRequisition req = requisitionRepository.findById(c.getRequisitionId())
                .orElseThrow(() -> new ResourceNotFoundException("JobRequisition", c.getRequisitionId()));
        HiringOffer offer = offerRepository
                .findFirstByCandidateIdAndStatusOrderByRespondedAtDescCreatedAtDesc(candidateId, OfferStatus.ACCEPTED)
                .orElse(null);
        return new CandidateConversionFacts(
                c.getId(), c.getFullName(), c.getEmail(), c.getPhone(),
                req.getCompanyId(), req.getDepartmentId(), req.getEmploymentType(),
                offer != null ? offer.getRoleTitle() : req.getTitle(),
                offer != null ? offer.getJoiningDate() : null,
                offer != null && offer.getOfferedCtc() != null && offer.getOfferedCtc().signum() > 0 ? offer.getOfferedCtc() : null);
    }

    /** Record the employee a candidate became. Same transaction as {@link #beginConversion}. */
    @Transactional
    public CandidateResponse completeConversion(UUID candidateId, UUID employeeId) {
        Candidate c = candidateRepository.findForUpdate(candidateId)
                .orElseThrow(() -> new ResourceNotFoundException("Candidate", candidateId));
        c.setConvertedEmployeeId(employeeId);
        c.setConvertedAt(java.time.Instant.now());
        c = candidateRepository.save(c);
        stageLog.record(candidateId, c.getStage(), c.getStage(), CandidateStageLog.Kind.CONVERTED);
        log.info("Candidate {} converted to employee {}", candidateId, employeeId);
        return toCandidate(c);
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

    private HiringOfferResponse toOffer(HiringOffer o) {
        return toOffers(List.of(o)).get(0);
    }

    /**
     * Offers with their candidate email: the one stored on the offer, else the
     * linked candidate's recorded email (one lookup of each per page).
     */
    private List<HiringOfferResponse> toOffers(List<HiringOffer> offers) {
        if (offers.isEmpty()) return List.of();
        java.util.Map<UUID, String> stored = offerEmails.find(
                offers.stream().map(HiringOffer::getId).filter(java.util.Objects::nonNull).toList());
        List<UUID> candidateIds = offers.stream().map(HiringOffer::getCandidateId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        java.util.Map<UUID, String> candidateEmails = new java.util.HashMap<>();
        if (!candidateIds.isEmpty()) {
            for (Candidate c : candidateRepository.findAllById(candidateIds)) {
                if (c.getEmail() != null && !c.getEmail().isBlank()) candidateEmails.put(c.getId(), c.getEmail().trim());
            }
        }
        return offers.stream().map(o -> {
            String email = o.getId() == null ? null : stored.get(o.getId());
            if (email == null && o.getCandidateId() != null) email = candidateEmails.get(o.getCandidateId());
            return new HiringOfferResponse(o.getId(), o.getCompanyId(), o.getRequisitionId(), o.getCandidateId(),
                    o.getCandidateName(), o.getRoleTitle(), o.getOfferedCtc(), o.getJoiningDate(),
                    o.getStatus(), o.getSentAt(), o.getRespondedAt(), o.getNotes(), o.getCreatedAt(), o.getOfferTerms(),
                    o.getEmailSubmittedAt(), o.getEmailRecipient(), email);
        }).toList();
    }

    private CandidateResponse toCandidate(Candidate c) {
        return new CandidateResponse(
                c.getId(), c.getRequisitionId(), c.getFullName(), c.getEmail(),
                c.getPhone(), c.getStage(), c.getSource(), c.getExpectedCtc(),
                c.getNotes(), c.getCreatedAt(), c.getConvertedEmployeeId(), c.getConvertedAt());
    }
}
