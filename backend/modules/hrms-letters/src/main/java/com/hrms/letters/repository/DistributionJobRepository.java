package com.hrms.letters.repository;

import com.hrms.letters.domain.DistributionJob;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface DistributionJobRepository extends JpaRepository<DistributionJob, UUID> {

    Page<DistributionJob> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
