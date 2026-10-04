package com.hrms.api.leave;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.dto.LeaveRequestResponse.LeaveConflict;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The details on a leave request row (BW-38): who it went to and who decided,
 * the type's code, the balance, who applied for them, and on the approvers'
 * queues only, what to check. Plus the Decided list's status filter (BW-40)
 * and the holiday edit (BW-46).
 */
class LeaveRequestDetailsTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID waitingId = UUID.randomUUID(), decidedId = UUID.randomUUID(), hrDecidedId = UUID.randomUUID();
    private JdbcTemplate jdbc;
    private LeaveRequestDetails details;
    private final List<List<Object>> overlapArgs = new ArrayList<>();

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
        details = new LeaveRequestDetails(jdbc);
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private static LeaveRequestResponse row(UUID id, ApprovalStatus status) {
        return new LeaveRequestResponse(id, UUID.randomUUID(), "Asha Rao", "E1", "Sales", UUID.randomUUID(), "Casual leave",
                LocalDate.of(2026, 10, 5), LocalDate.of(2026, 10, 6), 2, "Trip", status, null, null, Instant.now());
    }

    private static ResultSet found(UUID id, String approver, String l2, String raisedBy, Timestamp decisionAt,
                                   Timestamp l2At, String requesterStatus) throws SQLException {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(id);
        when(rs.getString("type_code")).thenReturn("CL");
        when(rs.getString("type_category")).thenReturn("CASUAL");
        when(rs.getDouble("bal_available")).thenReturn(4.5);
        when(rs.getDouble("bal_total")).thenReturn(12.0);
        when(rs.getString("approver_name")).thenReturn(approver);
        when(rs.getString("l2_name")).thenReturn(l2);
        when(rs.getString("raised_by_name")).thenReturn(raisedBy);
        when(rs.getTimestamp("decision_at")).thenReturn(decisionAt);
        when(rs.getTimestamp("l2_approved_at")).thenReturn(l2At);
        when(rs.getString("requester_status")).thenReturn(requesterStatus);
        return rs;
    }

    private static ResultSet colleague(UUID requestId, String firstName) throws SQLException {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("request_id", UUID.class)).thenReturn(requestId);
        when(rs.getObject("other_id", UUID.class)).thenReturn(UUID.randomUUID());
        when(rs.getString("first_name")).thenReturn(firstName);
        return rs;
    }

    private void data() {
        Timestamp t1 = Timestamp.from(Instant.parse("2026-09-20T05:00:00Z"));
        Timestamp t2 = Timestamp.from(Instant.parse("2026-09-21T05:00:00Z"));
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            h.processRow(found(waitingId, "Dept Manager", null, "Priya Rao", null, null, "NOTICE_PERIOD"));
            h.processRow(found(decidedId, "Dept Manager", null, null, t1, null, "ACTIVE"));
            h.processRow(found(hrDecidedId, "Dept Manager", "HR Manager", null, t1, t2, "ACTIVE"));
            return null;
        }).when(jdbc).query(contains("LEFT JOIN auth.user_credentials"), any(RowCallbackHandler.class), any(Object[].class));
        doAnswer(inv -> {
            Object[] all = inv.getArguments();
            overlapArgs.add(Arrays.asList(all).subList(2, all.length));
            RowCallbackHandler h = inv.getArgument(1);
            h.processRow(colleague(waitingId, "Kiran"));
            h.processRow(colleague(waitingId, "Meera"));
            return null;
        }).when(jdbc).query(contains("o.status IN ('APPROVED', 'PENDING', 'PENDING_L2')"), any(RowCallbackHandler.class), any(Object[].class));
    }

    @Test void rowsGainNamesTypeCodeBalanceAndWhoApplied() {
        data();
        List<LeaveRequestResponse> out = details.apply(List.of(row(waitingId, ApprovalStatus.PENDING),
                row(decidedId, ApprovalStatus.REJECTED), row(hrDecidedId, ApprovalStatus.APPROVED)), false);
        LeaveRequestResponse waiting = out.get(0), decided = out.get(1), hr = out.get(2);
        assertEquals("CL", waiting.leaveTypeCode());
        assertEquals("CASUAL", waiting.leaveTypeCategory());
        assertEquals(4.5, waiting.balanceAvailable());
        assertEquals(12.0, waiting.balanceTotal());
        assertEquals("Dept Manager", waiting.approverName());
        assertNull(waiting.decidedByName(), "nobody has decided yet");
        assertEquals("Priya Rao", waiting.raisedByName());
        assertEquals("Dept Manager", decided.decidedByName());
        assertNull(decided.raisedByName());
        assertEquals("HR Manager", hr.decidedByName(), "the HR step is the latest decision");
        assertEquals("HR Manager", hr.l2ApproverName());
        // The original fields are untouched and the order is kept.
        assertEquals("Asha Rao", waiting.employeeName());
        assertEquals(List.of(waitingId, decidedId, hrDecidedId), out.stream().map(LeaveRequestResponse::id).toList());
        // Conflicts only on the approvers' queues.
        out.forEach(r -> assertNull(r.conflicts()));
        verify(jdbc, never()).query(contains("o.status IN"), any(RowCallbackHandler.class), any(Object[].class));
    }

    @Test void onTheApproversQueueWaitingRowsListWhatToCheck() {
        data();
        List<LeaveRequestResponse> out = details.apply(List.of(row(waitingId, ApprovalStatus.PENDING),
                row(decidedId, ApprovalStatus.APPROVED)), true);
        List<LeaveConflict> checks = out.get(0).conflicts();
        assertEquals(List.of("TEAM_OVERLAP", "ON_NOTICE"), checks.stream().map(LeaveConflict::kind).toList());
        assertEquals(List.of("Kiran", "Meera"), checks.get(0).names());
        assertEquals("Also away on some of these days: Kiran and Meera", checks.get(0).text());
        assertNull(out.get(1).conflicts(), "decided rows have nothing to check");
        // Only the waiting request was looked at, inside this workspace.
        assertEquals(List.of(tenant, waitingId), overlapArgs.get(0));
    }

    @Test void aFailedLookupReturnsTheRowsAsTheyWere() {
        doThrow(new DataAccessResourceFailureException("down"))
                .when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
        List<LeaveRequestResponse> rows = List.of(row(waitingId, ApprovalStatus.PENDING));
        assertSame(rows, details.apply(rows, true));
    }

    @Test void namesReadNaturally() {
        assertEquals("Asha", LeaveRequestDetails.nameList(List.of("Asha")));
        assertEquals("Asha and Ravi", LeaveRequestDetails.nameList(List.of("Asha", "Ravi")));
        assertEquals("Asha, Ravi and Kiran", LeaveRequestDetails.nameList(List.of("Asha", "Ravi", "Kiran")));
        assertEquals("Asha, Ravi, Kiran and 2 more", LeaveRequestDetails.nameList(List.of("Asha", "Ravi", "Kiran", "Meera", "Om")));
        assertTrue(LeaveRequestDetails.conflicts(List.of(), false).isEmpty());
        assertTrue(LeaveRequestDetails.waiting(ApprovalStatus.PENDING_L2));
        assertFalse(LeaveRequestDetails.waiting(null));
    }

    // ── Decided list filter (BW-40) ─────────────────────────────────────────

    @Test void theDecidedListFiltersByAnyDecidedStatusButNotPending() {
        assertNull(LeaveController.decidedStatus(null));
        assertNull(LeaveController.decidedStatus(" "));
        assertEquals(ApprovalStatus.REJECTED, LeaveController.decidedStatus("rejected"));
        assertEquals(ApprovalStatus.PENDING_L2, LeaveController.decidedStatus("PENDING_L2"));
        for (String bad : List.of("PENDING", "maybe")) {
            HrmsException e = assertThrows(HrmsException.class, () -> LeaveController.decidedStatus(bad));
            assertEquals("INVALID_LEAVE_STATUS", e.getErrorCode());
            assertEquals(400, e.getStatus().value());
        }
    }

    @Test void theReadsKeepTheirGuards() throws Exception {
        assertEquals("@perm.check('hrms.leave.approve.l1')", LeaveInsightsController.class
                .getMethod("stats", int.class, Jwt.class, org.springframework.security.core.Authentication.class)
                .getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAnyAuthority('hrms.leave.employee.read','hrms.report.leave')", LeaveInsightsController.class
                .getMethod("balances", UUID.class, Integer.class, String.class, int.class, int.class)
                .getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAuthority('leave.balance.read')", LeaveInsightsController.class
                .getMethod("colleaguesOff", LocalDate.class, LocalDate.class, Jwt.class)
                .getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAuthority('leave.request.self')", LeaveController.class
                .getMethod("preview", UUID.class, LocalDate.class, LocalDate.class, com.hrms.leave.enums.LeaveDuration.class,
                        UUID.class, Jwt.class).getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAuthority('settings.holidays.write')", com.hrms.api.settings.SettingsController.class
                .getMethod("updateHoliday", UUID.class, HolidayEditService.UpdateHolidayRequest.class)
                .getAnnotation(PreAuthorize.class).value());
        // The HR queue stays level-2 only.
        assertEquals("@perm.check('hrms.leave.approve.l2')", LeaveController.class
                .getMethod("pendingL2Approvals", Jwt.class, org.springframework.data.domain.Pageable.class)
                .getAnnotation(PreAuthorize.class).value());
    }
}
