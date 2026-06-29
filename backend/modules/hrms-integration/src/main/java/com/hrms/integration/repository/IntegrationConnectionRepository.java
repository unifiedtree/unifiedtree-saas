package com.hrms.integration.repository;

import com.hrms.integration.entity.IntegrationConnection;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface IntegrationConnectionRepository extends JpaRepository<IntegrationConnection, UUID> {

    Page<IntegrationConnection> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<IntegrationConnection> findByCompanyIdOrderByCreatedAtDesc(UUID companyId, Pageable pageable);
}
