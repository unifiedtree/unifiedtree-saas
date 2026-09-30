package com.hrms.api.advance;

import com.hrms.advance.dto.AdvanceResponse;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.service.AdvanceService;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.api.payroll.PayrollService;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-62: totals and filters in the list's scope, employees reading their own
 * advance's recovery, the approver and plan preview, the payout's reference
 * and first month, and ledger rows in plain words. "Raise an advance" keeps
 * today's flow; there is no advance limit.
 */
class AdvanceRedesignTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID me = UUID.randomUUID(), manager = UUID.randomUUID(), other = UUID.randomUUID();

    private final AdvanceService advances = mock(AdvanceService.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final AdvanceRecoveryService recovery = mock(AdvanceRecoveryService.class);
    private final ApproverFallbackResolver approvers = mock(ApproverFallbackResolver.class);
    private final AdvanceReadService reads = mock(AdvanceReadService.class);
    private final PayrollService payroll = mock(PayrollService.class);
    private final AdvanceController controller = new AdvanceController(advances, employees, recovery, approvers, reads,
            mock(WorkforceDepartmentRepository.class), payroll, mock(JdbcTemplate.class));

    @BeforeEach void setUp() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private Jwt jwt(UUID employee, String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employee.toString()).claim("permissions", List.of(permissions)).build();
    }

    private Employee employee(UUID id, String first, UUID managerId) {
        Employee e = new Employee();
        e.setId(id);
        e.setFirstName(first);
        e.setLastName("Test");
        e.setManagerId(managerId);
        return e;
    }

    private AdvanceResponse advanceOf(UUID owner, UUID approver, AdvanceStatus status) {
        return new AdvanceResponse(UUID.randomUUID(), owner, null, null, UUID.randomUUID(), new BigDecimal("30000"), "Reason",
                3, new BigDecimal("10000"), status, approver, null, null, null, new BigDecimal("30000"), null);
    }

    // ── self access on schedule, ledger and summary ─────────────────────────

    @Test void anEmployeeReadsTheirOwnAdvancesRecoveryButNobodyElses() {
        var service = mock(AdvanceRecoveryService.class);
        var controller = new AdvanceRecoveryController(service, advances);
        UUID mine = UUID.randomUUID(), theirs = UUID.randomUUID();
        // Routed to me as approver, but I hold only request.self: still not mine to read.
        when(advances.getRequest(mine)).thenReturn(advanceOf(me, manager, AdvanceStatus.DISBURSED));
        when(advances.getRequest(theirs)).thenReturn(advanceOf(other, me, AdvanceStatus.DISBURSED));
        Jwt self = jwt(me, "hrms.advance.request.self");

        controller.schedule(mine, self);
        controller.ledger(mine, self);
        controller.summary(mine, self);
        verify(service).listSchedule(any(), eq(mine));
        verify(service).listLedger(any(), eq(mine));
        verify(service).summary(any(), eq(mine));

        assertThrows(AccessDeniedException.class, () -> controller.schedule(theirs, self));
        assertThrows(AccessDeniedException.class, () -> controller.ledger(theirs, self));
        assertThrows(AccessDeniedException.class, () -> controller.summary(theirs, self));
        verify(service, never()).listSchedule(any(), eq(theirs));

        // With advance.read the rule is today's: the advance routed to me is readable.
        controller.ledger(theirs, jwt(me, "hrms.advance.read", "hrms.advance.approve"));
        verify(service).listLedger(any(), eq(theirs));
    }

    @Test void theRecoveryReadsOpenToRequestSelfWhileTheActionsKeepTheirGuards() {
        assertEquals("hasAnyAuthority('hrms.advance.read','hrms.advance.request.self')", pre(AdvanceRecoveryController.class, "schedule"));
        assertEquals("hasAnyAuthority('hrms.advance.read','hrms.advance.request.self')", pre(AdvanceRecoveryController.class, "ledger"));
        assertEquals("hasAnyAuthority('hrms.advance.read','hrms.advance.request.self')", pre(AdvanceRecoveryController.class, "summary"));
        assertEquals("hasAuthority('hrms.advance.foreclose')", pre(AdvanceRecoveryController.class, "foreclose"));
        assertEquals("hasAuthority('hrms.advance.foreclose')", pre(AdvanceRecoveryController.class, "writeOff"));
        assertEquals("hasAuthority('hrms.advance.approve')", pre(AdvanceRecoveryController.class, "skipMonth"));
        assertEquals("hasAuthority('hrms.advance.read')", pre(AdvanceController.class, "summary"));
        assertEquals("hasAuthority('hrms.advance.request.self')", pre(AdvanceController.class, "mySummary"));
        assertEquals("hasAuthority('hrms.advance.request.self')", pre(AdvanceController.class, "myApprover"));
        assertEquals("hasAuthority('hrms.advance.request.self')", pre(AdvanceController.class, "myPreview"));
        assertEquals("@perm.check('hrms.advance.disburse')", pre(AdvanceController.class, "disburse"));
    }

    // ── totals and filters in the list's scope ───────────────────────────────

    @Test void totalsAndFiltersTakeTheListsScope() {
        controller.summary(jwt(me, "hrms.advance.read", "hrms.advance.disburse"));
        verify(reads).summary(eq(tenant), isNull(), any(PayFinancialYear.class));
        controller.summary(jwt(me, "hrms.advance.read", "hrms.advance.approve"));
        verify(reads).summary(eq(tenant), eq(me), any(PayFinancialYear.class));

        Pageable page = PageRequest.of(1, 10);
        UUID dept = UUID.randomUUID(), row = UUID.randomUUID();
        when(reads.filteredIds(any(), any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new AdvanceReadService.IdPage(List.of(row), 11));
        when(advances.getByIdsInOrder(List.of(row))).thenReturn(List.of(advanceOf(other, me, AdvanceStatus.DISBURSED)));
        PageResponse<AdvanceResponse> out = controller.listRequests(null, AdvanceReadService.Phase.RECOVERING, dept, page,
                jwt(me, "hrms.advance.read")).getBody();
        verify(reads).filteredIds(tenant, me, null, AdvanceReadService.Phase.RECOVERING, dept, 1, 10);
        assertEquals(11, out.totalElements());
        assertEquals(2, out.totalPages());
        assertTrue(out.last());
        assertEquals(1, out.content().size());

        controller.listRequests(AdvanceStatus.CLOSED, AdvanceReadService.Phase.REPAID, null, page,
                jwt(me, "hrms.advance.read", "hrms.advance.disburse"));
        verify(reads).filteredIds(tenant, null, List.of("CLOSED"), AdvanceReadService.Phase.REPAID, null, 1, 10);

        // Without a phase or department it is today's query, untouched.
        when(advances.getPendingForApprover(any(), any(), any())).thenReturn(new PageResponse<>(List.of(), 0, 20, 0, 0, true));
        controller.listRequests(null, null, null, page, jwt(me, "hrms.advance.read"));
        verify(advances).getPendingForApprover(eq(me), eq(List.of(AdvanceStatus.values())), eq(page));
        verifyNoMoreInteractions(reads);
    }

    @Test void phasesSplitDisbursedAdvancesAndLeaveWriteOffsOutOfRepaid() {
        assertEquals("ar.status = 'DISBURSED' AND ar.outstanding_amount > 0",
                AdvanceReadService.phaseCondition(AdvanceReadService.Phase.RECOVERING));
        String repaid = AdvanceReadService.phaseCondition(AdvanceReadService.Phase.REPAID);
        assertTrue(repaid.contains("ar.status = 'CLOSED'"), repaid);
        assertTrue(repaid.contains("ar.status = 'DISBURSED' AND ar.outstanding_amount <= 0"), repaid);
        assertTrue(repaid.contains("w.advance_request_id IS NULL"), repaid);
    }

    @Test void myTotalsAreForThePersonInTheToken() {
        controller.mySummary(jwt(me, "hrms.advance.request.self"));
        verify(reads).mySummary(tenant, me);
    }

    // ── approver and plan preview ────────────────────────────────────────────

    @Test void thePreviewUsesTheRequestsOwnRoundingAndMonths() {
        BigDecimal[] plan = AdvanceController.plan(new BigDecimal("50000"), 6);
        assertEquals(new BigDecimal("8333.33"), plan[0]);
        assertEquals(new BigDecimal("8333.35"), plan[1]);
        BigDecimal[] one = AdvanceController.plan(new BigDecimal("1000"), 1);
        assertEquals(new BigDecimal("1000.00"), one[0]);
        assertEquals(0, new BigDecimal("1000").compareTo(one[1]));

        when(employees.findById(me)).thenReturn(Optional.of(employee(me, "Reader", manager)));
        when(employees.findById(manager)).thenReturn(Optional.of(employee(manager, "Dept", null)));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        var preview = controller.myPreview(new BigDecimal("50000"), 6, jwt(me, "hrms.advance.request.self")).getBody();
        YearMonth now = YearMonth.now(PayFinancialYear.IST);
        assertEquals(now.toString(), preview.assumedPayoutMonth());
        assertEquals(now.plusMonths(1).toString(), preview.firstDeductionMonth());
        assertEquals(now.plusMonths(6).toString(), preview.lastDeductionMonth());
        assertEquals(new BigDecimal("8333.33"), preview.monthlyDeduction());
        assertEquals(new AdvanceController.AdvanceApprover(manager, "Dept Test", "MANAGER", null), preview.approver());
        // No payroll.structure.read.self: no take-home figure, and the structure isn't read.
        assertNull(preview.netMonthly());
        assertNull(preview.takeHomeAfterDeduction());
        verifyNoInteractions(payroll);
    }

    @Test void theTakeHomeComesFromTheCallersStructureOnlyWithTheirPermission() {
        when(employees.findById(me)).thenReturn(Optional.of(employee(me, "Reader", manager)));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        PayrollService.StructureDto structure = mock(PayrollService.StructureDto.class);
        when(structure.netMonthly()).thenReturn(new BigDecimal("40000.00"));
        when(payroll.getCurrentStructure(tenant, me)).thenReturn(structure);
        var preview = controller.myPreview(new BigDecimal("30000"), 3,
                jwt(me, "hrms.advance.request.self", "payroll.structure.read.self")).getBody();
        assertEquals(new BigDecimal("40000.00"), preview.netMonthly());
        assertEquals(new BigDecimal("30000.00"), preview.takeHomeAfterDeduction());
        // A structure that can't be read leaves the figure out rather than failing.
        when(payroll.getCurrentStructure(tenant, me)).thenThrow(new IllegalStateException("broken"));
        assertNull(controller.myPreview(new BigDecimal("30000"), 3,
                jwt(me, "hrms.advance.request.self", "payroll.structure.read.self")).getBody().netMonthly());
    }

    @Test void thePreviewRefusesWhatTheRequestWouldRefuse() {
        Jwt self = jwt(me, "hrms.advance.request.self");
        assertEquals("ADVANCE_INVALID_AMOUNT", assertThrows(BusinessRuleException.class,
                () -> controller.myPreview(BigDecimal.ZERO, 3, self)).getErrorCode());
        assertEquals("ADVANCE_INVALID_TERM", assertThrows(BusinessRuleException.class,
                () -> controller.myPreview(BigDecimal.TEN, 0, self)).getErrorCode());
        assertEquals("ADVANCE_INVALID_TERM", assertThrows(BusinessRuleException.class,
                () -> controller.myPreview(BigDecimal.TEN, 61, self)).getErrorCode());
        // No limit: a large amount over the longest term previews fine.
        when(employees.findById(me)).thenReturn(Optional.of(employee(me, "Reader", manager)));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        assertNotNull(controller.myPreview(new BigDecimal("5000000"), 60, self).getBody());
    }

    @Test void theApproverNamesHowTheyWereChosen() {
        UUID hr = UUID.randomUUID(), delegate = UUID.randomUUID();
        when(employees.findById(hr)).thenReturn(Optional.of(employee(hr, "Hema", null)));
        when(employees.findById(delegate)).thenReturn(Optional.of(employee(delegate, "Dev", null)));
        when(employees.findById(manager)).thenReturn(Optional.of(employee(manager, "Dept", null)));
        Jwt self = jwt(me, "hrms.advance.request.self");

        // A delegate standing in for the manager.
        when(employees.findById(me)).thenReturn(Optional.of(employee(me, "Reader", manager)));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(delegate);
        assertEquals(new AdvanceController.AdvanceApprover(delegate, "Dev Test", "DELEGATE", "Dept Test"),
                controller.myApprover(self).getBody().approver());

        // No manager: the HR manager, else an admin.
        when(employees.findById(me)).thenReturn(Optional.of(employee(me, "Reader", null)));
        when(approvers.resolveTerminalApprover(tenant)).thenReturn(Optional.of(hr));
        when(approvers.redirectIfDelegated(eq(hr), any())).thenReturn(hr);
        when(reads.isHrManager(tenant, hr)).thenReturn(true);
        assertEquals("HR", controller.myApprover(self).getBody().approver().source());
        when(reads.isHrManager(tenant, hr)).thenReturn(false);
        assertEquals("ADMIN", controller.myApprover(self).getBody().approver().source());

        // Nobody but me: no approver (a request would be refused).
        when(approvers.resolveTerminalApprover(tenant)).thenReturn(Optional.of(me));
        assertNull(controller.myApprover(self).getBody().approver());
    }

    // ── recording the payout ─────────────────────────────────────────────────

    @Test void thePayoutRecordsTheReferenceAndTheChosenFirstMonth() {
        UUID id = UUID.randomUUID();
        when(advances.getRequest(id)).thenReturn(advanceOf(other, manager, AdvanceStatus.APPROVED));
        when(advances.disburse(id)).thenReturn(advanceOf(other, manager, AdvanceStatus.DISBURSED));
        YearMonth next = YearMonth.now(PayFinancialYear.IST).plusMonths(1);
        Jwt fin = jwt(me, "hrms.advance.disburse");

        controller.disburse(id, new AdvanceController.DisburseRequest("  NEFT 1234  ", next.plusMonths(2).toString()), fin);
        verify(recovery).initSchedule(tenant, id, next.plusMonths(2).getMonthValue(), next.plusMonths(2).getYear(), "NEFT 1234");

        // No body: today's payout exactly (the month after, today's literal reference).
        controller.disburse(id, null, fin);
        verify(recovery).initSchedule(tenant, id, next.getMonthValue(), next.getYear(), null);
    }

    @Test void aFirstMonthOutsideTheWindowChangesNothing() {
        UUID id = UUID.randomUUID();
        YearMonth now = YearMonth.now(PayFinancialYear.IST);
        Jwt fin = jwt(me, "hrms.advance.disburse");
        for (String bad : List.of(now.toString(), now.plusMonths(13).toString(), "next month")) {
            BusinessRuleException e = assertThrows(BusinessRuleException.class,
                    () -> controller.disburse(id, new AdvanceController.DisburseRequest(null, bad), fin));
            assertEquals("ADVANCE_INVALID_FIRST_MONTH", e.getErrorCode());
        }
        verify(advances, never()).disburse(any());
        verifyNoInteractions(recovery);
        assertEquals(now.plusMonths(12), AdvanceController.firstDeductionMonth(now.plusMonths(12).toString(), now));
        assertEquals(now.plusMonths(1), AdvanceController.firstDeductionMonth(" ", now));
    }

    // ── ledger rows in plain words ───────────────────────────────────────────

    @Test void ledgerRowsSayWhatHappened() {
        assertEquals("Disbursed", AdvanceRecoveryService.ledgerLabel("DISBURSE", "disbursement", null));
        assertNull(AdvanceRecoveryService.paymentReference("DISBURSE", "disbursement"));
        assertEquals("Disbursed · NEFT 1234", AdvanceRecoveryService.ledgerLabel("DISBURSE", "NEFT 1234", null));
        assertEquals("NEFT 1234", AdvanceRecoveryService.paymentReference("DISBURSE", "NEFT 1234"));
        assertNull(AdvanceRecoveryService.paymentReference("REPAYMENT", "run:abc"));
        assertEquals("May 2026", AdvanceRecoveryService.periodLabel(5, 2026));
        assertEquals("Recovered · May 2026 payroll", AdvanceRecoveryService.ledgerLabel("REPAYMENT", "run:abc", "May 2026"));
        assertEquals("Recovered in payroll", AdvanceRecoveryService.ledgerLabel("REPAYMENT", null, null));
        assertEquals("Full repayment recorded", AdvanceRecoveryService.ledgerLabel("FORECLOSE", "foreclose", null));
        assertEquals("Recovered in the full & final settlement",
                AdvanceRecoveryService.ledgerLabel("FORECLOSE", "fnf-settlement:" + UUID.randomUUID(), null));
        assertEquals("Balance written off", AdvanceRecoveryService.ledgerLabel("WRITE_OFF", "write_off", null));
        assertEquals("Installment 3 deferred", AdvanceRecoveryService.ledgerLabel("SKIP_MONTH", "installment:3", null));
        assertEquals("SOMETHING_NEW", AdvanceRecoveryService.ledgerLabel("SOMETHING_NEW", null, null));
    }

    private static String pre(Class<?> type, String method) {
        Method m = java.util.Arrays.stream(type.getDeclaredMethods())
                .filter(x -> x.getName().equals(method) && x.isAnnotationPresent(PreAuthorize.class)).findFirst().orElseThrow();
        return m.getAnnotation(PreAuthorize.class).value();
    }
}
