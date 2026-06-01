package com.hrms.tenant.repository;

import com.hrms.tenant.entity.Company;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CompanyRepository extends JpaRepository<Company, UUID> {

    Optional<Company> findByDomain(String domain);

    List<Company> findByTenantIdAndIsActiveTrue(UUID tenantId);

    boolean existsByTenantIdAndDomain(UUID tenantId, String domain);
}
