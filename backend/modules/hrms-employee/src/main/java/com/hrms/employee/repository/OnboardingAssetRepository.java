package com.hrms.employee.repository;

import com.hrms.employee.entity.OnboardingAsset;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OnboardingAssetRepository extends JpaRepository<OnboardingAsset, UUID> {
    List<OnboardingAsset> findByCompanyIdOrderByCreatedAtDesc(UUID companyId);
    List<OnboardingAsset> findAllByOrderByCreatedAtDesc();
}
