package com.hrms.api.approvals;

import com.hrms.api.employee.EmployeeRecordAccess;
import com.hrms.api.expense.ExpenseClaimDetails;
import com.hrms.api.expense.ExpenseController;
import com.hrms.api.expense.ExpenseReceipts;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.expense.dto.ExpenseClaimRequest;
import com.hrms.expense.dto.ExpenseDecisionRequest;
import com.hrms.expense.dto.ExpenseItemRequest;
import com.hrms.expense.entity.ExpenseClaim;
import com.hrms.expense.enums.ExpenseCategory;
import com.hrms.expense.enums.ExpenseStatus;
import com.hrms.expense.repository.ExpenseClaimRepository;
import com.hrms.expense.repository.ExpenseItemRepository;
import com.hrms.expense.repository.ExpensePolicyRepository;
import com.hrms.expense.service.ExpensePolicyService;
import com.hrms.expense.service.ExpenseService;
import com.unifiedtree.audit.AuditService;
import org.aopalliance.intercept.MethodInterceptor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.AspectJExpressionPointcut;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.aop.support.DefaultPointcutAdvisor;
import org.springframework.security.oauth2.jwt.Jwt;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * P-EXP's endpoints keep every expense decision on the path the Undo journal
 * records (redesign ADDENDUM G): the decide endpoint calls the INJECTED
 * ExpenseService bean, so a proxy carrying {@link DecisionJournalAspect}'s
 * expense pointcut sees each decision exactly once; the new endpoints (claim
 * on behalf, the status filter) make no decision of their own.
 */
class ExpenseDecisionJournalPathTest {

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID();
    private final UUID claimant = UUID.randomUUID(), approver = UUID.randomUUID(), hr = UUID.randomUUID();
    private final ExpenseClaimRepository claims = mock(ExpenseClaimRepository.class);
    private final ExpenseItemRepository items = mock(ExpenseItemRepository.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final List<String> journaled = new ArrayList<>();
    private ExpenseService proxied;
    private ExpenseController controller;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        ExpenseService target = new ExpenseService(claims, items, mock(ExpensePolicyRepository.class));
        AspectJExpressionPointcut pc = new AspectJExpressionPointcut();
        pc.setExpression(DecisionJournalAspect.EXPENSE_DECISION);
        MethodInterceptor recorder = inv -> {
            journaled.add(inv.getMethod().getName() + ":" + inv.getArguments()[0]);
            return inv.proceed();
        };
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvisor(new DefaultPointcutAdvisor(pc, recorder));
        proxied = (ExpenseService) factory.getProxy();

        ExpenseClaimDetails details = mock(ExpenseClaimDetails.class);
        when(details.add(anyList())).thenAnswer(inv -> inv.getArgument(0));
        controller = new ExpenseController(proxied, mock(ExpensePolicyService.class), employees,
                mock(ExpenseReceipts.class), mock(EmployeeRecordAccess.class), details, mock(AuditService.class));
        when(claims.save(any(ExpenseClaim.class))).thenAnswer(inv -> {
            ExpenseClaim c = inv.getArgument(0);
            if (c.getId() == null) c.setId(UUID.randomUUID());
            return c;
        });
    }

    @AfterEach void clear() {
        TenantContext.clear();
    }

    private Jwt jwt(UUID employee, String... permissions) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employee.toString()).claim("permissions", List.of(permissions)).build();
    }

    private ExpenseClaim submitted(UUID id) {
        ExpenseClaim c = new ExpenseClaim();
        c.setId(id);
        c.setTenantId(tenant);
        c.setEmployeeId(claimant);
        c.setCompanyId(company);
        c.setTitle("Trip");
        c.setTotalAmount(new BigDecimal("500"));
        c.setCurrency("INR");
        c.setApproverId(approver);
        c.setStatus(ExpenseStatus.SUBMITTED);
        return c;
    }

    @Test void theDecideEndpointGoesThroughTheProxyOnce() {
        UUID id = UUID.randomUUID();
        when(claims.findById(id)).thenReturn(Optional.of(submitted(id)));
        var res = controller.decide(id, new ExpenseDecisionRequest(false, "Not a business trip"), jwt(approver, "hrms.expense.claim.approve"));
        assertEquals(ExpenseStatus.REJECTED, res.getBody().status());
        assertEquals("Not a business trip", res.getBody().approverComment());
        assertEquals(List.of("decide:" + id), journaled);
    }

    @Test void aClaimRaisedOnBehalfIsNotADecisionAndLeavesTheDecisionToTheApprover() {
        Employee e = new Employee();
        e.setId(claimant);
        e.setTenantId(tenant);
        e.setCompanyId(company);
        e.setFirstName("Reader");
        e.setManagerId(approver);
        when(employees.findById(claimant)).thenReturn(Optional.of(e));
        var raised = controller.submitOnBehalf(claimant, new ExpenseClaimRequest(null, "Trip", null, null,
                List.of(new ExpenseItemRequest(ExpenseCategory.TRAVEL, "Taxi", new BigDecimal("500"), LocalDate.now(), null, null))),
                jwt(hr, "hrms.expense.claim.others")).getBody();
        assertEquals(ExpenseStatus.SUBMITTED, raised.status());
        assertEquals(approver, raised.approverId());
        assertTrue(journaled.isEmpty(), "raising a claim records no decision");

        // The approver then decides it through the same journaled path.
        when(claims.findById(raised.id())).thenReturn(Optional.of(submitted(raised.id())));
        controller.decide(raised.id(), new ExpenseDecisionRequest(true, null), jwt(approver, "hrms.expense.claim.approve"));
        assertEquals(List.of("decide:" + raised.id()), journaled);
    }
}
