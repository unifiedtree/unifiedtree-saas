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
import org.springframework.jdbc.core.JdbcTemplate;
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
    private final JdbcTemplate jdbc;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.context.ApplicationEventPublisher eventPublisher;

    private void publishSafely(Object event) {
        if (eventPublisher == null) return;
        try { eventPublisher.publishEvent(event); }
        catch (Exception ex) { log.warn("Failed to publish {}: {}", event.getClass().getSimpleName(), ex.getMessage()); }
    }

    public AdvanceService(AdvanceRequestRepository advanceRepository, JdbcTemplate jdbc) {
        this.advanceRepository = advanceRepository;
        this.jdbc = jdbc;
    }

    /**
     * Raise a new salary advance request. The monthly deduction and outstanding
     * balance are computed server-side (never trusted from the client).
     */
    @Transactional
    public AdvanceResponse requestAdvance(UUID employeeId, UUID companyId, AdvanceRequestCreateRequest request, UUID approverId) {
        return raise(employeeId, companyId, request, approverId, null);
    }

    /**
     * HR / finance raise an advance in an employee's name. Same request as the
     * employee's own (same amount rules, same approver, same approval → payout
     * → recovery flow); {@code raisedBy} is recorded, and the employee is
     * notified that an advance was raised for them. The caller has already
     * checked that the employee is active and is not the raiser.
     */
    @Transactional
    public AdvanceResponse requestAdvanceOnBehalf(UUID employeeId, UUID companyId, AdvanceRequestCreateRequest request,
                                                  UUID approverId, UUID raisedBy) {
        if (raisedBy == null || raisedBy.equals(employeeId)) {
            throw new BusinessRuleException("To ask for an advance for yourself, use your own request.", "ADVANCE_ON_BEHALF_SELF");
        }
        return raise(employeeId, companyId, request, approverId, raisedBy);
    }

    private AdvanceResponse raise(UUID employeeId, UUID companyId, AdvanceRequestCreateRequest request, UUID approverId, UUID raisedBy) {
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
        advance.setRaisedByEmployeeId(raisedBy);
        advance = advanceRepository.save(advance);

        log.info("Advance request raised id={} employee={} amount={} months={} raisedBy={}",
                advance.getId(), employeeId, request.amount(), request.repaymentMonths(), raisedBy);
        publishSafely(new com.unifiedtree.notifications.events.AdvanceRequestSubmittedEvent(
                advance.getId(), employeeId, approverId, tenantId, request.amount()));
        if (raisedBy != null) {
            publishSafely(new com.unifiedtree.notifications.events.AdvanceRaisedOnBehalfEvent(
                    advance.getId(), employeeId, raisedBy, tenantId, request.amount(), request.repaymentMonths()));
        }
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

    /** Approvals queue scoped to the advances routed to this approver. */
    @Transactional(readOnly = true)
    public PageResponse<AdvanceResponse> getPendingForApprover(
            UUID approverId, java.util.Collection<AdvanceStatus> statuses, Pageable pageable) {
        return toPage(advanceRepository
                .findByStatusInAndApproverIdOrderByCreatedAtDesc(statuses, approverId, pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<AdvanceResponse> getByStatuses(java.util.Collection<AdvanceStatus> statuses, Pageable pageable) {
        return toPage(advanceRepository.findByStatusInOrderByCreatedAtDesc(statuses, pageable));
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
        // B3 FIX (audit 2026-08-15): defense-in-depth self-approval guard.
        // The controller also checks, but the service must NOT trust callers.
        if (approverId != null && approverId.equals(advance.getEmployeeId())) {
            throw new BusinessRuleException(
                    "You cannot approve your own advance request.",
                    "ADVANCE_SELF_APPROVAL");
        }
        advance.setStatus(decision.approved() ? AdvanceStatus.APPROVED : AdvanceStatus.REJECTED);
        advance.setApproverId(approverId);
        advance.setApprovedAt(Instant.now());
        advance.setApproverComment(decision.comment());
        advance = advanceRepository.save(advance);
        log.info("Advance request {} decided status={} by approver={}", requestId, advance.getStatus(), approverId);
        publishSafely(new com.unifiedtree.notifications.events.AdvanceRequestDecidedEvent(
                requestId, advance.getEmployeeId(), advance.getTenantId(), decision.approved(),
                advance.getAmount(), decision.comment()));
        return toResponse(advance);
    }

    @Transactional
    public AdvanceResponse disburse(UUID requestId) {
        AdvanceRequest advance = advanceRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("AdvanceRequest", requestId));
        // Serialize with separation and full-and-final processing. Keep the
        // shared employee -> advance lock order so settlement cannot finish
        // immediately before a previously approved advance creates new debt.
        UUID tenantId = TenantContext.getTenantId();
        String employeeStatus = jdbc.queryForObject("""
                SELECT employment_status FROM hrms.employees
                 WHERE tenant_id = ? AND id = ? FOR UPDATE
                """, String.class, tenantId, advance.getEmployeeId());
        if ("EXITED".equals(employeeStatus) || "TERMINATED".equals(employeeStatus)) {
            throw new BusinessRuleException(
                    "An advance cannot be disbursed after the employee has exited or been terminated.",
                    "ADVANCE_EMPLOYEE_SEPARATED");
        }
        // The controller may already have loaded this entity. Read the locked
        // database status rather than trusting a stale JPA first-level cache.
        String advanceStatus = jdbc.queryForObject("""
                SELECT status FROM advance_mgmt.advance_requests
                 WHERE tenant_id = ? AND id = ? FOR UPDATE
                """, String.class, tenantId, requestId);
        if (!AdvanceStatus.APPROVED.name().equals(advanceStatus)) {
            throw new BusinessRuleException(
                    "Only an approved advance can be disbursed (current status: " + advanceStatus + ")",
                    "ADVANCE_NOT_APPROVED");
        }
        advance.setStatus(AdvanceStatus.DISBURSED);
        advance.setDisbursedAt(Instant.now());
        // The same transaction seeds the recovery schedule through JDBC.
        advance = advanceRepository.saveAndFlush(advance);
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
                a.getDisbursedAt(), a.getOutstandingAmount(), a.getCreatedAt(), a.getRaisedByEmployeeId(), null);
    }
}
