package com.hrms.leave.repository;

import com.hrms.leave.entity.LeaveType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface LeaveTypeRepository extends JpaRepository<LeaveType, UUID> {

    List<LeaveType> findByCompanyIdAndActiveTrue(UUID companyId);

    Optional<LeaveType> findByCompanyIdAndCode(UUID companyId, String code);
}
