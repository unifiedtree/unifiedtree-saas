package com.unifiedtree.settings.repository;

import com.unifiedtree.settings.entity.HrConfiguration;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface HrConfigurationRepository extends JpaRepository<HrConfiguration, UUID> {
    Optional<HrConfiguration> findByCompanyId(UUID companyId);
}
