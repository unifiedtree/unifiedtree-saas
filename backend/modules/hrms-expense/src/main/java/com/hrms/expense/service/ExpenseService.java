package com.hrms.expense.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.expense.dto.ExpenseClaimRequest;
import com.hrms.expense.dto.ExpenseClaimResponse;
import com.hrms.expense.dto.ExpenseDecisionRequest;
import com.hrms.expense.dto.ExpenseItemRequest;
import com.hrms.expense.dto.ExpenseItemResponse;
import com.hrms.expense.entity.ExpenseClaim;
import com.hrms.expense.entity.ExpenseItem;
import com.hrms.expense.enums.ExpenseStatus;
import com.hrms.expense.repository.ExpenseClaimRepository;
import com.hrms.expense.repository.ExpenseItemRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class ExpenseService {

    private static final Logger log = LoggerFactory.getLogger(ExpenseService.class);

    private final ExpenseClaimRepository claimRepository;
    private final ExpenseItemRepository itemRepository;

    public ExpenseService(ExpenseClaimRepository claimRepository, ExpenseItemRepository itemRepository) {
        this.claimRepository = claimRepository;
        this.itemRepository = itemRepository;
    }

    /**
     * Create and submit a claim with its line items in one shot. The claim total
     * is computed server-side from the items (never trusted from the client).
     */
    @Transactional
    public ExpenseClaimResponse submitClaim(UUID employeeId, UUID companyId, ExpenseClaimRequest request, UUID approverId) {
        if (request.items() == null || request.items().isEmpty()) {
            throw new BusinessRuleException("An expense claim must have at least one line item", "EXPENSE_EMPTY_CLAIM");
        }
        UUID tenantId = TenantContext.getTenantId();
        BigDecimal total = request.items().stream()
                .map(ExpenseItemRequest::amount)
                .filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        ExpenseClaim claim = new ExpenseClaim();
        claim.setTenantId(tenantId);
        claim.setEmployeeId(employeeId);
        claim.setCompanyId(companyId);
        claim.setTitle(request.title());
        claim.setCurrency(request.currency() != null && !request.currency().isBlank() ? request.currency() : "INR");
        claim.setNotes(request.notes());
        claim.setTotalAmount(total);
        claim.setApproverId(approverId);
        claim.setStatus(ExpenseStatus.SUBMITTED);
        claim.setSubmittedAt(Instant.now());
        claim = claimRepository.save(claim);

        final UUID claimId = claim.getId();
        List<ExpenseItem> items = request.items().stream().map(req -> {
            ExpenseItem item = new ExpenseItem();
            item.setTenantId(tenantId);
            item.setClaimId(claimId);
            item.setCategory(req.category());
            item.setDescription(req.description());
            item.setAmount(req.amount());
            item.setExpenseDate(req.expenseDate());
            item.setReceiptUrl(req.receiptUrl());
            item.setMerchantName(req.merchantName());
            return item;
        }).toList();
        itemRepository.saveAll(items);

        log.info("Expense claim submitted id={} employee={} total={}", claimId, employeeId, total);
        return toResponse(claim, items);
    }

    @Transactional(readOnly = true)
    public PageResponse<ExpenseClaimResponse> getMyClaims(UUID employeeId, Pageable pageable) {
        return toPage(claimRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId, pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<ExpenseClaimResponse> getPendingApprovals(UUID approverId, Pageable pageable) {
        return toPage(claimRepository.findByApproverIdAndStatusOrderByCreatedAtDesc(approverId, ExpenseStatus.SUBMITTED, pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<ExpenseClaimResponse> getByStatus(ExpenseStatus status, Pageable pageable) {
        return toPage(claimRepository.findByStatusOrderByCreatedAtDesc(status, pageable));
    }

    @Transactional(readOnly = true)
    public ExpenseClaimResponse getClaim(UUID claimId) {
        ExpenseClaim claim = claimRepository.findById(claimId)
                .orElseThrow(() -> new ResourceNotFoundException("ExpenseClaim", claimId));
        return toResponse(claim, itemRepository.findByClaimIdOrderByExpenseDateAsc(claimId));
    }

    @Transactional
    public ExpenseClaimResponse decide(UUID claimId, UUID approverId, ExpenseDecisionRequest decision) {
        ExpenseClaim claim = claimRepository.findById(claimId)
                .orElseThrow(() -> new ResourceNotFoundException("ExpenseClaim", claimId));
        if (claim.getStatus() != ExpenseStatus.SUBMITTED) {
            throw new BusinessRuleException(
                    "Only a submitted claim can be approved or rejected (current status: " + claim.getStatus() + ")",
                    "EXPENSE_NOT_SUBMITTED");
        }
        claim.setStatus(decision.approved() ? ExpenseStatus.APPROVED : ExpenseStatus.REJECTED);
        claim.setApproverId(approverId);
        claim.setApprovedAt(Instant.now());
        claim.setApproverComment(decision.comment());
        claim = claimRepository.save(claim);
        log.info("Expense claim {} decided status={} by approver={}", claimId, claim.getStatus(), approverId);
        return toResponse(claim, itemRepository.findByClaimIdOrderByExpenseDateAsc(claimId));
    }

    @Transactional
    public ExpenseClaimResponse reimburse(UUID claimId) {
        ExpenseClaim claim = claimRepository.findById(claimId)
                .orElseThrow(() -> new ResourceNotFoundException("ExpenseClaim", claimId));
        if (claim.getStatus() != ExpenseStatus.APPROVED) {
            throw new BusinessRuleException(
                    "Only an approved claim can be reimbursed (current status: " + claim.getStatus() + ")",
                    "EXPENSE_NOT_APPROVED");
        }
        claim.setStatus(ExpenseStatus.REIMBURSED);
        claim.setReimbursedAt(Instant.now());
        claim = claimRepository.save(claim);
        log.info("Expense claim {} marked reimbursed", claimId);
        return toResponse(claim, itemRepository.findByClaimIdOrderByExpenseDateAsc(claimId));
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<ExpenseClaimResponse> toPage(Page<ExpenseClaim> page) {
        List<ExpenseClaimResponse> content = page.getContent().stream()
                .map(c -> toResponse(c, null))
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private ExpenseClaimResponse toResponse(ExpenseClaim c, List<ExpenseItem> items) {
        List<ExpenseItemResponse> itemDtos = items == null ? null
                : items.stream().map(this::toItem).toList();
        return new ExpenseClaimResponse(
                c.getId(), c.getEmployeeId(), null, null, c.getCompanyId(),
                c.getTitle(), c.getTotalAmount(), c.getCurrency(), c.getStatus(),
                c.getSubmittedAt(), c.getApproverId(), c.getApprovedAt(), c.getApproverComment(),
                c.getReimbursedAt(), c.getNotes(), c.getCreatedAt(), itemDtos);
    }

    private ExpenseItemResponse toItem(ExpenseItem i) {
        return new ExpenseItemResponse(
                i.getId(), i.getCategory(), i.getDescription(), i.getAmount(),
                i.getExpenseDate(), i.getReceiptUrl(), i.getMerchantName());
    }
}
