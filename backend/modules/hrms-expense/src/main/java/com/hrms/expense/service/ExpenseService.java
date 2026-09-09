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
    private final com.hrms.expense.repository.ExpensePolicyRepository policyRepository;

    public ExpenseService(ExpenseClaimRepository claimRepository,
                          ExpenseItemRepository itemRepository,
                          com.hrms.expense.repository.ExpensePolicyRepository policyRepository) {
        this.claimRepository = claimRepository;
        this.itemRepository = itemRepository;
        this.policyRepository = policyRepository;
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

        enforceCategoryCaps(companyId, request.items());

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
    public PageResponse<ExpenseClaimResponse> getByStatuses(java.util.Collection<ExpenseStatus> statuses, Pageable pageable) {
        return toPage(claimRepository.findByStatusInOrderByCreatedAtDesc(statuses, pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<ExpenseClaimResponse> getPendingForApprover(UUID approverId, java.util.Collection<ExpenseStatus> statuses, Pageable pageable) {
        return toPage(claimRepository.findByApproverIdAndStatusInOrderByCreatedAtDesc(approverId, statuses, pageable));
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
        // B3 FIX (audit 2026-08-15): self-approval guard. Approver must not
        // be the claim's requester — a stale/forged reporting_manager_id
        // could otherwise let an employee approve their own expense.
        if (approverId != null && approverId.equals(claim.getEmployeeId())) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "You cannot approve your own expense claim.",
                    "EXPENSE_SELF_APPROVAL");
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

    /**
     * Enforce each category's {@code maxAmountPerClaim} cap.
     *
     * <p>2026-09-09: expense policies were entirely decorative. HR could set a
     * ₹5,000 travel cap and a ₹500,000 travel claim would still submit and
     * approve clean — the policy row was written, read back and rendered, but
     * no code path ever consulted it. That is worse than having no policy
     * screen at all, because it reads as a control that is being enforced.
     *
     * <p>The cap is applied to the claim's SUBTOTAL per category, not to each
     * line, so the limit cannot be sidestepped by splitting one dinner across
     * twenty ₹4,999 rows. Where several active policies cover the same
     * category the tightest cap wins. A policy with no cap set (null) does not
     * constrain the amount.
     *
     * <p>{@code requiresReceipt} is deliberately NOT enforced here yet: there
     * is still no receipt-upload control in the product, so every claim in
     * production has receipt_url NULL. Turning that flag on today would block
     * every expense submission in every workspace with no way for an employee
     * to comply. It gets enforced in the same change that ships the upload.
     */
    private void enforceCategoryCaps(UUID companyId, List<ExpenseItemRequest> items) {
        if (companyId == null) return;

        List<com.hrms.expense.entity.ExpensePolicy> policies =
                policyRepository.findByCompanyIdAndActiveTrueOrderByName(companyId);
        if (policies.isEmpty()) return;

        // Tightest cap per category — several active policies may overlap.
        java.util.Map<com.hrms.expense.enums.ExpenseCategory, BigDecimal> capByCategory =
                new java.util.HashMap<>();
        for (com.hrms.expense.entity.ExpensePolicy p : policies) {
            if (p.getCategory() == null || p.getMaxAmountPerClaim() == null) continue;
            capByCategory.merge(p.getCategory(), p.getMaxAmountPerClaim(), (a, b) -> a.min(b));
        }
        if (capByCategory.isEmpty()) return;

        java.util.Map<com.hrms.expense.enums.ExpenseCategory, BigDecimal> subtotalByCategory =
                new java.util.HashMap<>();
        for (ExpenseItemRequest item : items) {
            if (item.category() == null || item.amount() == null) continue;
            subtotalByCategory.merge(item.category(), item.amount(), BigDecimal::add);
        }

        for (var entry : subtotalByCategory.entrySet()) {
            BigDecimal cap = capByCategory.get(entry.getKey());
            if (cap == null) continue;
            if (entry.getValue().compareTo(cap) > 0) {
                throw new BusinessRuleException(
                        entry.getKey() + " expenses in this claim total "
                                + entry.getValue().toPlainString()
                                + ", which exceeds your company's limit of "
                                + cap.toPlainString() + " per claim.",
                        "EXPENSE_POLICY_CAP_EXCEEDED");
            }
        }
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
