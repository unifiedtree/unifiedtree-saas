package com.hrms.attendance.repository;

import com.hrms.attendance.entity.ShiftPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ShiftPolicyRepository extends JpaRepository<ShiftPolicy, UUID> {

    List<ShiftPolicy> findByCompanyIdAndActiveTrue(UUID companyId);

    /** Every shift the company ever had, archived ones included. */
    long countByCompanyId(UUID companyId);

    /** Every shift the company ever had, archived ones included (V143.23: the "Standard 9-6 only" check). */
    List<ShiftPolicy> findByCompanyId(UUID companyId);
}
