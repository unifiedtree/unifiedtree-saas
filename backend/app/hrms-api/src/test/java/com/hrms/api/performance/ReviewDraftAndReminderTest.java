package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.performance.dto.ReviewSubmitRequest;
import com.hrms.performance.entity.PerformanceReview;
import com.hrms.performance.enums.ReviewStatus;
import com.hrms.performance.repository.PerformanceReviewRepository;
import com.hrms.performance.service.PerformanceReviewService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** BW-84 drafts (writer only, then submitted as usual) and BW-80 Remind (notifies the writer, throttle kept). */
class ReviewDraftAndReminderTest {

    private final UUID tenant = UUID.randomUUID(), reviewId = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID(), reviewer = UUID.randomUUID();
    private final PerformanceReviewRepository repository = mock(PerformanceReviewRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PerformanceReviewService reviews = new PerformanceReviewService(repository, jdbc);

    @BeforeEach void setTenant() {
        com.hrms.core.tenant.TenantContext.setTenantId(tenant);
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenant);
    }

    @AfterEach void clearTenant() {
        com.hrms.core.tenant.TenantContext.clear();
        com.unifiedtree.security.tenant.TenantContext.clear();
    }

    private PerformanceReview review(ReviewStatus status) {
        PerformanceReview r = new PerformanceReview();
        r.setId(reviewId);
        r.setEmployeeId(employee);
        r.setReviewerId(reviewer);
        r.setStatus(status);
        when(repository.findById(reviewId)).thenReturn(Optional.of(r));
        when(repository.saveAndFlush(r)).thenReturn(r);
        return r;
    }

    // ── drafts ───────────────────────────────────────────────────────────────

    @Test void onlyTheWriterSavesADraft() {
        review(ReviewStatus.PENDING);
        assertEquals("PERFORMANCE_REVIEW_FORBIDDEN", assertThrows(BusinessRuleException.class,
                () -> reviews.saveDraft(reviewId, employee, null, "x", null)).getErrorCode());
        assertThrows(BusinessRuleException.class, () -> reviews.saveDraft(reviewId, null, null, "x", null));
        verify(repository, never()).saveAndFlush(any());
    }

    @Test void aDraftBecomesInProgressWithItsFields() {
        PerformanceReview r = review(ReviewStatus.PENDING);
        assertEquals(ReviewStatus.IN_PROGRESS, reviews.saveDraft(reviewId, reviewer, new BigDecimal("4"), "Led it", null).status());
        assertEquals("Led it", r.getStrengths());
        assertEquals(new BigDecimal("4"), r.getOverallRating());
        verify(jdbc).update(contains("SET status = 'IN_PROGRESS'"), eq(reviewId), eq(tenant));
    }

    @Test void aSubmittedReviewIsNoLongerADraft() {
        review(ReviewStatus.SUBMITTED);
        assertEquals("PERFORMANCE_REVIEW_NOT_PENDING", assertThrows(BusinessRuleException.class,
                () -> reviews.saveDraft(reviewId, reviewer, null, "x", null)).getErrorCode());
    }

    @Test void draftRatingsStayWithinZeroToFive() {
        review(ReviewStatus.IN_PROGRESS);
        assertEquals("PERFORMANCE_RATING_INVALID", assertThrows(BusinessRuleException.class,
                () -> reviews.saveDraft(reviewId, reviewer, new BigDecimal("5.5"), null, null)).getErrorCode());
    }

    @Test void aDraftIsSubmittedTheUsualWay() {
        review(ReviewStatus.IN_PROGRESS);
        assertEquals(ReviewStatus.SUBMITTED, reviews.submitReview(reviewId, reviewer,
                new ReviewSubmitRequest(BigDecimal.valueOf(4), "Strength", "Improve")).status());
    }

    // ── Remind ───────────────────────────────────────────────────────────────

    @Test void reminderWordsNameTheReviewAndTheDueDate() {
        Map<String, String> self = AppraisalCycleService.reminderValues(true, "Reader User", "Q3 check-in", LocalDate.of(2026, 9, 30));
        assertEquals("your self-review", self.get("reviewText"));
        assertEquals(" by 30 Sep 2026", self.get("dueText"));
        Map<String, String> other = AppraisalCycleService.reminderValues(false, "Reader User", null, null);
        assertEquals("your review of Reader User", other.get("reviewText"));
        assertEquals("the review cycle", other.get("cycleName"));
        assertEquals("", other.get("dueText"));
    }

    private void reminderTarget(String status, java.sql.Timestamp lastSent) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(true);
        when(rs.getString("status")).thenReturn(status);
        when(rs.getTimestamp("reminder_sent_at")).thenReturn(lastSent);
        when(rs.getInt("reminder_count")).thenReturn(lastSent == null ? 0 : 1);
        when(rs.getObject("employee_id", UUID.class)).thenReturn(employee);
        when(rs.getObject("reviewer_id", UUID.class)).thenReturn(reviewer);
        when(rs.getString("cycle_name")).thenReturn("Q3 check-in");
        when(rs.getString("reviewee_name")).thenReturn("Reader User");
        when(jdbc.query(contains("SELECT r.status, r.reminder_sent_at"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(false);
    }

    @Test void remindNotifiesTheReviewerInThisTenant() throws Exception {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        AppraisalCycleService service = new AppraisalCycleService(jdbc, dispatcher, mock(AuditService.class));
        reminderTarget("IN_PROGRESS", null);
        assertEquals(1, service.remind(tenant, reviewId, UUID.randomUUID()).newReminderCount());
        verify(jdbc).query(contains("WHERE r.tenant_id = ? AND r.id = ?"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), eq(tenant), eq(reviewId));
        verify(jdbc).update(contains("WHERE tenant_id = ? AND id = ?"), eq(1), eq(tenant), eq(reviewId));
        verify(dispatcher).dispatch(eq(tenant), eq(reviewer), eq("performance.review_reminder"),
                argThat((Map<String, String> v) -> "your review of Reader User".equals(v.get("reviewText"))), anyMap());
    }

    @Test void theDailyThrottleStaysAndNothingIsSentTwice() throws Exception {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        AppraisalCycleService service = new AppraisalCycleService(jdbc, dispatcher, mock(AuditService.class));
        reminderTarget("PENDING", new java.sql.Timestamp(System.currentTimeMillis() - 3_600_000L));
        assertEquals("REMINDER_THROTTLED", assertThrows(BusinessRuleException.class,
                () -> service.remind(tenant, reviewId, UUID.randomUUID())).getErrorCode());
        verifyNoInteractions(dispatcher);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void aSubmittedReviewCantBeReminded() throws Exception {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        AppraisalCycleService service = new AppraisalCycleService(jdbc, dispatcher, mock(AuditService.class));
        reminderTarget("SUBMITTED", null);
        assertThrows(BusinessRuleException.class, () -> service.remind(tenant, reviewId, UUID.randomUUID()));
        verifyNoInteractions(dispatcher);
    }
}
