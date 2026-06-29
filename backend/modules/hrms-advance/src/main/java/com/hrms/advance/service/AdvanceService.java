package com.hrms.advance.service;

import com.hrms.advance.dto.AdvanceDecisionRequest;
import com.hrms.advance.dto.AdvanceRequestCreateRequest;
import com.hrms.advance.dto.AdvanceResponse;
import com.hrms.advance.entity.AdvanceRequest;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.repository.AdvanceRequestRepository;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class AdvanceService {

    private static final Logger log = LoggerFactory.getLogger(AdvanceService.class);

    private final AdvanceRequestRepository advanceRepository;

    public AdvanceService(AdvanceRequestRepository advanceRepository) {
        this.advanceRepository = advanceRepository;
    }

    /**
     * Raise a new salary advance request. The monthly deduction and outstanding
     * balance are computed server-side (never trusted from the client).
     */
    @Transactional
    public AdvanceResponse requestAdvance(UUID employeeId, UUID companyId, AdvanceRequestCreateRequest request, UUID approverId) {
        if (request.amount() == null || request.amount().signum() <= 0) {
            throw new BusinessRuleException("Advance amount must be greater than zero", "ADVANCE_INVALID_AMOUNT");
        }
        if (request.repaymentMonths() == null || request.repaymentMonths() < 1) {
            throw new BusinessRuleException("Repayment must span at least one month", "ADVANCE_INVALID_TERM");
        }
        UUID tenantId = TenantContext.getTenantId();
        BigDecimal monthlyDeduction = request.amount()
                .divide(BigDecimal.valueOf(request.repaymentMonths()), 2, RoundingMode.HALF_UP);

        AdvanceRequest advance = new AdvanceRequest();
        advance.setTenantId(tenantId);
        advance.setEmployeeId(employeeId);
        advance.setCompanyId(companyId);
        advance.setAmount(request.amount());
        advance.setReason(request.reason());
        advance.setRepaymentMonths(request.repaymentMonths());
        advance.setMonthlyDeduction(monthlyDeduction);
        advance.setOutstandingAmount(request.amount());
        advance.setApproverId(approverId);
        advance.setStatus(AdvanceStatus.REQUESTED);
        advance = advanceRepository.save(advance);

        log.info("Advance request raised id={} employee={} amount={} months={}",
                advance.getId(), employeeId, request.amount(), request.repaymentMonths());
        return toResponse(advance);
    }

    @Transactional(readOnly = true)
    public PageResponse<AdvanceResponse> getMyRequests(UUID employeeId, Pageable pageable) {
        return toPage(advanceRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId, pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<AdvanceResponse> getByStatus(AdvanceStatus status, Pageable pageable) {
        return toPage(advanceRepository.findByStatusOrderByCreatedAtDesc(status, pageable));
    }

    @Transactional(readOnly = true)
    public AdvanceResponse getRequest(UUID requestId) {
        AdvanceRequest advance = advanceRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("AdvanceRequest", requestId));
        return toResponse(advance);
    }

    @Transactional
    public AdvanceResponse decide(UUID requestId, UUID approverId, AdvanceDecisionRequest decision) {
        AdvanceRequest advance = advanceRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("AdvanceRequest", requestId));
        if (advance.getStatus() != AdvanceStatus.REQUESTED) {
            throw new BusinessRuleException(
                    "Only a requested advance can be approved or rejected (current status: " + advance.getStatus() + ")",
                    "ADVANCE_NOT_REQUESTED");
        }
        advance.setStatus(decision.approved() ? AdvanceStatus.APPROVED : AdvanceStatus.REJECTED);
        advance.setApproverId(approverId);
        advance.setApprovedAt(Instant.now());
        advance.setApproverComment(decision.comment());
        advance = advanceRepository.save(advance);
        log.info("Advance request {} decided status={} by approver={}", requestId, advance.getStatus(), approverId);
        return toResponse(advance);
    }

    @Transactional
    public AdvanceResponse disburse(UUID requestId) {
        AdvanceRequest advance = advanceRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("AdvanceRequest", requestId));
        if (advance.getStatus() != AdvanceStatus.APPROVED) {
            throw new BusinessRuleException(
                    "Only an approved advance can be disbursed (current status: " + advance.getStatus() + ")",
                    "ADVANCE_NOT_APPROVED");
        }
        advance.setStatus(AdvanceStatus.DISBURSED);
        advance.setDisbursedAt(Instant.now());
        advance = advanceRepository.save(advance);
        log.info("Advance request {} marked disbursed", requestId);
        return toResponse(advance);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<AdvanceResponse> toPage(Page<AdvanceRequest> page) {
        List<AdvanceResponse> content = page.getContent().stream()
                .map(this::toResponse)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private AdvanceResponse toResponse(AdvanceRequest a) {
        return new AdvanceResponse(
                a.getId(), a.getEmployeeId(), null, null, a.getCompanyId(),
                a.getAmount(), a.getReason(), a.getRepaymentMonths(), a.getMonthlyDeduction(),
                a.getStatus(), a.getApproverId(), a.getApprovedAt(), a.getApproverComment(),
                a.getDisbursedAt(), a.getOutstandingAmount(), a.getCreatedAt());
    }
}
