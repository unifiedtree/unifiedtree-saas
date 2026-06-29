package com.hrms.policy.repository;

import com.hrms.policy.entity.HrPolicy;
import com.hrms.policy.enums.PolicyStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface HrPolicyRepository extends JpaRepository<HrPolicy, UUID> {

    Page<HrPolicy> findByStatusOrderByEffectiveDateDescCreatedAtDesc(PolicyStatus status, Pageable pageable);
}
