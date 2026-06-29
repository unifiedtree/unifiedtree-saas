package com.hrms.compliance.repository;

import com.hrms.compliance.entity.PoshComplaint;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PoshComplaintRepository extends JpaRepository<PoshComplaint, UUID> {

    Page<PoshComplaint> findByCompanyIdOrderByFiledDateDesc(UUID companyId, Pageable pageable);

    Page<PoshComplaint> findAllByOrderByFiledDateDesc(Pageable pageable);

    boolean existsByComplaintNo(String complaintNo);
}
