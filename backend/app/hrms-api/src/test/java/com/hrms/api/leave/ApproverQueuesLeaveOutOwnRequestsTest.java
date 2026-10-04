package com.hrms.api.leave;

import com.hrms.api.wfh.WfhController;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.dto.WfhRequestResponse;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.hrms.leave.service.WfhService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Audit 5 Oct 2026: an owner's own leave sat in their own "Waiting for your OK"
 * queue (and counted under "Needs your action") with Approve and Reject, which
 * the server always refuses (SELF_APPROVAL_NOT_ALLOWED / WFH_SELF_APPROVAL).
 * The HR / admin queues now leave out the caller's own requests, as the
 * managers' queues always have. Another HR manager or admin still decides them.
 */
class ApproverQueuesLeaveOutOwnRequestsTest {

    private final UUID tenant = UUID.randomUUID(), me = UUID.randomUUID();
    private final Pageable page = Pageable.ofSize(20);
    private LeaveService leaveService;
    private WfhService wfhService;
    private EmployeeRepository employees;
    private LeaveController leave;
    private WfhController wfh;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        leaveService = mock(LeaveService.class);
        wfhService = mock(WfhService.class);
        employees = mock(EmployeeRepository.class);
        WorkforceDepartmentRepository departments = mock(WorkforceDepartmentRepository.class);
        ApproverFallbackResolver fallback = mock(ApproverFallbackResolver.class);
        leave = new LeaveController(leaveService, mock(LeaveTypeService.class), employees, departments, fallback);
        wfh = new WfhController(wfhService, employees, departments, fallback);
        PageResponse<LeaveRequestResponse> none = new PageResponse<>(List.of(), 0, 20, 0, 0, true);
        when(leaveService.getAllPending(any(), any())).thenReturn(none);
        when(leaveService.getPendingL2Approvals(any(), any())).thenReturn(none);
        when(leaveService.getPendingApprovalsForManager(any(), any())).thenReturn(none);
        when(leaveService.getMyLeaves(any(), any())).thenReturn(none);
        when(leaveService.getMyBalances(any(), anyInt())).thenReturn(List.of());
        PageResponse<WfhRequestResponse> noWfh = new PageResponse<>(List.of(), 0, 20, 0, 0, true);
        when(wfhService.getAllPending(any(), any())).thenReturn(noWfh);
        when(wfhService.getPendingApprovalsForManager(any(), any())).thenReturn(noWfh);
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private Jwt tokenOf(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).build();
    }

    private static Authentication holding(String... permissions) {
        return new TestingAuthenticationToken("someone", null, permissions);
    }

    @Test void hrAndAdminQueuesAreTheWorkspaceWithoutTheirOwnRequests() {
        Authentication hr = holding("hrms.leave.approve.l1", "hrms.leave.approve.l2", "wfh.approve");
        leave.pendingApprovals(tokenOf(me), hr, page);
        verify(leaveService).getAllPending(eq(me), eq(page));

        leave.pendingL2Approvals(tokenOf(me), page);
        verify(leaveService).getPendingL2Approvals(eq(me), eq(page));

        wfh.pendingApprovals(tokenOf(me), hr, page);
        verify(wfhService).getAllPending(eq(me), eq(page));

        // The mobile overview's "approvals waiting" count is the same queue.
        leave.overview(tokenOf(me), hr, 2026);
        verify(leaveService).getAllPending(eq(me), eq(Pageable.ofSize(1)));

        // The unfiltered (everyone's) queue is never read for them any more.
        verify(leaveService, never()).getAllPending(any(Pageable.class));
        verify(leaveService, never()).getPendingL2Approvals(any(Pageable.class));
        verify(wfhService, never()).getAllPending(any(Pageable.class));
    }

    @Test void managersKeepTheirOwnQueueUnchanged() {
        Authentication manager = holding("hrms.leave.approve.l1", "wfh.approve");
        leave.pendingApprovals(tokenOf(me), manager, page);
        verify(leaveService).getPendingApprovalsForManager(eq(me), eq(page));
        wfh.pendingApprovals(tokenOf(me), manager, page);
        verify(wfhService).getPendingApprovalsForManager(eq(me), eq(page));
        verify(leaveService, never()).getAllPending(any(), any());
        verify(wfhService, never()).getAllPending(any(), any());
    }

    @Test void aTokenThatNamesNobodyLeavesNothingOut() {
        Jwt noId = Jwt.withTokenValue("t").header("alg", "none").subject("not-a-uuid").build();
        Authentication hr = holding("hrms.leave.approve.l1", "hrms.leave.approve.l2", "wfh.approve");
        leave.pendingApprovals(noId, hr, page);
        verify(leaveService).getAllPending(isNull(), eq(page));
        leave.pendingL2Approvals(noId, page);
        verify(leaveService).getPendingL2Approvals(isNull(), eq(page));
        wfh.pendingApprovals(noId, hr, page);
        verify(wfhService).getAllPending(isNull(), eq(page));
    }
}
