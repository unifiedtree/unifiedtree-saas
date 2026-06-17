package com.hrms.employee.repository;

import com.hrms.employee.entity.OnboardingInstance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface OnboardingInstanceRepository extends JpaRepository<OnboardingInstance, UUID> {

    List<OnboardingInstance> findByEmployeeId(UUID employeeId);

    Optional<OnboardingInstance> findByEmployeeIdAndStatus(UUID employeeId, String status);

    List<OnboardingInstance> findByStatusOrderByCreatedAtDesc(String status);

    /** All onboarding instances for the current tenant (RLS-scoped), newest first. */
    List<OnboardingInstance> findAllByOrderByCreatedAtDesc();
}
