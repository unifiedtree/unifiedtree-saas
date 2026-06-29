package com.hrms.policy.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.policy.dto.AcknowledgementResponse;
import com.hrms.policy.dto.PolicyRequest;
import com.hrms.policy.dto.PolicyResponse;
import com.hrms.policy.entity.HrPolicy;
import com.hrms.policy.entity.PolicyAcknowledgement;
import com.hrms.policy.enums.PolicyStatus;
import com.hrms.policy.repository.HrPolicyRepository;
import com.hrms.policy.repository.PolicyAcknowledgementRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class PolicyService {

    private static final Logger log = LoggerFactory.getLogger(PolicyService.class);

    private final HrPolicyRepository policyRepository;
    private final PolicyAcknowledgementRepository ackRepository;

    public PolicyService(HrPolicyRepository policyRepository,
                         PolicyAcknowledgementRepository ackRepository) {
        this.policyRepository = policyRepository;
        this.ackRepository = ackRepository;
    }

    // ── Policy administration ────────────────────────────────────────────────

    @Transactional
    public PolicyResponse createPolicy(UUID companyId, PolicyRequest request) {
        UUID resolvedCompany = request.companyId() != null ? request.companyId() : companyId;
        log.info("Creating HR policy title={} category={} company={}", request.title(), request.category(), resolvedCompany);

        HrPolicy policy = new HrPolicy();
        policy.setTenantId(TenantContext.getTenantId());
        policy.setCompanyId(resolvedCompany);
        apply(policy, request);
        policy.setStatus(PolicyStatus.ACTIVE);

        policy = policyRepository.save(policy);
        return toResponse(policy);
    }

    @Transactional(readOnly = true)
    public PageResponse<PolicyResponse> listActivePolicies(Pageable pageable) {
        Page<HrPolicy> page = policyRepository.findByStatusOrderByEffectiveDateDescCreatedAtDesc(PolicyStatus.ACTIVE, pageable);
        List<PolicyResponse> content = page.getContent().stream().map(this::toResponse).toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional(readOnly = true)
    public PolicyResponse getPolicy(UUID policyId) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        return toResponse(policy);
    }

    @Transactional
    public PolicyResponse updatePolicy(UUID policyId, PolicyRequest request) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        apply(policy, request);
        policy = policyRepository.save(policy);
        return toResponse(policy);
    }

    @Transactional
    public PolicyResponse archivePolicy(UUID policyId) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        policy.setStatus(PolicyStatus.ARCHIVED);
        policy = policyRepository.save(policy);
        log.info("HR policy {} archived", policyId);
        return toResponse(policy);
    }

    // ── Acknowledgements ─────────────────────────────────────────────────────

    /**
     * Record that {@code employeeId} has acknowledged the policy. Idempotent —
     * if an acknowledgement already exists it is left untouched.
     */
    @Transactional
    public void acknowledge(UUID policyId, UUID employeeId) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        if (ackRepository.existsByPolicyIdAndEmployeeId(policy.getId(), employeeId)) {
            log.debug("Policy {} already acknowledged by employee {} — skipping", policyId, employeeId);
            return;
        }
        PolicyAcknowledgement ack = new PolicyAcknowledgement();
        ack.setTenantId(TenantContext.getTenantId());
        ack.setPolicyId(policy.getId());
        ack.setEmployeeId(employeeId);
        ack.setAcknowledgedAt(Instant.now());
        ackRepository.save(ack);
        log.info("Policy {} acknowledged by employee {}", policyId, employeeId);
    }

    @Transactional(readOnly = true)
    public PageResponse<AcknowledgementResponse> getAcknowledgements(UUID policyId, Pageable pageable) {
        Page<PolicyAcknowledgement> page = ackRepository.findByPolicyIdOrderByAcknowledgedAtDesc(policyId, pageable);
        List<AcknowledgementResponse> content = page.getContent().stream().map(this::toAck).toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional(readOnly = true)
    public List<UUID> getMyAcknowledgedPolicyIds(UUID employeeId) {
        return ackRepository.findByEmployeeId(employeeId).stream()
                .map(PolicyAcknowledgement::getPolicyId)
                .toList();
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private void apply(HrPolicy policy, PolicyRequest request) {
        policy.setTitle(request.title());
        policy.setCategory(request.category());
        policy.setContent(request.content());
        policy.setPolicyVersion(request.version());
        policy.setEffectiveDate(request.effectiveDate());
    }

    private PolicyResponse toResponse(HrPolicy p) {
        return new PolicyResponse(
                p.getId(), p.getCompanyId(), p.getTitle(), p.getCategory(),
                p.getContent(), p.getPolicyVersion(), p.getEffectiveDate(), p.getStatus(),
                ackRepository.countByPolicyId(p.getId()), p.getCreatedAt());
    }

    private AcknowledgementResponse toAck(PolicyAcknowledgement a) {
        return new AcknowledgementResponse(
                a.getId(), a.getPolicyId(), a.getEmployeeId(), null, null, a.getAcknowledgedAt());
    }
}
