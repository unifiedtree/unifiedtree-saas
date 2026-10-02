package com.hrms.performance.repository;

import com.hrms.performance.entity.PerformanceReview;
import com.hrms.performance.enums.ReviewStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface PerformanceReviewRepository extends JpaRepository<PerformanceReview, UUID> {

    List<PerformanceReview> findByEmployeeIdOrderByCreatedAtDesc(UUID employeeId);

    List<PerformanceReview> findByEmployeeIdOrReviewerIdOrderByCreatedAtDesc(UUID employeeId, UUID reviewerId);

    Page<PerformanceReview> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<PerformanceReview> findByCycleIdOrderByCreatedAtDesc(UUID cycleId, Pageable pageable);

    Page<PerformanceReview> findByEmployeeIdInOrderByCreatedAtDesc(java.util.Collection<UUID> employeeIds, Pageable pageable);

    Page<PerformanceReview> findByCycleIdAndEmployeeIdInOrderByCreatedAtDesc(UUID cycleId, java.util.Collection<UUID> employeeIds, Pageable pageable);

    // Status filters for the Employee reviews list (redesign BW-81).
    Page<PerformanceReview> findByStatusInOrderByCreatedAtDesc(Collection<ReviewStatus> statuses, Pageable pageable);

    Page<PerformanceReview> findByCycleIdAndStatusInOrderByCreatedAtDesc(UUID cycleId, Collection<ReviewStatus> statuses, Pageable pageable);

    Page<PerformanceReview> findByEmployeeIdInAndStatusInOrderByCreatedAtDesc(Collection<UUID> employeeIds, Collection<ReviewStatus> statuses, Pageable pageable);

    Page<PerformanceReview> findByCycleIdAndEmployeeIdInAndStatusInOrderByCreatedAtDesc(UUID cycleId, Collection<UUID> employeeIds, Collection<ReviewStatus> statuses, Pageable pageable);
}
