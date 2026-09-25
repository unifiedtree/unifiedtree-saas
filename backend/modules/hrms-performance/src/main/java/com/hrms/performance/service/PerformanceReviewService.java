package com.hrms.performance.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.performance.dto.PerformanceReviewRequest;
import com.hrms.performance.dto.PerformanceReviewResponse;
import com.hrms.performance.dto.ReviewSubmitRequest;
import com.hrms.performance.entity.PerformanceReview;
import com.hrms.performance.enums.ReviewStatus;
import com.hrms.performance.repository.PerformanceReviewRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class PerformanceReviewService {

    private static final Logger log = LoggerFactory.getLogger(PerformanceReviewService.class);

    private final PerformanceReviewRepository reviewRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public PerformanceReviewService(PerformanceReviewRepository reviewRepository, org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.reviewRepository = reviewRepository;
        this.jdbc = jdbc;
    }

    @Transactional
    public PerformanceReviewResponse createReview(UUID reviewerId, PerformanceReviewRequest request) {
        PerformanceReview review = new PerformanceReview();
        review.setTenantId(TenantContext.getTenantId());
        review.setCycleId(request.cycleId());
        review.setEmployeeId(request.employeeId());
        review.setReviewerId(reviewerId);
        review.setStatus(ReviewStatus.PENDING);
        review = reviewRepository.save(review);
        log.info("Performance review created id={} employee={} cycle={}",
                review.getId(), request.employeeId(), request.cycleId());
        return toResponse(review);
    }

    @Transactional(readOnly = true)
    public List<PerformanceReviewResponse> getMyReviews(UUID employeeId) {
        return reviewRepository.findByEmployeeIdOrReviewerIdOrderByCreatedAtDesc(employeeId, employeeId).stream()
                .map(this::toResponse).toList();
    }

    /**
     * Reviews about the given employees only (a manager's team). {@code null}
     * means no restriction; an empty set returns an empty page.
     */
    @Transactional(readOnly = true)
    public PageResponse<PerformanceReviewResponse> listReviews(UUID cycleId, java.util.Set<UUID> employeeIds, Pageable pageable) {
        if (employeeIds == null) return listReviews(cycleId, pageable);
        if (employeeIds.isEmpty()) return toPage(Page.empty(pageable));
        Page<PerformanceReview> page = cycleId != null
                ? reviewRepository.findByCycleIdAndEmployeeIdInOrderByCreatedAtDesc(cycleId, employeeIds, pageable)
                : reviewRepository.findByEmployeeIdInOrderByCreatedAtDesc(employeeIds, pageable);
        return toPage(page);
    }

    @Transactional(readOnly = true)
    public PageResponse<PerformanceReviewResponse> listReviews(UUID cycleId, Pageable pageable) {
        Page<PerformanceReview> page = cycleId != null
                ? reviewRepository.findByCycleIdOrderByCreatedAtDesc(cycleId, pageable)
                : reviewRepository.findAllByOrderByCreatedAtDesc(pageable);
        return toPage(page);
    }

    @Transactional
    public PerformanceReviewResponse submitReview(UUID reviewId, UUID employeeId, ReviewSubmitRequest request) {
        PerformanceReview review = reviewRepository.findById(reviewId)
                .orElseThrow(() -> new ResourceNotFoundException("PerformanceReview", reviewId));
        UUID assignedReviewer = review.getReviewerId() != null ? review.getReviewerId() : review.getEmployeeId();
        if (!assignedReviewer.equals(employeeId)) {
            throw new BusinessRuleException(
                    "Only the assigned reviewer can submit this performance review",
                    "PERFORMANCE_REVIEW_FORBIDDEN");
        }
        if (request.overallRating() == null || request.overallRating().signum() < 0
                || request.overallRating().compareTo(java.math.BigDecimal.valueOf(5)) > 0) {
            throw new BusinessRuleException("Review rating must be between 0 and 5", "PERFORMANCE_RATING_INVALID");
        }
        if (review.getStatus() != ReviewStatus.PENDING) {
            throw new BusinessRuleException(
                    "Only a pending review can be submitted (current status: " + review.getStatus() + ")",
                    "PERFORMANCE_REVIEW_NOT_PENDING");
        }
        review.setOverallRating(request.overallRating());
        review.setStrengths(request.strengths());
        review.setImprovements(request.improvements());
        review.setStatus(ReviewStatus.SUBMITTED);
        review.setSubmittedAt(Instant.now());
        review = reviewRepository.saveAndFlush(review);
        jdbc.update("UPDATE performance_mgmt.appraisal_reviewer_assignments SET status = 'COMPLETED', updated_at = now(), version = version + 1 WHERE review_id = ? AND tenant_id = ?",
                reviewId, TenantContext.getTenantId());
        log.info("Performance review {} submitted by employee={}", reviewId, employeeId);
        return toResponse(review);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<PerformanceReviewResponse> toPage(Page<PerformanceReview> page) {
        List<PerformanceReviewResponse> content = page.getContent().stream()
                .map(this::toResponse)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private PerformanceReviewResponse toResponse(PerformanceReview r) {
        return new PerformanceReviewResponse(
                r.getId(), r.getCycleId(), r.getEmployeeId(), null, null,
                r.getReviewerId(), null, r.getStatus(), r.getOverallRating(),
                r.getStrengths(), r.getImprovements(), r.getSubmittedAt(), r.getCreatedAt(), null);
    }
}
