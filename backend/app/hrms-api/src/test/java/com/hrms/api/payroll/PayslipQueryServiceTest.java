package com.hrms.api.payroll;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.audit.AuditService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** "Ask payroll" both ways (BW-59): own payslips only, one answer, notifications without the text. */
class PayslipQueryServiceTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID COMPANY = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID READER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID READER_USER = UUID.randomUUID();
    private static final UUID FIN = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID FIN_USER = UUID.randomUUID();
    private static final UUID RUN = UUID.randomUUID();
    private static final UUID QUERY = UUID.randomUUID();
    private static final String QUESTION = "Why is my September net lower than August?";
    private static final String ANSWER = "Your advance recovery of 2,140 started this month.";

    private JdbcTemplate jdbc;
    private PayslipQueryStore store;
    private PayslipQueryNotifier notifier;
    private AuditService audit;
    private PayslipQueryService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        store = mock(PayslipQueryStore.class);
        notifier = mock(PayslipQueryNotifier.class);
        audit = mock(AuditService.class);
        service = new PayslipQueryService(jdbc, store, notifier, audit);
    }

    private static PayslipQueryStore.QueryRow row(String status, String answer, String by) {
        return new PayslipQueryStore.QueryRow(QUERY, RUN, "Sep 2026", 9, 2026, READER, "Reader User", "EMP002",
                COMPANY, "UnifiedTree Demo Corp", QUESTION, status, answer, by,
                answer == null ? null : "2026-09-27T10:00:00Z", "2026-09-27T09:00:00Z", READER_USER);
    }

    // ── the employee's side ───────────────────────────────────────────────────

    @Test
    void anEmployeeAsksAboutTheirOwnFinalPayslipAndThePayrollTeamIsTold() {
        PayslipQueryStore.OwnPayslip slip = new PayslipQueryStore.OwnPayslip(RUN, COMPANY, 9, 2026);
        when(store.ownPayslip(TENANT, READER, RUN)).thenReturn(Optional.of(slip));
        when(store.insert(TENANT, slip, READER, QUESTION, READER_USER)).thenReturn(QUERY);
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("OPEN", null, null)));
        when(store.employeesHolding(TENANT, "payroll.runs.manage", READER, PayslipQueryService.MAX_RECIPIENTS))
                .thenReturn(List.of(FIN));

        PayslipQueryService.PayslipQueryDto dto = service.raise(TENANT, READER_USER, READER, RUN, "  " + QUESTION + "\n");

        assertEquals("OPEN", dto.status());
        assertEquals(QUESTION, dto.message());
        assertEquals(RUN, dto.runId());
        verify(store).insert(TENANT, slip, READER, QUESTION, READER_USER);
        // The team is told who and which month. The question stays out of the notification.
        verify(notifier).raised(TENANT, List.of(FIN), "Reader User", "Sep 2026", QUERY, RUN);
        verify(jdbc).execute("SET LOCAL app.tenant_id = '" + TENANT + "'");
    }

    @Test
    void hrWhoMayAnswerIsToldTooOnceEachAfterThePayrollTeam() {
        UUID hr = UUID.fromString("33333333-3333-3333-3333-333333333333");
        PayslipQueryStore.OwnPayslip slip = new PayslipQueryStore.OwnPayslip(RUN, COMPANY, 9, 2026);
        when(store.ownPayslip(TENANT, READER, RUN)).thenReturn(Optional.of(slip));
        when(store.insert(TENANT, slip, READER, QUESTION, READER_USER)).thenReturn(QUERY);
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("OPEN", null, null)));
        when(store.employeesHolding(TENANT, "payroll.runs.manage", READER, PayslipQueryService.MAX_RECIPIENTS))
                .thenReturn(List.of(FIN));
        // FIN holds both (Finance Lead is given payroll.queries.answer as well): told once.
        when(store.employeesHolding(TENANT, "payroll.queries.answer", READER, PayslipQueryService.MAX_RECIPIENTS))
                .thenReturn(List.of(hr, FIN));

        service.raise(TENANT, READER_USER, READER, RUN, QUESTION);

        verify(notifier).raised(TENANT, List.of(FIN, hr), "Reader User", "Sep 2026", QUERY, RUN);
    }

    @Test
    void beforeV143_86NoOneHoldsTheAnsweringPermissionSoOnlyThePayrollTeamIsTold() {
        // The store finds no holder of a code that isn't in rbac.permissions yet (mock default: empty list).
        when(store.employeesHolding(TENANT, "payroll.runs.manage", READER, PayslipQueryService.MAX_RECIPIENTS))
                .thenReturn(List.of(FIN));
        assertEquals(List.of(FIN), service.answerers(TENANT, READER));
    }

    @Test
    void atMostMaxRecipientsAreTold() {
        List<UUID> payroll = java.util.stream.Stream.generate(UUID::randomUUID).limit(PayslipQueryService.MAX_RECIPIENTS).toList();
        when(store.employeesHolding(TENANT, "payroll.runs.manage", READER, PayslipQueryService.MAX_RECIPIENTS)).thenReturn(payroll);
        assertEquals(payroll, service.answerers(TENANT, READER));
        // Already full: the HR lookup is skipped.
        verify(store, never()).employeesHolding(TENANT, "payroll.queries.answer", READER, PayslipQueryService.MAX_RECIPIENTS);
    }

    @Test
    void someoneElsesRunOrADraftIsNoPayslipForThisPeriod() {
        when(store.ownPayslip(TENANT, READER, RUN)).thenReturn(Optional.empty());
        HrmsException e = assertThrows(HrmsException.class, () -> service.raise(TENANT, READER_USER, READER, RUN, QUESTION));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("PAYSLIP_NOT_FOUND", e.getErrorCode());
        verify(store, never()).insert(any(), any(), any(), any(), any());
        verifyNoInteractions(notifier);
    }

    @Test
    void anAccountWithoutAnEmployeeRecordHasNoPayslipToAskAbout() {
        HrmsException e = assertThrows(HrmsException.class, () -> service.raise(TENANT, READER_USER, null, RUN, QUESTION));
        assertEquals("PAYSLIP_NOT_FOUND", e.getErrorCode());
        verify(store, never()).ownPayslip(any(), any(), any());
        assertEquals(List.of(), service.mine(TENANT, null, null));
    }

    @Test
    void anEmptyOrOverlongQuestionIsRefused() {
        HrmsException empty = assertThrows(HrmsException.class, () -> service.raise(TENANT, READER_USER, READER, RUN, "   "));
        assertEquals(HttpStatus.BAD_REQUEST, empty.getStatus());
        assertEquals("QUESTION_REQUIRED", empty.getErrorCode());
        HrmsException tooLong = assertThrows(HrmsException.class,
                () -> service.raise(TENANT, READER_USER, READER, RUN, "x".repeat(PayslipQueryService.MAX_MESSAGE + 1)));
        assertEquals("QUESTION_TOO_LONG", tooLong.getErrorCode());
        verifyNoInteractions(store, notifier);
    }

    @Test
    void anEmployeeListsOnlyTheirOwnQuestions() {
        when(store.listForEmployee(TENANT, READER, null, 200)).thenReturn(List.of(row("ANSWERED", ANSWER, "Finance Lead")));
        List<PayslipQueryService.PayslipQueryDto> mine = service.mine(TENANT, READER, null);
        assertEquals(1, mine.size());
        assertEquals(ANSWER, mine.get(0).answer());
        assertEquals("Finance Lead", mine.get(0).answeredByName());
        verify(store).listForEmployee(TENANT, READER, null, 200);
        verify(store, never()).list(any(), any(), anyInt());
    }

    // ── the payroll team's side ───────────────────────────────────────────────

    @Test
    void thePayrollTeamAnswersOnceAndTheEmployeeIsTold() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("OPEN", null, null)),
                Optional.of(row("ANSWERED", ANSWER, "Finance Lead")));
        when(store.answer(TENANT, QUERY, ANSWER, FIN_USER, FIN)).thenReturn(true);
        when(store.accountName(TENANT, FIN_USER)).thenReturn("Finance Lead");

        PayslipQueryService.PayslipQueryDto dto = service.answer(TENANT, FIN_USER, FIN, QUERY, ANSWER);

        assertEquals("ANSWERED", dto.status());
        assertEquals(ANSWER, dto.answer());
        verify(notifier).answered(TENANT, READER, "Finance Lead", "Sep 2026", QUERY, RUN);
        ArgumentCaptor<String> summary = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq("payroll"), eq("PAYSLIP_QUERY_ANSWERED"), eq("payslip_query"), eq(QUERY), summary.capture());
        assertEquals("Answered Reader User's question about their Sep 2026 payslip", summary.getValue());
        assertFalse(summary.getValue().contains("advance"), "the audit line never quotes the answer");
    }

    @Test
    void anAnsweredQuestionIsNotAnsweredAgain() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("ANSWERED", ANSWER, "Finance Lead")));
        HrmsException e = assertThrows(HrmsException.class, () -> service.answer(TENANT, FIN_USER, FIN, QUERY, "Again"));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals("QUERY_ALREADY_ANSWERED", e.getErrorCode());
        verify(store, never()).answer(any(), any(), any(), any(), any());
        verifyNoInteractions(notifier, audit);
    }

    @Test
    void twoPeopleAnsweringAtOnceOnlyOneWins() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("OPEN", null, null)));
        when(store.answer(TENANT, QUERY, ANSWER, FIN_USER, FIN)).thenReturn(false); // the other one got there first
        HrmsException e = assertThrows(HrmsException.class, () -> service.answer(TENANT, FIN_USER, FIN, QUERY, ANSWER));
        assertEquals("QUERY_ALREADY_ANSWERED", e.getErrorCode());
        verifyNoInteractions(notifier);
    }

    @Test
    void anUnknownQuestionOrAnEmptyAnswerIsRefused() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.empty());
        HrmsException missing = assertThrows(HrmsException.class, () -> service.answer(TENANT, FIN_USER, FIN, QUERY, ANSWER));
        assertEquals(HttpStatus.NOT_FOUND, missing.getStatus());
        assertEquals("QUERY_NOT_FOUND", missing.getErrorCode());
        HrmsException empty = assertThrows(HrmsException.class, () -> service.answer(TENANT, FIN_USER, FIN, QUERY, " "));
        assertEquals("ANSWER_REQUIRED", empty.getErrorCode());
        HrmsException tooLong = assertThrows(HrmsException.class,
                () -> service.answer(TENANT, FIN_USER, FIN, QUERY, "y".repeat(PayslipQueryService.MAX_ANSWER + 1)));
        assertEquals("ANSWER_TOO_LONG", tooLong.getErrorCode());
    }

    // ── "Remove" ──────────────────────────────────────────────────────────────

    @Test
    void removingAnAnsweredQuestionClosesItAndAuditsWithoutTheText() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("ANSWERED", ANSWER, "Finance Lead")));
        when(store.close(TENANT, QUERY)).thenReturn(true);

        service.remove(TENANT, QUERY);

        verify(store).close(TENANT, QUERY);
        verify(jdbc).execute("SET LOCAL app.tenant_id = '" + TENANT + "'");
        ArgumentCaptor<String> summary = ArgumentCaptor.forClass(String.class);
        verify(audit).record(eq("payroll"), eq("PAYSLIP_QUERY_REMOVED"), eq("payslip_query"), eq(QUERY), summary.capture());
        assertEquals("Removed Reader User's answered question about their Sep 2026 payslip from the queue", summary.getValue());
        assertFalse(summary.getValue().contains("September net"), "the audit line never quotes the question");
        verifyNoInteractions(notifier);
    }

    @Test
    void anOpenQuestionCannotBeRemoved() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("OPEN", null, null)));
        HrmsException e = assertThrows(HrmsException.class, () -> service.remove(TENANT, QUERY));
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals("QUERY_NOT_ANSWERED", e.getErrorCode());
        verify(store, never()).close(any(), any());
        verifyNoInteractions(audit, notifier);
    }

    @Test
    void anotherWorkspacesOrAnUnknownQuestionIsNotFound() {
        UUID other = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        // The store only finds a question in the caller's workspace.
        when(store.find(other, QUERY)).thenReturn(Optional.of(row("ANSWERED", ANSWER, "Finance Lead")));
        when(store.find(TENANT, QUERY)).thenReturn(Optional.empty());
        HrmsException e = assertThrows(HrmsException.class, () -> service.remove(TENANT, QUERY));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("QUERY_NOT_FOUND", e.getErrorCode());
        verify(store, never()).close(any(), any());
        verifyNoInteractions(audit);
    }

    @Test
    void removingTwiceIsNotAnError() {
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("CLOSED", ANSWER, "Finance Lead")));
        when(store.close(TENANT, QUERY)).thenReturn(false);
        assertDoesNotThrow(() -> service.remove(TENANT, QUERY));
        verifyNoInteractions(audit);
    }

    @Test
    void theEmployeeStillSeesARemovedQuestionAsAnswered() {
        when(store.listForEmployee(TENANT, READER, RUN, 200)).thenReturn(List.of(row("CLOSED", ANSWER, "Finance Lead")));
        PayslipQueryService.PayslipQueryDto mine = service.mine(TENANT, READER, RUN).get(0);
        assertEquals("ANSWERED", mine.status());
        assertEquals(ANSWER, mine.answer());
        // The payroll team's own view keeps the real status.
        assertEquals("CLOSED", PayslipQueryService.dto(row("CLOSED", ANSWER, "Finance Lead")).status());
    }

    @Test
    void theQueueFiltersByAKnownStatusAndCapsItsSize() {
        when(store.list(eq(TENANT), any(), anyInt())).thenReturn(List.of(row("OPEN", null, null)));
        assertEquals(1, service.list(TENANT, "open", null).size());
        verify(store).list(TENANT, "OPEN", 200);
        service.list(TENANT, null, 9999);
        verify(store).list(TENANT, null, 500);
        service.list(TENANT, " ", 0);
        verify(store).list(TENANT, null, 1);
        HrmsException bad = assertThrows(HrmsException.class, () -> service.list(TENANT, "DELETED", null));
        assertEquals(HttpStatus.BAD_REQUEST, bad.getStatus());
        assertEquals("INVALID_STATUS", bad.getErrorCode());
    }
}
