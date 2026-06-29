package com.hrms.compliance.repository;

import com.hrms.compliance.entity.ComplianceItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ComplianceItemRepository extends JpaRepository<ComplianceItem, UUID> {

    Page<ComplianceItem> findByCompanyIdOrderByDueDateAsc(UUID companyId, Pageable pageable);

    Page<ComplianceItem> findAllByOrderByDueDateAsc(Pageable pageable);
}
