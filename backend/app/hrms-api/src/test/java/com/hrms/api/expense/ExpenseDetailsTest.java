package com.hrms.api.expense;

import com.hrms.api.employee.EmployeeRecordAccess;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.expense.dto.ExpenseCategoryCap;
import com.hrms.expense.dto.ExpenseClaimResponse;
import com.hrms.expense.dto.ExpensePolicyCheck;
import com.hrms.expense.enums.ExpenseCategory;
import com.hrms.expense.enums.ExpenseStatus;
import com.hrms.expense.service.ExpensePolicyService;
import com.hrms.expense.service.ExpenseService;
import com.unifiedtree.audit.AuditService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.oauth2.jwt.Jwt;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The expense pages' extra facts (redesign BW-60): claim details, my totals,
 * the approvals status filter, and what happens when a table is missing.
 */
class ExpenseDetailsTest {

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID();
    private final UUID me = UUID.randomUUID(), approver = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ExpenseService service = mock(ExpenseService.class);
    private final ExpenseClaimDetails details = new ExpenseClaimDetails(jdbc, service);

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
    }

    @AfterEach void clear() {
        TenantContext.clear();
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private ExpenseClaimResponse claim(UUID id, ExpenseStatus status) {
        return new ExpenseClaimResponse(id, me, "Me", "E1", company, "Trip", new BigDecimal("1800"), "INR", status,
                Instant.now(), approver, null, null, null, null, Instant.now(), null, 2, 1);
    }

    private static BadSqlGrammarException missing(String what) {
        return new BadSqlGrammarException("q", "SELECT", new SQLException("relation \"" + what + "\" does not exist", "42P01"));
    }

    private void people() {
        doAnswer(JdbcRows.feed(List.of(
                row("id", me, "name", "Me Person", "department", "Sales"),
                row("id", approver, "name", "Mona Manager", "department", "Sales"))))
                .when(jdbc).query(contains("FROM hrms.employees e"), any(RowCallbackHandler.class), any(Object[].class));
    }

    private void lines(UUID claimId) {
        doAnswer(JdbcRows.feed(List.of(
                row("claim_id", claimId, "category", "TRAVEL", "subtotal", new BigDecimal("1500"), "line_count", 1, "with_receipt", 1),
                row("claim_id", claimId, "category", "FOOD", "subtotal", new BigDecimal("300"), "line_count", 1, "with_receipt", 0))))
                .when(jdbc).query(contains("FROM expense_mgmt.expense_items"), any(RowCallbackHandler.class), any(Object[].class));
    }

    private void caps() {
        when(service.capsByCompany(any())).thenReturn(Map.of(company, Map.of(
                ExpenseCategory.TRAVEL, new ExpenseCategoryCap(ExpenseCategory.TRAVEL, new BigDecimal("1000"), "Local travel", false),
                ExpenseCategory.FOOD, new ExpenseCategoryCap(ExpenseCategory.FOOD, new BigDecimal("1000"), "Meals", true))));
    }

    // ── claim details ────────────────────────────────────────────────────────

    @Test void eachClaimGetsDepartmentApproverCategoriesBatchAndPolicyCheck() {
        UUID id = UUID.randomUUID();
        people();
        lines(id);
        caps();
        doAnswer(JdbcRows.feed(List.of(row("claim_id", id, "batch_reference", "REIMB-SEP26-001", "status", "POSTED"))))
                .when(jdbc).query(contains("reimbursement_batch_items"), any(RowCallbackHandler.class), any(Object[].class));
        ExpenseClaimResponse r = details.add(List.of(claim(id, ExpenseStatus.APPROVED_FOR_PAY))).get(0);
        assertEquals("Sales", r.department());
        assertEquals("Mona Manager", r.approverName());
        assertEquals(List.of(ExpenseCategory.TRAVEL, ExpenseCategory.FOOD), r.categories(), "category order");
        assertEquals("REIMB-SEP26-001", r.batchReference());
        assertEquals("POSTED", r.batchStatus());
        assertEquals(ExpensePolicyCheck.OVER_LIMIT, r.policyCheck().result());
        assertEquals("Local travel", r.policyCheck().policyName());
        assertEquals(0, new BigDecimal("1000").compareTo(r.policyCheck().cap()));
        // The fields that were there before are untouched.
        assertEquals("Me", r.employeeName());
        assertEquals(2, r.itemCount());
        // Every statement filters the tenant.
        verify(jdbc, times(3)).query(anyString(), any(RowCallbackHandler.class), eq(tenant), anyString());
    }

    @Test void aMissingTableLeavesOnlyItsFieldsOut() {
        UUID id = UUID.randomUUID();
        people();
        lines(id);
        caps();
        doThrow(missing("expense_mgmt.reimbursement_batch_items"))
                .when(jdbc).query(contains("reimbursement_batch_items"), any(RowCallbackHandler.class), any(Object[].class));
        ExpenseClaimResponse r = details.add(List.of(claim(id, ExpenseStatus.APPROVED))).get(0);
        assertNull(r.batchReference());
        assertNull(r.batchStatus());
        assertEquals("Sales", r.department());
        assertNotNull(r.policyCheck());

        doThrow(missing("expense_mgmt.expense_items"))
                .when(jdbc).query(contains("FROM expense_mgmt.expense_items"), any(RowCallbackHandler.class), any(Object[].class));
        ExpenseClaimResponse noLines = details.add(List.of(claim(id, ExpenseStatus.APPROVED))).get(0);
        assertNull(noLines.categories());
        assertNull(noLines.policyCheck());
        assertEquals("Mona Manager", noLines.approverName());
    }

    @Test void anyOtherDatabaseErrorIsNotHidden() {
        UUID id = UUID.randomUUID();
        doThrow(new UncategorizedSQLException("q", "SELECT", new SQLException("deadlock detected", "40P01")))
                .when(jdbc).query(contains("FROM hrms.employees e"), any(RowCallbackHandler.class), any(Object[].class));
        assertThrows(UncategorizedSQLException.class, () -> details.add(List.of(claim(id, ExpenseStatus.SUBMITTED))));
    }

    @Test void aClaimWithNoCoveredCategoryShowsNoPolicy() {
        UUID id = UUID.randomUUID();
        people();
        lines(id);
        when(service.capsByCompany(any())).thenReturn(Map.of());
        ExpenseClaimResponse r = details.add(List.of(claim(id, ExpenseStatus.SUBMITTED))).get(0);
        assertEquals(ExpensePolicyCheck.NO_POLICY, r.policyCheck().result());
        assertNull(r.batchReference());
    }

    @Test void nothingToAddForAnEmptyPage() {
        assertEquals(List.of(), details.add(List.of()));
        verifyNoInteractions(jdbc);
    }

    // ── my totals ────────────────────────────────────────────────────────────

    @Test void myTotalsAddUpAllMyClaimsNotOnePage() {
        List<Object[]> seen = new ArrayList<>();
        doAnswer(inv -> {
            seen.add(new Object[]{inv.getArgument(2), inv.getArgument(3), inv.getArgument(4), inv.getArgument(5)});
            return JdbcRows.feed(List.of(
                    row("status", "SUBMITTED", "currency", "INR", "approver_id", approver, "n", 2L, "amount", new BigDecimal("1500")),
                    row("status", "APPROVED", "currency", "INR", "approver_id", approver, "n", 1L, "amount", new BigDecimal("700")),
                    row("status", "APPROVED_FOR_PAY", "currency", "INR", "approver_id", approver, "n", 1L, "amount", new BigDecimal("300")),
                    row("status", "REIMBURSED", "currency", "INR", "approver_id", approver, "n", 4L, "amount", new BigDecimal("9000")),
                    row("status", "SUBMITTED", "currency", "USD", "approver_id", approver, "n", 1L, "amount", new BigDecimal("40"))))
                    .answer(inv);
        }).when(jdbc).query(contains("GROUP BY status"), any(RowCallbackHandler.class), any(Object[].class));
        when(jdbc.queryForObject(contains("SELECT COUNT(*)"), eq(Long.class), any(Object[].class))).thenReturn(11L);
        doAnswer(JdbcRows.feed(List.of(row("id", approver, "name", "Mona Manager", "department", "Sales"))))
                .when(jdbc).query(contains("FROM hrms.employees e"), any(RowCallbackHandler.class), any(Object[].class));

        ExpenseClaimDetails.MySummary s = details.mySummary(me, LocalDate.of(2026, 9, 27));
        assertEquals(2026, s.year());
        assertEquals("INR", s.currency());
        assertEquals(2, s.waiting().count());
        assertEquals(0, new BigDecimal("1500").compareTo(s.waiting().amount()));
        assertEquals(2, s.approvedNotPaid().count(), "APPROVED and APPROVED_FOR_PAY");
        assertEquals(0, new BigDecimal("1000").compareTo(s.approvedNotPaid().amount()));
        assertEquals(4, s.reimbursedThisYear().count());
        assertEquals(11, s.claimsThisYear());
        assertEquals(approver, s.waitingApproverId());
        assertEquals("Mona Manager", s.waitingApproverName());
        assertEquals(1, s.otherCurrencies().size(), "never adds dollars to rupees");
        assertEquals("USD", s.otherCurrencies().get(0).currency());
        assertEquals(1, s.otherCurrencies().get(0).waiting().count());
        // Mine only, this tenant, this calendar year in India time.
        Object[] args = seen.get(0);
        assertEquals(tenant, args[0]);
        assertEquals(me, args[1]);
        assertEquals(Timestamp.from(Instant.parse("2025-12-31T18:30:00Z")), args[2]);
        assertEquals(Timestamp.from(Instant.parse("2026-12-31T18:30:00Z")), args[3]);
    }

    @Test void noApproverNameWhenWaitingClaimsAreWithDifferentPeopleOrNobody() {
        doAnswer(JdbcRows.feed(List.of(
                row("status", "SUBMITTED", "currency", "INR", "approver_id", approver, "n", 1L, "amount", BigDecimal.TEN),
                row("status", "SUBMITTED", "currency", "INR", "approver_id", null, "n", 1L, "amount", BigDecimal.ONE))))
                .when(jdbc).query(contains("GROUP BY status"), any(RowCallbackHandler.class), any(Object[].class));
        when(jdbc.queryForObject(contains("SELECT COUNT(*)"), eq(Long.class), any(Object[].class))).thenReturn(2L);
        ExpenseClaimDetails.MySummary s = details.mySummary(me, LocalDate.of(2026, 1, 1));
        assertNull(s.waitingApproverId());
        assertNull(s.waitingApproverName());
        assertEquals(2, s.waiting().count());
    }

    @Test void noClaimsIsAllZeroInRupees() {
        when(jdbc.queryForObject(contains("SELECT COUNT(*)"), eq(Long.class), any(Object[].class))).thenReturn(0L);
        ExpenseClaimDetails.MySummary s = details.mySummary(me, LocalDate.of(2026, 5, 1));
        assertEquals("INR", s.currency());
        assertEquals(0, s.waiting().count());
        assertEquals(0, BigDecimal.ZERO.compareTo(s.reimbursedThisYear().amount()));
        assertEquals(List.of(), s.otherCurrencies());
    }

    @Test void myTotalsWithoutTheTableAnswerFeatureNotReady() {
        doThrow(missing("expense_mgmt.expense_claims"))
                .when(jdbc).query(contains("GROUP BY status"), any(RowCallbackHandler.class), any(Object[].class));
        assertThrows(FeatureNotReady.class, () -> details.mySummary(me, LocalDate.of(2026, 5, 1)));
    }

    // ── the approvals status filter ──────────────────────────────────────────

    @Test void withoutAFilterTheApprovalsListIsAsBefore() {
        assertEquals(List.of(ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED), ExpenseController.approvalStatuses(null));
        assertEquals(List.of(ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED), ExpenseController.approvalStatuses(List.of()));
        assertEquals(List.of(ExpenseStatus.SUBMITTED), ExpenseController.approvalStatuses(List.of(ExpenseStatus.SUBMITTED)));
        assertEquals(List.of(ExpenseStatus.APPROVED), ExpenseController.approvalStatuses(List.of(ExpenseStatus.APPROVED)));
        assertEquals(List.of(ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED),
                ExpenseController.approvalStatuses(List.of(ExpenseStatus.APPROVED, ExpenseStatus.SUBMITTED)));
        for (ExpenseStatus other : List.of(ExpenseStatus.REJECTED, ExpenseStatus.REIMBURSED, ExpenseStatus.APPROVED_FOR_PAY, ExpenseStatus.DRAFT)) {
            HrmsException e = assertThrows(HrmsException.class, () -> ExpenseController.approvalStatuses(List.of(other)));
            assertEquals("EXPENSE_STATUS_FILTER", e.getErrorCode());
            assertEquals(400, e.getStatus().value());
        }
    }

    @Test void theFilterNarrowsTheSameScope() {
        EmployeeRepository employees = mock(EmployeeRepository.class);
        ExpenseClaimDetails passThrough = mock(ExpenseClaimDetails.class);
        when(passThrough.add(anyList())).thenAnswer(inv -> inv.getArgument(0));
        ExpenseController controller = new ExpenseController(service, mock(ExpensePolicyService.class), employees,
                mock(ExpenseReceipts.class), mock(EmployeeRecordAccess.class), passThrough, mock(AuditService.class));
        PageResponse<ExpenseClaimResponse> empty = new PageResponse<>(List.of(), 0, 20, 0, 0, true);
        when(service.getByStatuses(any(), any())).thenReturn(empty);
        when(service.getPendingForApprover(any(), any(), any())).thenReturn(empty);
        var page = PageRequest.of(0, 20);

        controller.pendingApprovals(jwt(List.of("hrms.expense.reimbursement")), List.of(ExpenseStatus.SUBMITTED), page, null, null);
        verify(service).getByStatuses(List.of(ExpenseStatus.SUBMITTED), page);
        controller.pendingApprovals(jwt(List.of("hrms.expense.claim.approve")), List.of(ExpenseStatus.APPROVED), page, null, null);
        verify(service).getPendingForApprover(me, List.of(ExpenseStatus.APPROVED), page);
        controller.pendingApprovals(jwt(List.of("hrms.expense.claim.approve")), null, page, null, null);
        verify(service).getPendingForApprover(me, List.of(ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED), page);
    }

    private Jwt jwt(List<String> permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).claim("permissions", permissions).build();
    }
}
