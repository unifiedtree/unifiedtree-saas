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

    public PerformanceReviewService(PerformanceReviewRepository reviewRepository) {
        this.reviewRepository = reviewRepository;
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
        return reviewRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId).stream()
                .map(this::toResponse).toList();
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
        review = reviewRepository.save(review);
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
                r.getStrengths(), r.getImprovements(), r.getSubmittedAt(), r.getCreatedAt());
    }
}
