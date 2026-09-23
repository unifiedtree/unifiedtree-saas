package com.hrms.compliance.repository;

import com.hrms.compliance.entity.StatutoryFiling;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface StatutoryFilingRepository extends JpaRepository<StatutoryFiling, UUID> {
    @org.springframework.data.jpa.repository.Query("select f from StatutoryFiling f where (:companyId is null or f.companyId = :companyId) and f.dueDate between :from and :to order by f.dueDate")
    java.util.List<StatutoryFiling> calendar(java.util.UUID companyId, java.time.LocalDate from, java.time.LocalDate to);

    Page<StatutoryFiling> findByCompanyIdOrderByDueDateDesc(UUID companyId, Pageable pageable);

    Page<StatutoryFiling> findAllByOrderByDueDateDesc(Pageable pageable);
}
