package com.hrms.performance.repository;

import com.hrms.performance.entity.PerformanceReview;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PerformanceReviewRepository extends JpaRepository<PerformanceReview, UUID> {

    List<PerformanceReview> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId);

    Page<PerformanceReview> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<PerformanceReview> findByCycleIdOrderByCreatedAtDesc(UUID cycleId, Pageable pageable);
}
