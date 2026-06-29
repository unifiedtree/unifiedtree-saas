package com.hrms.compliance.repository;

import com.hrms.compliance.entity.StatutoryFiling;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface StatutoryFilingRepository extends JpaRepository<StatutoryFiling, UUID> {

    Page<StatutoryFiling> findByCompanyIdOrderByDueDateDesc(UUID companyId, Pageable pageable);

    Page<StatutoryFiling> findAllByOrderByDueDateDesc(Pageable pageable);
}
