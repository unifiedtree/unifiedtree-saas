package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.hrms.core.exception.FeatureNotReady;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionOperations;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-119 "My requests": each kind only with its own list permission and module,
 * one failing kind never fails the list, waiting requests first, and every
 * query reads the caller's own rows in the caller's own workspace.
 */
class MyRequestsServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID ME = UUID.randomUUID();
    private static final Instant T0 = Instant.parse("2026-09-20T05:00:00Z");

    private TenantModuleLookup modules;
    private EssSourceRunner runner;

    @BeforeEach
    void wire() {
        modules = mock(TenantModuleLookup.class);
        when(modules.hasActiveModule(any(), any())).thenReturn(true);
        runner = new EssSourceRunner(modules, TransactionOperations.withoutTransaction());
    }

    private static EssCaller caller(String... perms) {
        return new EssCaller(TENANT, ME, Set.of(perms), null, LocalDate.of(2026, 9, 27));
    }

    /** A stand-in source: fixed rows, or a failure. */
    private static final class Fake implements MyRequestSource {
        final String key, module, perm;
        final List<MyRequest> rows;
        final RuntimeException failure;
        int calls;

        Fake(String key, String module, String perm, List<MyRequest> rows, RuntimeException failure) {
            this.key = key; this.module = module; this.perm = perm; this.rows = rows; this.failure = failure;
        }

        @Override public String key() { return key; }
        @Override public String module() { return module; }
        @Override public boolean allowed(EssCaller caller) { return caller.has(perm); }
        @Override public List<MyRequest> load(EssCaller caller, int limit) {
            calls++;
            if (failure != null) throw failure;
            return rows.stream().limit(limit).toList();
        }
    }

    private static MyRequest row(String kind, String state, Instant created, Instant last) {
        return new MyRequest(kind, UUID.randomUUID(), kind, null, null, null, null, null, state, state, state,
                "WAITING".equals(state) ? 50 : 100, List.of(), null, null, created, last, "/x");
    }

    @Test void aFailingKindIsReportedAndTheOthersStillAnswer() {
        Fake leave = new Fake("LEAVE", "leave", "leave.balance.read", List.of(row("LEAVE", "WAITING", T0, T0)), null);
        Fake broken = new Fake("EXPENSE", "hrms", "hrms.expense.claim.self", List.of(), new IllegalStateException("db down"));
        Fake missing = new Fake("TIMESHEET", "hrms", "attendance.checkin.self", List.of(),
                FeatureNotReady.translate(new BadSqlGrammarException("q", "SELECT 1 FROM hrms.timesheet_weeks",
                        new SQLException("relation does not exist", "42P01"))));
        MyRequest.Response r = new MyRequestsService(List.of(leave, broken, missing), runner)
                .myRequests(caller("leave.balance.read", "hrms.expense.claim.self", "attendance.checkin.self"), null);
        assertEquals(1, r.requests().size());
        assertEquals(List.of("EXPENSE", "TIMESHEET"), r.unavailable());
        assertEquals(List.of("LEAVE"), r.included());
    }

    @Test void aKindIsReadOnlyWithItsOwnPermission() {
        Fake leave = new Fake("LEAVE", "leave", "leave.balance.read", List.of(row("LEAVE", "WAITING", T0, T0)), null);
        Fake wfh = new Fake("WFH", "attendance", "wfh.request.self", List.of(row("WFH", "WAITING", T0, T0)), null);
        MyRequest.Response r = new MyRequestsService(List.of(leave, wfh), runner).myRequests(caller("wfh.request.self"), null);
        assertEquals(0, leave.calls, "no permission: never read");
        assertEquals(List.of("WFH"), r.included());
        assertTrue(r.unavailable().isEmpty(), "a kind you may not see is not 'unavailable', it is just not yours");
        assertEquals("WFH", r.requests().get(0).kind());
    }

    @Test void aKindWhoseModuleIsOffIsSkipped() {
        when(modules.hasActiveModule(TENANT, "leave")).thenReturn(false);
        Fake leave = new Fake("LEAVE", "leave", "leave.balance.read", List.of(row("LEAVE", "WAITING", T0, T0)), null);
        Fake wfh = new Fake("WFH", "attendance", "wfh.request.self", List.of(row("WFH", "APPROVED", T0, T0)), null);
        MyRequest.Response r = new MyRequestsService(List.of(leave, wfh), runner)
                .myRequests(caller("leave.balance.read", "wfh.request.self"), null);
        assertEquals(0, leave.calls);
        assertEquals(List.of("WFH"), r.included());
        verify(modules, times(1)).hasActiveModule(TENANT, "leave");
    }

    @Test void aModuleCheckThatFailsMakesOnlyThatKindUnavailable() {
        when(modules.hasActiveModule(TENANT, "hrms")).thenThrow(new IllegalStateException("lookup failed"));
        Fake exp = new Fake("EXPENSE", "hrms", "hrms.expense.claim.self", List.of(row("EXPENSE", "WAITING", T0, T0)), null);
        Fake wfh = new Fake("WFH", "attendance", "wfh.request.self", List.of(row("WFH", "WAITING", T0, T0)), null);
        MyRequest.Response r = new MyRequestsService(List.of(exp, wfh), runner)
                .myRequests(caller("hrms.expense.claim.self", "wfh.request.self"), null);
        assertEquals(List.of("EXPENSE"), r.unavailable());
        assertEquals(1, r.requests().size());
    }

    @Test void aLoginWithoutAnEmployeeRecordHasNoRequests() {
        Fake leave = new Fake("LEAVE", "leave", "leave.balance.read", List.of(row("LEAVE", "WAITING", T0, T0)), null);
        EssCaller noRecord = new EssCaller(TENANT, null, Set.of("leave.balance.read"), null, LocalDate.of(2026, 9, 27));
        MyRequest.Response r = new MyRequestsService(List.of(leave), runner).myRequests(noRecord, null);
        assertTrue(r.requests().isEmpty());
        assertEquals(0, leave.calls);
    }

    @Test void waitingFirstThenTheLatestChangesAndTheLimitHolds() {
        List<MyRequest> rows = new ArrayList<>();
        rows.add(row("LEAVE", "APPROVED", T0.minusSeconds(90_000), T0.plusSeconds(3_600)));    // decided recently
        rows.add(row("LEAVE", "WAITING", T0.minusSeconds(10_000), T0.minusSeconds(10_000)));  // older waiting
        rows.add(row("LEAVE", "WAITING", T0, T0));                                            // newest waiting
        rows.add(row("LEAVE", "REJECTED", T0.minusSeconds(500_000), T0.minusSeconds(400_000)));
        Fake leave = new Fake("LEAVE", "leave", "leave.balance.read", rows, null);
        MyRequest.Response r = new MyRequestsService(List.of(leave), runner).myRequests(caller("leave.balance.read"), 3);
        assertEquals(3, r.requests().size());
        assertEquals(List.of(rows.get(2).id(), rows.get(1).id(), rows.get(0).id()),
                r.requests().stream().map(MyRequest::id).toList());
        // The limit is clamped to 1..20.
        assertEquals(1, new MyRequestsService(List.of(leave), runner).myRequests(caller("leave.balance.read"), -5).requests().size());
    }

    // ── the real sources ─────────────────────────────────────────────────────

    @Test void eachRealKindUsesItsOwnListPermissionAndModule() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        NotifiedApprover notified = mock(NotifiedApprover.class);
        List<MyRequestSource> real = List.of(new LeaveRequestsSource(jdbc), new WfhRequestsSource(jdbc),
                new CorrectionRequestsSource(jdbc, notified), new ShiftChangeRequestsSource(jdbc, notified),
                new ExpenseClaimsSource(jdbc), new AdvanceRequestsSource(jdbc));
        String[][] expected = {
                {"LEAVE", "leave", "leave.balance.read"},
                {"WFH", "attendance", "wfh.request.self"},
                {"CORRECTION", "attendance", "attendance.checkin.self"},
                {"SHIFT_CHANGE", "attendance", "attendance.checkin.self"},
                {"EXPENSE", "hrms", "hrms.expense.claim.self"},
                {"ADVANCE", "hrms", "hrms.advance.request.self"}};
        for (int i = 0; i < real.size(); i++) {
            MyRequestSource s = real.get(i);
            assertEquals(expected[i][0], s.key());
            assertEquals(expected[i][1], s.module(), s.key());
            assertTrue(s.allowed(caller(expected[i][2])), s.key());
            assertFalse(s.allowed(caller("hrms.ess.read")), s.key() + " must not open with an unrelated permission");
        }
    }

    @Test void everyQueryReadsOnlyTheCallersOwnRowsInTheirWorkspace() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any())).thenReturn(List.of());
        NotifiedApprover notified = mock(NotifiedApprover.class);
        List<MyRequestSource> real = List.of(new LeaveRequestsSource(jdbc), new WfhRequestsSource(jdbc),
                new CorrectionRequestsSource(jdbc, notified), new ShiftChangeRequestsSource(jdbc, notified),
                new ExpenseClaimsSource(jdbc), new AdvanceRequestsSource(jdbc));
        for (MyRequestSource s : real) {
            clearInvocations(jdbc);
            s.load(caller(), 4);
            org.mockito.ArgumentCaptor<String> sql = org.mockito.ArgumentCaptor.forClass(String.class);
            verify(jdbc).query(sql.capture(), any(RowMapper.class), eq(TENANT), eq(ME), eq(4));
            String q = sql.getValue();
            assertTrue(q.matches("(?s).*WHERE \\w+\\.tenant_id = \\? AND \\w+\\.employee_id = \\?.*"), s.key() + ": " + q);
            assertTrue(q.contains("LIMIT ?"), s.key());
            // Every joined person is looked up in the same workspace.
            int joins = q.split("JOIN hrms\\.employees").length - 1;
            java.util.regex.Matcher scoped = java.util.regex.Pattern
                    .compile("JOIN hrms\\.employees (\\w+) ON \\1\\.id = \\w+\\.\\w+ AND \\1\\.tenant_id = \\w+\\.tenant_id").matcher(q);
            int scopedJoins = 0;
            while (scoped.find()) scopedJoins++;
            assertTrue(joins > 0, s.key());
            assertEquals(joins, scopedJoins, s.key());
        }
        verifyNoInteractions(notified);
    }

    // ── steps, progress and names ────────────────────────────────────────────

    @Test void aLeaveRequestWaitsForItsApproverThenForHr() {
        UUID id = UUID.randomUUID();
        MyRequest waiting = LeaveRequestsSource.toRequest(new LeaveRequestsSource.Row(id, "Casual Leave",
                LocalDate.of(2026, 9, 28), LocalDate.of(2026, 9, 29), 2, "PENDING", T0, null, null, null, null,
                "Siddharth Rao", null));
        assertEquals("WAITING", waiting.state());
        assertEquals("Waiting", waiting.statusLabel());
        assertEquals(50, waiting.progress());
        assertEquals("Siddharth Rao", waiting.waitingForName());
        assertEquals("Casual Leave", waiting.title());
        assertEquals("/hrms/leave?tab=my", waiting.link());
        assertEquals(List.of("DONE", "CURRENT"), waiting.steps().stream().map(MyRequest.Step::state).toList());

        MyRequest hr = LeaveRequestsSource.toRequest(new LeaveRequestsSource.Row(id, "Casual Leave",
                LocalDate.of(2026, 9, 28), LocalDate.of(2026, 9, 29), 2, "PENDING_L2", T0, T0.plusSeconds(60), null, null, null,
                "Siddharth Rao", null));
        assertEquals("Waiting for HR", hr.statusLabel());
        assertEquals(67, hr.progress());
        assertNull(hr.waitingForName(), "HR is a group: nobody is named");

        MyRequest approved = LeaveRequestsSource.toRequest(new LeaveRequestsSource.Row(id, null,
                LocalDate.of(2026, 9, 28), LocalDate.of(2026, 9, 29), 2, "APPROVED", T0, T0.plusSeconds(60), null,
                T0.plusSeconds(120), UUID.randomUUID(), "Siddharth Rao", "Meera Joshi"));
        assertEquals("Leave", approved.title());
        assertEquals("Meera Joshi", approved.decidedByName(), "the last to decide");
        assertEquals(100, approved.progress());
        assertEquals(T0.plusSeconds(120), approved.lastActivityAt());

        MyRequest cancelled = LeaveRequestsSource.toRequest(new LeaveRequestsSource.Row(id, "Casual Leave",
                LocalDate.of(2026, 9, 28), LocalDate.of(2026, 9, 29), 2, "CANCELLED", T0, null, T0.plusSeconds(30), null, null,
                "Siddharth Rao", null));
        assertEquals("CANCELLED", cancelled.state());
        assertNull(cancelled.decidedByName(), "nobody decided a request its owner cancelled");
        assertEquals("SKIPPED", cancelled.steps().get(1).state());
    }

    @Test void twoStepRequestsNameTheirApproverOrWhoWasTold() {
        UUID id = UUID.randomUUID();
        MyRequest wfh = TwoStepRequests.toRequest(new TwoStepRequests.Row("WFH", id, "Work from home",
                LocalDate.of(2026, 9, 23), LocalDate.of(2026, 9, 23), 1.0, "APPROVED", T0, T0.plusSeconds(10),
                "Siddharth Rao", true, "/me/wfh"), null);
        assertEquals("Approved", wfh.statusLabel());
        assertEquals("Siddharth Rao", wfh.decidedByName());
        assertEquals(100, wfh.progress());

        MyRequest fix = TwoStepRequests.toRequest(new TwoStepRequests.Row("CORRECTION", id, "Attendance fix",
                LocalDate.of(2026, 9, 18), LocalDate.of(2026, 9, 18), null, "PENDING", T0, null, null, false,
                "/hrms/attendance?tab=corrections"), "Siddharth Rao");
        assertEquals("Siddharth Rao", fix.waitingForName(), "a waiting fix is with the person its notification went to");
        assertEquals(50, fix.progress());

        MyRequest expired = TwoStepRequests.toRequest(new TwoStepRequests.Row("SHIFT_CHANGE", id, "Shift change to Morning",
                LocalDate.of(2026, 9, 1), null, null, "REJECTED", T0, T0.plusSeconds(5), null, false, "/me/shift-change"), "X");
        assertEquals("Expired", expired.statusLabel());
        assertNull(expired.decidedByName());

        MyRequest cancelled = TwoStepRequests.toRequest(new TwoStepRequests.Row("WFH", id, "Work from home",
                LocalDate.of(2026, 9, 23), LocalDate.of(2026, 9, 23), 1.0, "CANCELLED", T0, T0.plusSeconds(10),
                "Siddharth Rao", true, "/me/wfh"), null);
        assertNull(cancelled.decidedByName());
        assertEquals("CANCELLED", cancelled.state());
    }

    @Test void claimsAndAdvancesShowTheirPaymentSteps() {
        UUID id = UUID.randomUUID();
        MyRequest claim = ExpenseClaimsSource.toRequest(new ExpenseClaimsSource.Row(id, "Client visit travel",
                new BigDecimal("4860.00"), "INR", "SUBMITTED", T0, T0, null, null, "Siddharth Rao"));
        assertEquals(33, claim.progress());
        assertEquals("Siddharth Rao", claim.waitingForName());
        assertEquals(new BigDecimal("4860.00"), claim.amount());
        assertEquals(67, ExpenseClaimsSource.toRequest(new ExpenseClaimsSource.Row(id, "Team dinner", BigDecimal.TEN, null,
                "APPROVED", T0, T0, T0.plusSeconds(9), null, "Meera Joshi")).progress());
        MyRequest paid = ExpenseClaimsSource.toRequest(new ExpenseClaimsSource.Row(id, "Team dinner", BigDecimal.TEN, null,
                "REIMBURSED", T0, T0, T0.plusSeconds(9), T0.plusSeconds(99), "Meera Joshi"));
        assertEquals("DONE", paid.state());
        assertEquals("Reimbursed", paid.statusLabel());
        assertEquals(100, paid.progress());
        assertEquals("INR", paid.currency());

        MyRequest advance = AdvanceRequestsSource.toRequest(new AdvanceRequestsSource.Row(id, new BigDecimal("20000"),
                "DISBURSED", T0, T0.plusSeconds(5), T0.plusSeconds(50), null, "Meera Joshi"));
        assertEquals("Paid out", advance.statusLabel());
        assertEquals(75, advance.progress());
        assertEquals("/hrms/advances?tab=my", advance.link());
    }
}
