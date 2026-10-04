package com.hrms.leave.service;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.entity.LeaveRequest;
import com.hrms.leave.entity.WfhRequest;
import com.hrms.leave.mapper.LeaveBalanceMapperImpl;
import com.hrms.leave.mapper.LeaveRequestMapperImpl;
import com.hrms.leave.repository.HolidayCalendarRepository;
import com.hrms.leave.repository.LeaveBalanceRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.hrms.leave.repository.LeaveTypeRepository;
import com.hrms.leave.repository.WfhRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The approvers' reads behind the Leave page (audit 5 Oct 2026): the HR / admin
 * queues without the caller's own requests, and the Decided filter's counts
 * with every decided status present.
 */
class ApproverQueueReadsTest {

    private final UUID me = UUID.randomUUID();
    private final Pageable page = Pageable.ofSize(20);
    private LeaveRequestRepository requests;
    private WfhRequestRepository wfhRequests;
    private LeaveService leave;
    private WfhService wfh;

    @BeforeEach void setUp() {
        requests = mock(LeaveRequestRepository.class);
        wfhRequests = mock(WfhRequestRepository.class);
        @SuppressWarnings("unchecked") KafkaTemplate<String, Object> kafka = mock(KafkaTemplate.class);
        leave = new LeaveService(mock(LeaveTypeRepository.class), mock(LeaveBalanceRepository.class), requests,
                mock(HolidayCalendarRepository.class), kafka, new LeaveRequestMapperImpl(), new LeaveBalanceMapperImpl(),
                mock(JdbcTemplate.class), mock(ApplicationEventPublisher.class), false);
        wfh = new WfhService(wfhRequests, mock(ApplicationEventPublisher.class));
        Page<LeaveRequest> none = new PageImpl<>(List.of(), page, 0);
        when(requests.findAllPending(any())).thenReturn(none);
        when(requests.findAllPendingExcept(any(), any())).thenReturn(none);
        when(requests.findByStatus(any(), any())).thenReturn(none);
        when(requests.findByStatusAndEmployeeIdNot(any(), any(), any())).thenReturn(none);
        Page<WfhRequest> noWfh = new PageImpl<>(List.of(), page, 0);
        when(wfhRequests.findAllPending(any())).thenReturn(noWfh);
        when(wfhRequests.findAllPendingExcept(any(), any())).thenReturn(noWfh);
    }

    @Test void anApproversQueueLeavesOutTheirOwnRequests() {
        leave.getAllPending(me, page);
        verify(requests).findAllPendingExcept(me, page);
        leave.getPendingL2Approvals(me, page);
        verify(requests).findByStatusAndEmployeeIdNot(ApprovalStatus.PENDING_L2, me, page);
        wfh.getAllPending(me, page);
        verify(wfhRequests).findAllPendingExcept(me, page);
        verify(requests, never()).findAllPending(any());
        verify(wfhRequests, never()).findAllPending(any());
    }

    @Test void withNobodyToLeaveOutTheQueueIsEveryonesAsBefore() {
        leave.getAllPending(null, page);
        verify(requests).findAllPending(page);
        leave.getPendingL2Approvals(null, page);
        verify(requests).findByStatus(ApprovalStatus.PENDING_L2, page);
        wfh.getAllPending(null, page);
        verify(wfhRequests).findAllPending(page);
        verify(requests, never()).findAllPendingExcept(any(), any());
    }

    @Test void decidedCountsAlwaysHaveApprovedRejectedAndCancelled() {
        // Only approvals so far: the GROUP BY returns one row.
        when(requests.countDecidedForManagerByStatus(me)).thenReturn(List.<Object[]>of(new Object[]{"APPROVED", 1L}));
        Map<String, Long> mine = leave.decidedCounts(me);
        assertEquals(Map.of("APPROVED", 1L, "REJECTED", 0L, "CANCELLED", 0L), mine);
        // Nothing decided at all, tenant-wide.
        when(requests.countAllDecidedByStatus()).thenReturn(List.of());
        assertEquals(Map.of("APPROVED", 0L, "REJECTED", 0L, "CANCELLED", 0L), leave.decidedCounts(null));
        // Other statuses the list shows are still counted.
        when(requests.countAllDecidedByStatus()).thenReturn(List.<Object[]>of(new Object[]{"PENDING_L2", 2L}, new Object[]{"REJECTED", 3L}));
        assertEquals(Map.of("APPROVED", 0L, "REJECTED", 3L, "CANCELLED", 0L, "PENDING_L2", 2L), leave.decidedCounts(null));
    }
}
