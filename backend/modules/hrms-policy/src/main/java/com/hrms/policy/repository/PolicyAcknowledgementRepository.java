package com.hrms.policy.repository;

import com.hrms.policy.entity.PolicyAcknowledgement;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PolicyAcknowledgementRepository extends JpaRepository<PolicyAcknowledgement, UUID> {

    boolean existsByPolicyIdAndEmployeeId(UUID policyId, UUID employeeId);

    long countByPolicyId(UUID policyId);

    /**
     * Acks recorded against ONE specific version of a policy.
     *
     * <p>2026-09-09: acknowledgementCount used countByPolicyId, which counts
     * every version ever acknowledged. After an admin bumped a policy's
     * version — the moment re-acknowledgement actually matters — the
     * compliance figure still read 100% while the true figure for the current
     * text was 0%. That is a number an auditor would rely on.
     */
    long countByPolicyIdAndPolicyVersion(UUID policyId, String policyVersion);

    Page<PolicyAcknowledgement> findByPolicyIdOrderByAcknowledgedAtDesc(UUID policyId, Pageable pageable);

    List<PolicyAcknowledgement> findByEmployeeId(UUID employeeId);
}
