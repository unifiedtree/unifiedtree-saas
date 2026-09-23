package com.hrms.compliance.repository;

import com.hrms.compliance.entity.InspectorSession;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface InspectorSessionRepository extends JpaRepository<InspectorSession, UUID> {
    Page<InspectorSession> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);
    Page<InspectorSession> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
