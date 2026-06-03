package com.hrms.employee.repository;

import com.hrms.employee.entity.OnboardingTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface OnboardingTemplateRepository extends JpaRepository<OnboardingTemplate, UUID> {

    List<OnboardingTemplate> findByCompanyIdAndActiveTrueOrderByNameAsc(UUID companyId);

    /** All active templates for the current tenant (RLS-scoped) when no company filter is given. */
    List<OnboardingTemplate> findByActiveTrueOrderByNameAsc();

    List<OnboardingTemplate> findByCompanyIdAndDesignationIdAndActiveTrueOrderByNameAsc(
            UUID companyId, UUID designationId);

    List<OnboardingTemplate> findByCompanyIdAndDepartmentIdAndActiveTrueOrderByNameAsc(
            UUID companyId, UUID departmentId);
}
