package com.hrms.compliance.repository;

import com.hrms.compliance.entity.ComplianceItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ComplianceItemRepository extends JpaRepository<ComplianceItem, UUID> {
    @org.springframework.data.jpa.repository.Query("select i from ComplianceItem i where (:companyId is null or i.companyId = :companyId) and i.dueDate between :from and :to order by i.dueDate")
    java.util.List<ComplianceItem> calendar(java.util.UUID companyId, java.time.LocalDate from, java.time.LocalDate to);

    Page<ComplianceItem> findByCompanyIdOrderByDueDateAsc(UUID companyId, Pageable pageable);

    Page<ComplianceItem> findAllByOrderByDueDateAsc(Pageable pageable);
}
