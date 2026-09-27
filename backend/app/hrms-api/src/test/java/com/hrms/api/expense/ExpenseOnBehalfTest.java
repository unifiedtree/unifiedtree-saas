package com.hrms.api.expense;

import com.hrms.api.employee.EmployeeRecordAccess;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.expense.dto.ExpenseClaimRequest;
import com.hrms.expense.dto.ExpenseClaimResponse;
import com.hrms.expense.dto.ExpenseItemRequest;
import com.hrms.expense.entity.ExpenseClaim;
import com.hrms.expense.entity.ExpensePolicy;
import com.hrms.expense.enums.ExpenseCategory;
import com.hrms.expense.enums.ExpenseStatus;
import com.hrms.expense.repository.ExpenseClaimRepository;
import com.hrms.expense.repository.ExpenseItemRepository;
import com.hrms.expense.repository.ExpensePolicyRepository;
import com.hrms.expense.service.ExpensePolicyService;
import com.hrms.expense.service.ExpenseService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.events.ExpenseClaimRaisedForYouEvent;
import com.unifiedtree.notifications.events.ExpenseClaimSubmittedEvent;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** HR, finance or an admin raising an expense claim in an employee's name (redesign BW-61). */
class ExpenseOnBehalfTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID hr = UUID.randomUUID(), employeeId = UUID.randomUUID(), manager = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
    }

    @AfterEach void clear() {
        TenantContext.clear();
    }

    private static ExpenseClaimRequest body(UUID companyId, String receiptUrl) {
        return new ExpenseClaimRequest(companyId, "Client visit", null, "QA",
                List.of(new ExpenseItemRequest(ExpenseCategory.TRAVEL, "Taxi", new BigDecimal("1200"), LocalDate.now(), receiptUrl, "Uber")));
    }

    // ── service ──────────────────────────────────────────────────────────────

    private final ExpenseClaimRepository claimRepo = mock(ExpenseClaimRepository.class);
    private final ExpensePolicyRepository policyRepo = mock(ExpensePolicyRepository.class);
    private final ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
    private final ExpenseService realService = new ExpenseService(claimRepo, mock(ExpenseItemRepository.class), policyRepo);

    private void serviceReady() {
        ReflectionTestUtils.setField(realService, "eventPublisher", publisher);
        when(claimRepo.save(any(ExpenseClaim.class))).thenAnswer(inv -> {
            ExpenseClaim c = inv.getArgument(0);
            c.setId(UUID.randomUUID());
            return c;
        });
    }

    @Test void serviceRoutesToTheApproverAndTellsTheEmployee() {
        serviceReady();
        ExpenseClaimResponse r = realService.submitClaimOnBehalf(employeeId, company, body(company, null), manager, hr);
        ArgumentCaptor<ExpenseClaim> saved = ArgumentCaptor.forClass(ExpenseClaim.class);
        verify(claimRepo).save(saved.capture());
        assertEquals(employeeId, saved.getValue().getEmployeeId());
        assertEquals(company, saved.getValue().getCompanyId());
        assertEquals(manager, saved.getValue().getApproverId());
        assertEquals(ExpenseStatus.SUBMITTED, saved.getValue().getStatus(), "it waits for the usual decision");
        assertEquals(ExpenseStatus.SUBMITTED, r.status());
        ArgumentCaptor<Object> events = ArgumentCaptor.forClass(Object.class);
        verify(publisher, times(2)).publishEvent(events.capture());
        ExpenseClaimSubmittedEvent toApprover = (ExpenseClaimSubmittedEvent) events.getAllValues().get(0);
        assertEquals(manager, toApprover.approverId());
        ExpenseClaimRaisedForYouEvent told = (ExpenseClaimRaisedForYouEvent) events.getAllValues().get(1);
        assertEquals(employeeId, told.employeeId());
        assertEquals(hr, told.raisedById());
        assertEquals(tenant, told.tenantId());
        assertEquals(r.id(), told.claimId());
        assertEquals(0, new BigDecimal("1200").compareTo(told.amount()));
    }

    @Test void serviceRefusesYourselfAndKeepsTheCaps() {
        serviceReady();
        BusinessRuleException self = assertThrows(BusinessRuleException.class,
                () -> realService.submitClaimOnBehalf(employeeId, company, body(company, null), manager, employeeId));
        assertEquals("EXPENSE_ON_BEHALF_SELF", self.getErrorCode());
        ExpensePolicy tight = new ExpensePolicy();
        tight.setName("Travel");
        tight.setCategory(ExpenseCategory.TRAVEL);
        tight.setMaxAmountPerClaim(new BigDecimal("1000"));
        tight.setActive(true);
        when(policyRepo.findByCompanyIdAndActiveTrueOrderByName(company)).thenReturn(List.of(tight));
        BusinessRuleException cap = assertThrows(BusinessRuleException.class,
                () -> realService.submitClaimOnBehalf(employeeId, company, body(company, null), manager, hr));
        assertEquals("EXPENSE_POLICY_CAP_EXCEEDED", cap.getErrorCode());
        verify(claimRepo, never()).save(any());
        verify(publisher, never()).publishEvent(any());
    }

    @Test void anOwnClaimTellsNobodyItWasRaisedForThem() {
        serviceReady();
        realService.submitClaim(employeeId, company, body(company, null), manager);
        verify(publisher, times(1)).publishEvent(any(ExpenseClaimSubmittedEvent.class));
        verify(publisher, never()).publishEvent(any(ExpenseClaimRaisedForYouEvent.class));
    }

    // ── controller ───────────────────────────────────────────────────────────

    private final ExpenseService service = mock(ExpenseService.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final ExpenseReceipts receipts = mock(ExpenseReceipts.class);
    private final ExpenseClaimDetails details = mock(ExpenseClaimDetails.class);
    private final AuditService audit = mock(AuditService.class);
    private final ApproverFallbackResolver approvers = mock(ApproverFallbackResolver.class);
    private final ExpenseController controller = controller();

    private ExpenseController controller() {
        ExpenseController c = new ExpenseController(service, mock(ExpensePolicyService.class), employees, receipts,
                mock(EmployeeRecordAccess.class), details, audit);
        ReflectionTestUtils.setField(c, "delegationResolver", approvers);
        return c;
    }

    private Jwt jwtFor(UUID emp) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", emp.toString()).claim("permissions", List.of("hrms.expense.claim.others")).build();
    }

    private Employee employee(EmploymentStatus status, UUID managerId) {
        Employee e = new Employee();
        e.setId(employeeId);
        e.setTenantId(tenant);
        e.setCompanyId(company);
        e.setFirstName("Reader");
        e.setLastName("Person");
        e.setEmploymentStatus(status);
        e.setManagerId(managerId);
        return e;
    }

    private void controllerReady(Employee target) {
        when(employees.findById(employeeId)).thenReturn(Optional.of(target));
        when(details.add(anyList())).thenAnswer(inv -> inv.getArgument(0));
        when(service.submitClaimOnBehalf(any(), any(), any(), any(), any())).thenAnswer(inv -> new ExpenseClaimResponse(
                UUID.randomUUID(), employeeId, null, null, company, "Client visit", new BigDecimal("1200"), "INR",
                ExpenseStatus.SUBMITTED, null, inv.getArgument(3), null, null, null, "QA", null, List.of(), 1, 0));
    }

    @Test void routesToTheEmployeesUsualApproverUnderTheirOwnCompany() {
        controllerReady(employee(EmploymentStatus.ACTIVE, manager));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        var res = controller.submitOnBehalf(employeeId, body(null, null), jwtFor(hr));
        assertEquals(201, res.getStatusCode().value());
        verify(service).submitClaimOnBehalf(eq(employeeId), eq(company), any(), eq(manager), eq(hr));
        assertEquals("Reader Person", res.getBody().employeeName());
        verify(audit).record(eq("expense"), eq("EXPENSE_CLAIM_RAISED_ON_BEHALF"), eq("expense_claim"), any(), contains("Reader Person"));
        // The same company, named explicitly, is fine.
        controller.submitOnBehalf(employeeId, body(company, null), jwtFor(hr));
        verify(service, times(2)).submitClaimOnBehalf(eq(employeeId), eq(company), any(), eq(manager), eq(hr));
    }

    @Test void followsTheManagersDelegationAndFallsToFinanceWithoutAManager() {
        UUID delegate = UUID.randomUUID();
        controllerReady(employee(EmploymentStatus.PROBATION, manager));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(delegate);
        controller.submitOnBehalf(employeeId, body(null, null), jwtFor(hr));
        verify(service).submitClaimOnBehalf(eq(employeeId), eq(company), any(), eq(delegate), eq(hr));

        when(employees.findById(employeeId)).thenReturn(Optional.of(employee(EmploymentStatus.ACTIVE, null)));
        controller.submitOnBehalf(employeeId, body(null, null), jwtFor(hr));
        verify(service).submitClaimOnBehalf(eq(employeeId), eq(company), any(), isNull(), eq(hr));
    }

    @Test void refusesAnotherCompanyYourselfPeopleWhoLeftAndStrangers() {
        controllerReady(employee(EmploymentStatus.ACTIVE, manager));
        BusinessRuleException otherCompany = assertThrows(BusinessRuleException.class,
                () -> controller.submitOnBehalf(employeeId, body(UUID.randomUUID(), null), jwtFor(hr)));
        assertEquals("EXPENSE_ON_BEHALF_COMPANY", otherCompany.getErrorCode());

        BusinessRuleException self = assertThrows(BusinessRuleException.class,
                () -> controller.submitOnBehalf(hr, body(null, null), jwtFor(hr)));
        assertEquals("EXPENSE_ON_BEHALF_SELF", self.getErrorCode());

        for (EmploymentStatus gone : List.of(EmploymentStatus.EXITED, EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED)) {
            when(employees.findById(employeeId)).thenReturn(Optional.of(employee(gone, manager)));
            BusinessRuleException left = assertThrows(BusinessRuleException.class,
                    () -> controller.submitOnBehalf(employeeId, body(null, null), jwtFor(hr)));
            assertEquals("EXPENSE_EMPLOYEE_SEPARATED", left.getErrorCode());
        }

        Employee elsewhere = employee(EmploymentStatus.ACTIVE, manager);
        elsewhere.setTenantId(UUID.randomUUID());
        when(employees.findById(employeeId)).thenReturn(Optional.of(elsewhere));
        assertThrows(ResourceNotFoundException.class, () -> controller.submitOnBehalf(employeeId, body(null, null), jwtFor(hr)));

        when(employees.findById(employeeId)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> controller.submitOnBehalf(employeeId, body(null, null), jwtFor(hr)));
        verify(service, never()).submitClaimOnBehalf(any(), any(), any(), any(), any());
        verifyNoInteractions(audit);
    }

    @Test void receiptsMustHaveBeenUploadedForTheEmployee() {
        controllerReady(employee(EmploymentStatus.ACTIVE, manager));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        String raisersOwn = "r2://expense-receipts/" + tenant + "/" + hr + "/" + UUID.randomUUID() + ".pdf";
        ResponseStatusException refused = assertThrows(ResponseStatusException.class,
                () -> controller.submitOnBehalf(employeeId, body(null, raisersOwn), jwtFor(hr)));
        assertEquals(400, refused.getStatusCode().value());
        String theirs = "r2://expense-receipts/" + tenant + "/" + employeeId + "/" + UUID.randomUUID() + ".pdf";
        controller.submitOnBehalf(employeeId, body(null, theirs), jwtFor(hr));
        ArgumentCaptor<ExpenseClaimRequest> sent = ArgumentCaptor.forClass(ExpenseClaimRequest.class);
        verify(service).submitClaimOnBehalf(eq(employeeId), eq(company), sent.capture(), eq(manager), eq(hr));
        assertEquals(theirs, sent.getValue().items().get(0).receiptUrl());
    }

    @Test void aReceiptUploadedOnBehalfIsFiledUnderTheEmployee() throws Exception {
        controllerReady(employee(EmploymentStatus.ACTIVE, manager));
        var file = new org.springframework.mock.web.MockMultipartFile("file", "r.pdf", "application/pdf", "%PDF-1.4".getBytes());
        controller.uploadReceiptOnBehalf(employeeId, file, jwtFor(hr));
        verify(receipts).store(tenant, employeeId, file);
        assertThrows(BusinessRuleException.class, () -> controller.uploadReceiptOnBehalf(hr, file, jwtFor(hr)));
    }

    @Test void guardsOnTheNewEndpoints() throws Exception {
        Map<String, String> guards = java.util.Arrays.stream(ExpenseController.class.getDeclaredMethods())
                .filter(m -> m.isAnnotationPresent(PreAuthorize.class))
                .collect(Collectors.toMap(java.lang.reflect.Method::getName, m -> m.getAnnotation(PreAuthorize.class).value()));
        assertEquals("@perm.check('hrms.expense.claim.others')", guards.get("submitOnBehalf"));
        assertEquals("@perm.check('hrms.expense.claim.others')", guards.get("uploadReceiptOnBehalf"));
        assertEquals("hasAuthority('hrms.expense.claim.self')", guards.get("mySummary"));
        assertEquals("hasAuthority('hrms.expense.claim.self')", guards.get("myApprover"));
        assertEquals("hasAnyAuthority('hrms.expense.claim.self','hrms.expense.claim.others','hrms.expense.policy.read')",
                guards.get("categoryCaps"));
        // Unchanged: the decide endpoint and its permission.
        assertEquals("@perm.check('hrms.expense.claim.approve')", guards.get("decide"));
    }

    // ── my approver ──────────────────────────────────────────────────────────

    private Jwt selfJwt() {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).claim("permissions", List.of("hrms.expense.claim.self")).build();
    }

    @Test void myApproverIsWhoASubmittedClaimWouldGoTo() {
        Employee boss = new Employee();
        boss.setId(manager);
        boss.setFirstName("Mona");
        boss.setLastName("Manager");
        when(employees.findById(employeeId)).thenReturn(Optional.of(employee(EmploymentStatus.ACTIVE, manager)));
        when(employees.findById(manager)).thenReturn(Optional.of(boss));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        var a = controller.myApprover(selfJwt()).getBody();
        assertEquals(manager, a.approverId());
        assertEquals("Mona Manager", a.approverName());
        assertEquals(ExpenseController.ClaimApprover.MANAGER, a.via());

        when(employees.findById(employeeId)).thenReturn(Optional.of(employee(EmploymentStatus.ACTIVE, null)));
        var none = controller.myApprover(selfJwt()).getBody();
        assertNull(none.approverId());
        assertEquals(ExpenseController.ClaimApprover.FINANCE, none.via());
    }

    // ── the employee is told ─────────────────────────────────────────────────

    @Test void theEmployeeIsToldWithTheCatalogsPlaceholders() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        NotificationLookupService lookup = mock(NotificationLookupService.class);
        when(lookup.employeeName(hr, tenant)).thenReturn("Harini HR");
        ExpenseOnBehalfNotifier notifier = new ExpenseOnBehalfNotifier(dispatcher, lookup);
        UUID claim = UUID.randomUUID();
        notifier.onRaisedForYou(new ExpenseClaimRaisedForYouEvent(claim, employeeId, hr, tenant, "Client visit", new BigDecimal("125000"), "INR"));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(tenant), eq(employeeId), eq("expense.raised_for_you"), values.capture(), data.capture());
        assertEquals("Harini HR", values.getValue().get("raisedBy"));
        assertEquals("Client visit", values.getValue().get("claimTitle"));
        assertEquals("₹1,25,000", values.getValue().get("amount"));
        assertEquals(AppNotificationType.EXPENSE_CLAIM_RAISED_FOR_YOU.name(), data.getValue().get("type"));
        assertEquals(claim.toString(), data.getValue().get("expenseClaimId"));

        var def = NotificationEventCatalog.byKey("expense.raised_for_you").orElseThrow();
        assertEquals(AppNotificationType.EXPENSE_CLAIM_RAISED_FOR_YOU, def.type());
        Set<String> needed = def.placeholders().stream().map(NotificationEventCatalog.Placeholder::name).collect(Collectors.toSet());
        assertTrue(values.getValue().keySet().containsAll(needed), "every placeholder is filled: " + needed);

        when(lookup.employeeName(hr, tenant)).thenReturn(null);
        notifier.onRaisedForYou(new ExpenseClaimRaisedForYouEvent(claim, employeeId, hr, tenant, "x", BigDecimal.TEN, "INR"));
        verify(dispatcher, times(2)).dispatch(eq(tenant), eq(employeeId), eq("expense.raised_for_you"), values.capture(), any());
        assertEquals("HR", values.getValue().get("raisedBy"));
    }
}
