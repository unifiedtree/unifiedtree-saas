package com.hrms.api.hiring;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Object-level rules of the interview service that sit in front of any write. */
class InterviewServiceAccessTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final InterviewService service = new InterviewService(jdbc, new ObjectMapper(), events);
    private final UUID interview = UUID.randomUUID(), me = UUID.randomUUID();

    @BeforeEach
    void tenant() { TenantContext.setTenantId(UUID.randomUUID()); }

    @AfterEach
    void clear() { TenantContext.clear(); }

    private void interviewExists(boolean exists, boolean imOnIt) {
        when(jdbc.queryForObject(contains("FROM hiring_mgmt.interviews WHERE"), eq(Integer.class), any(), any())).thenReturn(exists ? 1 : 0);
        when(jdbc.queryForObject(contains("FROM hiring_mgmt.interview_interviewers"), eq(Integer.class), any(), any(), any())).thenReturn(imOnIt ? 1 : 0);
    }

    @Test
    void someoneNotOnTheInterviewCannotSeeItOrScoreIt() {
        interviewExists(true, false);
        assertThrows(AccessDeniedException.class, () -> service.get(interview, me, false));
        var card = new InterviewService.ScorecardRequest(List.of(new InterviewRules.Rating("Coding", 4)), "Good", null, "YES");
        assertThrows(AccessDeniedException.class, () -> service.submitScorecard(interview, me, card, false));
        assertThrows(AccessDeniedException.class, () -> service.submitScorecard(interview, null, card, true));
        verify(jdbc, never()).update(contains("interview_scorecards"), any(Object[].class));
    }

    @Test
    void anUnknownInterviewIsNotFound() {
        interviewExists(false, false);
        assertThrows(ResourceNotFoundException.class, () -> service.get(interview, me, false));
    }

    @Test
    @SuppressWarnings("unchecked")
    void interviewsCannotBeBookedBeforeScreening() {
        UUID candidate = UUID.randomUUID();
        when(jdbc.query(contains("FROM hiring_mgmt.candidates c"), any(RowMapper.class), any(), any()))
                .thenReturn(List.of(new InterviewService.CandidateFacts(candidate, "Priya", "APPLIED", "Engineer")));
        var request = new InterviewRules.Schedule("Round 1", LocalDateTime.now(InterviewRules.IST).plusDays(1), 45, "PHONE", null,
                List.of(me), null, null);
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> service.schedule(candidate, request, UUID.randomUUID()));
        assertEquals("INTERVIEW_STAGE_INVALID", e.getErrorCode());
        verify(jdbc, never()).queryForObject(contains("INSERT INTO hiring_mgmt.interviews"), eq(UUID.class), any(Object[].class));
        verifyNoInteractions(events);
    }
}
