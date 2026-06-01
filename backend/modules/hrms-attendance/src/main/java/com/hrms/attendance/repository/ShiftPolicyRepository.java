package com.hrms.attendance.repository;

import com.hrms.attendance.entity.ShiftPolicy;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ShiftPolicyRepository extends JpaRepository<ShiftPolicy, UUID> {

    List<ShiftPolicy> findByCompanyIdAndActiveTrue(UUID companyId);
}
