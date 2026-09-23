package com.hrms.pli.repository;

import com.hrms.pli.entity.PliTarget;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PliTargetRepository extends JpaRepository<PliTarget, UUID> {
    Page<PliTarget> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);
    Page<PliTarget> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
