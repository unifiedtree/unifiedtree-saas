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

    Page<PolicyAcknowledgement> findByPolicyIdOrderByAcknowledgedAtDesc(UUID policyId, Pageable pageable);

    List<PolicyAcknowledgement> findByEmployeeId(UUID employeeId);
}
