package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.performance.dto.ReviewSubmitRequest;
import com.hrms.performance.entity.PerformanceReview;
import com.hrms.performance.enums.ReviewStatus;
import com.hrms.performance.repository.PerformanceReviewRepository;
import com.hrms.performance.service.PerformanceReviewService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ReviewAssignmentAuthorizationTest {
    private final PerformanceReviewRepository repository = mock(PerformanceReviewRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PerformanceReviewService service = new PerformanceReviewService(repository, jdbc);
    private final UUID reviewId = UUID.randomUUID(), employee = UUID.randomUUID(), reviewer = UUID.randomUUID();
    private final UUID tenant = UUID.randomUUID();
    private final ReviewSubmitRequest valid = new ReviewSubmitRequest(BigDecimal.valueOf(4), "Strength", "Improve");

    @BeforeEach void setTenant() {
        com.hrms.core.tenant.TenantContext.setTenantId(tenant);
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenant);
    }

    @AfterEach void clearTenant() {
        com.hrms.core.tenant.TenantContext.clear();
        com.unifiedtree.security.tenant.TenantContext.clear();
    }

    private PerformanceReview pending(UUID assignedReviewer) {
        PerformanceReview review = new PerformanceReview();
        review.setId(reviewId);
        review.setEmployeeId(employee);
        review.setReviewerId(assignedReviewer);
        when(repository.findById(reviewId)).thenReturn(Optional.of(review));
        when(repository.saveAndFlush(review)).thenReturn(review);
        return review;
    }

    @Test void revieweeCannotSubmitTheManagerOrPeerReview() {
        pending(reviewer);
        assertThrows(BusinessRuleException.class, () -> service.submitReview(reviewId, employee, valid));
        verify(repository, never()).saveAndFlush(any());
        verifyNoInteractions(jdbc);
    }

    @Test void assignedReviewerCanSubmitAndCompletesAssignment() {
        pending(reviewer);
        assertEquals(ReviewStatus.SUBMITTED, service.submitReview(reviewId, reviewer, valid).status());
        verify(repository).saveAndFlush(any());
        verify(jdbc).update(contains("status = 'COMPLETED'"), eq(reviewId), eq(tenant));
    }

    @Test void legacyUnassignedSelfReviewStillWorks() {
        pending(null);
        assertEquals(ReviewStatus.SUBMITTED, service.submitReview(reviewId, employee, valid).status());
    }

    @Test void unrelatedEmployeeCannotSubmit() {
        pending(reviewer);
        assertThrows(BusinessRuleException.class, () -> service.submitReview(reviewId, UUID.randomUUID(), valid));
        verify(repository, never()).saveAndFlush(any());
    }

    @Test void myReviewsIncludeAssignedWorkAndFeedbackAboutMe() {
        when(repository.findByEmployeeIdOrReviewerIdOrderByCreatedAtDesc(employee, employee)).thenReturn(List.of());
        assertTrue(service.getMyReviews(employee).isEmpty());
        verify(repository).findByEmployeeIdOrReviewerIdOrderByCreatedAtDesc(employee, employee);
    }

    @Test void outOfRangeRatingIsRejectedBeforeWrite() {
        pending(reviewer);
        assertThrows(BusinessRuleException.class, () -> service.submitReview(reviewId, reviewer,
                new ReviewSubmitRequest(BigDecimal.valueOf(6), null, null)));
        verify(repository, never()).saveAndFlush(any());
    }
}
