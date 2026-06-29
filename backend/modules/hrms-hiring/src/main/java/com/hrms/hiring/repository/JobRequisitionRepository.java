package com.hrms.hiring.repository;

import com.hrms.hiring.entity.JobRequisition;
import com.hrms.hiring.enums.RequisitionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface JobRequisitionRepository extends JpaRepository<JobRequisition, UUID> {

    Page<JobRequisition> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<JobRequisition> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);

    Page<JobRequisition> findByStatusOrderByCreatedAtDesc(RequisitionStatus status, Pageable pageable);
}
