package com.hrms.advance.repository;

import com.hrms.advance.entity.AdvanceRequest;
import com.hrms.advance.enums.AdvanceStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface AdvanceRequestRepository extends JpaRepository<AdvanceRequest, UUID> {

    Page<AdvanceRequest> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId, Pageable pageable);

    Page<AdvanceRequest> findByStatusOrderByCreatedAtDesc(AdvanceStatus status, Pageable pageable);
}
