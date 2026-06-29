package com.hrms.performance.repository;

import com.hrms.performance.entity.ReviewCycle;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ReviewCycleRepository extends JpaRepository<ReviewCycle, UUID> {

    List<ReviewCycle> findAllByOrderByPeriodStartDesc();

    List<ReviewCycle> findByCompanyIdOrderByPeriodStartDesc(UUID companyId);
}
