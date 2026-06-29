package com.hrms.pli.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.pli.dto.PliAwardRequest;
import com.hrms.pli.dto.PliAwardResponse;
import com.hrms.pli.dto.PliDecisionRequest;
import com.hrms.pli.entity.PliAward;
import com.hrms.pli.enums.PliStatus;
import com.hrms.pli.repository.PliAwardRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class PliService {

    private static final Logger log = LoggerFactory.getLogger(PliService.class);

    private final PliAwardRepository awardRepository;

    public PliService(PliAwardRepository awardRepository) {
        this.awardRepository = awardRepository;
    }

    /**
     * Propose a performance-linked incentive award for an employee. The award
     * starts in PROPOSED and must be approved before it can be paid.
     */
    @Transactional
    public PliAwardResponse createAward(UUID employeeId, UUID companyId, PliAwardRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        PliAward award = new PliAward();
        award.setTenantId(tenantId);
        award.setEmployeeId(employeeId);
        award.setCompanyId(companyId);
        award.setPlanName(request.planName());
        award.setPeriod(request.period());
        award.setAmount(request.amount());
        award.setRatingBasis(request.ratingBasis());
        award.setNotes(request.notes());
        award.setStatus(PliStatus.PROPOSED);
        award = awardRepository.save(award);

        log.info("PLI award proposed id={} employee={} amount={}", award.getId(), employeeId, request.amount());
        return toResponse(award);
    }

    @Transactional(readOnly = true)
    public PageResponse<PliAwardResponse> getAllAwards(Pageable pageable) {
        return toPage(awardRepository.findAllByOrderByCreatedAtDesc(pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<PliAwardResponse> getMyAwards(UUID employeeId, Pageable pageable) {
        return toPage(awardRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId, pageable));
    }

    @Transactional
    public PliAwardResponse decide(UUID awardId, PliDecisionRequest decision) {
        PliAward award = awardRepository.findById(awardId)
                .orElseThrow(() -> new ResourceNotFoundException("PliAward", awardId));
        if (award.getStatus() != PliStatus.PROPOSED) {
            throw new BusinessRuleException(
                    "Only a proposed award can be approved or rejected (current status: " + award.getStatus() + ")",
                    "PLI_NOT_PROPOSED");
        }
        award.setStatus(decision.approved() ? PliStatus.APPROVED : PliStatus.REJECTED);
        award = awardRepository.save(award);
        log.info("PLI award {} decided status={}", awardId, award.getStatus());
        return toResponse(award);
    }

    @Transactional
    public PliAwardResponse pay(UUID awardId) {
        PliAward award = awardRepository.findById(awardId)
                .orElseThrow(() -> new ResourceNotFoundException("PliAward", awardId));
        if (award.getStatus() != PliStatus.APPROVED) {
            throw new BusinessRuleException(
                    "Only an approved award can be paid (current status: " + award.getStatus() + ")",
                    "PLI_NOT_APPROVED");
        }
        award.setStatus(PliStatus.PAID);
        award = awardRepository.save(award);
        log.info("PLI award {} marked paid", awardId);
        return toResponse(award);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<PliAwardResponse> toPage(Page<PliAward> page) {
        List<PliAwardResponse> content = page.getContent().stream()
                .map(this::toResponse)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private PliAwardResponse toResponse(PliAward a) {
        return new PliAwardResponse(
                a.getId(), a.getEmployeeId(), null, null, a.getCompanyId(),
                a.getPlanName(), a.getPeriod(), a.getAmount(), a.getRatingBasis(),
                a.getStatus(), a.getNotes(), a.getCreatedAt());
    }
}
