package com.hrms.policy.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
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
        // Honour req.status if the author explicitly picked DRAFT / ACTIVE;
        // default to ACTIVE only when omitted. ARCHIVED at create time is
        // meaningless — reject it (use PATCH /archive on an existing row).
        // Jackson already rejects unknown enum labels with a 400, so anything
        // reaching here is one of {DRAFT, ACTIVE, ARCHIVED}.
        PolicyStatus status = request.status();
        if (status == null) {
            status = PolicyStatus.ACTIVE;
        } else if (status == PolicyStatus.ARCHIVED) {
            throw new BusinessRuleException(
                    "Policies cannot be created directly in ARCHIVED state",
                    "POLICY_STATUS_INVALID");
        }
        log.info("Creating HR policy title={} category={} status={} company={}",
                request.title(), request.category(), status, resolvedCompany);

        HrPolicy policy = new HrPolicy();
        policy.setTenantId(TenantContext.getTenantId());
        policy.setCompanyId(resolvedCompany);
        apply(policy, request);
        policy.setStatus(status);

        policy = policyRepository.save(policy);
        return toResponse(policy);
    }

    /**
     * DRAFT → ACTIVE transition. Idempotent: republishing an already-ACTIVE
     * policy is a no-op (200 OK with the current row) so the frontend can
     * safely double-click.
     */
    @Transactional
    public PolicyResponse publishPolicy(UUID policyId) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        if (policy.getStatus() == PolicyStatus.ACTIVE) {
            return toResponse(policy);
        }
        if (policy.getStatus() != PolicyStatus.DRAFT) {
            throw new BusinessRuleException(
                    "Only DRAFT policies can be published (current: " + policy.getStatus() + ")",
                    "POLICY_STATUS_INVALID");
        }
        policy.setStatus(PolicyStatus.ACTIVE);
        policy = policyRepository.save(policy);
        log.info("HR policy {} published (DRAFT → ACTIVE)", policyId);
        return toResponse(policy);
    }

    @Transactional(readOnly = true)
    public PageResponse<PolicyResponse> listActivePolicies(Pageable pageable) {
        return listPolicies(PolicyStatus.ACTIVE, pageable);
    }

    /**
     * List policies in one lifecycle state.
     *
     * <p>2026-09-09: the only list path was ACTIVE-only, so archiving a policy
     * made it vanish from the admin table with no way back — there was no
     * unarchive endpoint and no status filter, and the SPA's Archive icon
     * fired without a confirm. One misclick permanently removed a published
     * policy from the product; recovery meant editing the database. The
     * ARCHIVED branch of the SPA's own status-tone map was unreachable dead
     * code, which is the tell.
     */
    @Transactional(readOnly = true)
    public PageResponse<PolicyResponse> listPolicies(PolicyStatus status, Pageable pageable) {
        Page<HrPolicy> page = policyRepository
                .findByStatusOrderByEffectiveDateDescCreatedAtDesc(
                        status == null ? PolicyStatus.ACTIVE : status, pageable);
        List<PolicyResponse> content = page.getContent().stream().map(this::toResponse).toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    /**
     * ARCHIVED → ACTIVE. The inverse of archivePolicy, so an accidental
     * archive is recoverable from the product rather than from psql.
     */
    @Transactional
    public PolicyResponse unarchivePolicy(UUID policyId) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        if (policy.getStatus() != PolicyStatus.ARCHIVED) {
            throw new com.hrms.core.exception.BusinessRuleException(
                    "Only an archived policy can be restored (current status: " + policy.getStatus() + ")",
                    "POLICY_NOT_ARCHIVED");
        }
        policy.setStatus(PolicyStatus.ACTIVE);
        policy = policyRepository.save(policy);
        log.info("Policy {} restored from ARCHIVED to ACTIVE", policyId);
        return toResponse(policy);
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
        // B7 FIX (audit 2026-08-15): acks are now per-version, not
        // per-policy — bumping the policy version forces re-ack. Look up
        // whether an ack already exists for THIS version.
        String currentVersion = policy.getPolicyVersion();
        boolean alreadyAcked = ackRepository.findByEmployeeId(employeeId).stream()
                .filter(a -> a.getPolicyId().equals(policy.getId()))
                .anyMatch(a -> java.util.Objects.equals(a.getPolicyVersion(), currentVersion));
        if (alreadyAcked) {
            log.debug("Policy {} version {} already acknowledged by employee {} — skipping",
                    policyId, currentVersion, employeeId);
            return;
        }
        PolicyAcknowledgement ack = new PolicyAcknowledgement();
        ack.setTenantId(TenantContext.getTenantId());
        ack.setPolicyId(policy.getId());
        ack.setEmployeeId(employeeId);
        ack.setAcknowledgedAt(Instant.now());
        ack.setPolicyVersion(currentVersion);
        ackRepository.save(ack);
        log.info("Policy {} version {} acknowledged by employee {}", policyId, currentVersion, employeeId);
    }

    /**
     * B7 FIX (audit 2026-08-15): true if {@code employeeId} has NOT yet
     * acknowledged the CURRENT version of {@code policyId}. Existing-ack
     * check is version-aware: a prior ack for an older version does NOT
     * satisfy a newly bumped policy.
     */
    @Transactional(readOnly = true)
    public boolean needsAcknowledgment(UUID policyId, UUID employeeId) {
        HrPolicy policy = policyRepository.findById(policyId)
                .orElseThrow(() -> new ResourceNotFoundException("HrPolicy", policyId));
        String currentVersion = policy.getPolicyVersion();
        return ackRepository.findByEmployeeId(employeeId).stream()
                .filter(a -> a.getPolicyId().equals(policy.getId()))
                .noneMatch(a -> java.util.Objects.equals(a.getPolicyVersion(), currentVersion));
    }

    @Transactional(readOnly = true)
    public PageResponse<AcknowledgementResponse> getAcknowledgements(UUID policyId, Pageable pageable) {
        Page<PolicyAcknowledgement> page = ackRepository.findByPolicyIdOrderByAcknowledgedAtDesc(policyId, pageable);
        List<AcknowledgementResponse> content = page.getContent().stream().map(this::toAck).toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    /**
     * Policies this employee has acknowledged AT THEIR CURRENT VERSION.
     *
     * <p>2026-09-09: this returned bare policy ids with no version filter,
     * while acknowledge() and needsAcknowledgment() are both version-aware
     * (B7, 2026-08-15). The two disagreed the moment an admin bumped a
     * version: the backend correctly treated everyone as un-acknowledged, but
     * the SPA builds its ackSet from this list, so it kept rendering the
     * static "You acknowledged this policy" label and never re-rendered the
     * Acknowledge button. Re-acknowledgement was impossible from the web —
     * for the exact policy change that required it.
     *
     * <p>Filtering here rather than in the SPA keeps the rule in one place:
     * an ack counts only against the version it was given for.
     */
    @Transactional(readOnly = true)
    public List<UUID> getMyAcknowledgedPolicyIds(UUID employeeId) {
        List<PolicyAcknowledgement> acks = ackRepository.findByEmployeeId(employeeId);
        if (acks.isEmpty()) return List.of();

        // One lookup per distinct policy, not per ack row.
        java.util.Map<UUID, String> currentVersionByPolicy = new java.util.HashMap<>();
        for (PolicyAcknowledgement a : acks) {
            currentVersionByPolicy.computeIfAbsent(a.getPolicyId(), id ->
                    policyRepository.findById(id).map(HrPolicy::getPolicyVersion).orElse(null));
        }

        return acks.stream()
                .filter(a -> java.util.Objects.equals(
                        a.getPolicyVersion(), currentVersionByPolicy.get(a.getPolicyId())))
                .map(PolicyAcknowledgement::getPolicyId)
                .distinct()
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
                // Count acks for THIS version only — see
                // countByPolicyIdAndPolicyVersion. Counting every version made
                // the compliance figure read 100% right after a version bump,
                // when the true figure for the current text was 0%.
                ackRepository.countByPolicyIdAndPolicyVersion(p.getId(), p.getPolicyVersion()),
                p.getCreatedAt());
    }

    private AcknowledgementResponse toAck(PolicyAcknowledgement a) {
        return new AcknowledgementResponse(
                a.getId(), a.getPolicyId(), a.getEmployeeId(), null, null, a.getAcknowledgedAt());
    }
}
