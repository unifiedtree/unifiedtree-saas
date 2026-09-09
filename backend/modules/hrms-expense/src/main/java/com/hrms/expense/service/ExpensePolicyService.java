package com.hrms.expense.service;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.expense.dto.ExpensePolicyRequest;
import com.hrms.expense.dto.ExpensePolicyResponse;
import com.hrms.expense.entity.ExpensePolicy;
import com.hrms.expense.repository.ExpensePolicyRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class ExpensePolicyService {

    private static final Logger log = LoggerFactory.getLogger(ExpensePolicyService.class);

    private final ExpensePolicyRepository policyRepository;

    public ExpensePolicyService(ExpensePolicyRepository policyRepository) {
        this.policyRepository = policyRepository;
    }

    @Transactional
    public ExpensePolicyResponse createPolicy(UUID companyId, ExpensePolicyRequest request) {
        UUID resolvedCompany = request.companyId() != null ? request.companyId() : companyId;
        log.info("Creating expense policy name={} category={} company={}", request.name(), request.category(), resolvedCompany);

        ExpensePolicy policy = new ExpensePolicy();
        policy.setTenantId(TenantContext.getTenantId());
        policy.setCompanyId(resolvedCompany);
        apply(policy, request);
        policy.setActive(true);

        policy = policyRepository.save(policy);
        return toResponse(policy);
    }

    @Transactional(readOnly = true)
    public List<ExpensePolicyResponse> listPolicies(UUID companyId) {
        return policyRepository.findByCompanyIdOrderByName(companyId).stream().map(this::toResponse).toList();
    }

    @Transactional
    public ExpensePolicyResponse updatePolicy(UUID policyId, ExpensePolicyRequest request) {
        ExpensePolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("ExpensePolicy", policyId));
        applyUpdate(policy, request);
        policy = policyRepository.save(policy);
        return toResponse(policy);
    }

    @Transactional
    public void deactivatePolicy(UUID policyId) {
        ExpensePolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("ExpensePolicy", policyId));
        policy.setActive(false);
        policyRepository.save(policy);
    }

    /**
     * Create-time mapping. Omitted booleans take their product defaults here,
     * which is right for a NEW policy but wrong for an edit — see applyUpdate.
     */
    private void apply(ExpensePolicy policy, ExpensePolicyRequest request) {
        policy.setName(request.name());
        policy.setCategory(request.category());
        policy.setMaxAmountPerClaim(request.maxAmountPerClaim());
        policy.setRequiresReceipt(request.requiresReceipt() == null || request.requiresReceipt());
        policy.setRequiresManagerApproval(request.requiresManagerApproval() == null || request.requiresManagerApproval());
        policy.setRequiresHrApproval(request.requiresHrApproval() != null && request.requiresHrApproval());
        if (request.isActive() != null) policy.setActive(request.isActive());
    }

    /**
     * Update mapping — null means "leave alone", not "reset to default".
     *
     * <p>2026-09-09: update used the create mapping, so a PUT that omitted
     * requiresReceipt silently turned it ON (`== null || value`), and one that
     * omitted requiresHrApproval silently turned it OFF. An edit that only
     * meant to change a cap could therefore flip two compliance rules the
     * caller never mentioned. That is the same silent-change family as
     * CompanyService.update NULLing PAN/GSTIN on every company edit.
     */
    private void applyUpdate(ExpensePolicy policy, ExpensePolicyRequest request) {
        if (request.name() != null && !request.name().isBlank()) policy.setName(request.name());
        if (request.category() != null)              policy.setCategory(request.category());
        if (request.maxAmountPerClaim() != null)     policy.setMaxAmountPerClaim(request.maxAmountPerClaim());
        if (request.requiresReceipt() != null)       policy.setRequiresReceipt(request.requiresReceipt());
        if (request.requiresManagerApproval() != null) policy.setRequiresManagerApproval(request.requiresManagerApproval());
        if (request.requiresHrApproval() != null)    policy.setRequiresHrApproval(request.requiresHrApproval());
        if (request.isActive() != null)              policy.setActive(request.isActive());
    }

    private ExpensePolicyResponse toResponse(ExpensePolicy p) {
        return new ExpensePolicyResponse(
                p.getId(), p.getCompanyId(), p.getName(), p.getCategory(),
                p.getMaxAmountPerClaim(), p.isRequiresReceipt(),
                p.isRequiresManagerApproval(), p.isRequiresHrApproval(), p.isActive());
    }
}
