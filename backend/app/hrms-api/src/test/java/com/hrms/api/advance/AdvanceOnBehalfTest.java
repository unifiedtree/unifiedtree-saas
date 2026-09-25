package com.hrms.api.advance;

import com.hrms.advance.dto.AdvanceRequestCreateRequest;
import com.hrms.advance.dto.AdvanceResponse;
import com.hrms.advance.entity.AdvanceRequest;
import com.hrms.advance.enums.AdvanceStatus;
import com.hrms.advance.repository.AdvanceRequestRepository;
import com.hrms.advance.service.AdvanceService;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.notifications.events.AdvanceRaisedOnBehalfEvent;
import com.unifiedtree.notifications.events.AdvanceRequestSubmittedEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** HR / finance raising a salary advance in an employee's name. */
class AdvanceOnBehalfTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID hr = UUID.randomUUID(), employeeId = UUID.randomUUID(), manager = UUID.randomUUID(), company = UUID.randomUUID();
    private final AdvanceRequestRepository repository = mock(AdvanceRequestRepository.class);
    private final ApplicationEventPublisher publisher = mock(ApplicationEventPublisher.class);
    private final AdvanceService service = new AdvanceService(repository, mock(JdbcTemplate.class));

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        ReflectionTestUtils.setField(service, "eventPublisher", publisher);
        when(repository.save(any(AdvanceRequest.class))).thenAnswer(inv -> {
            AdvanceRequest a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private final AdvanceRequestCreateRequest body = new AdvanceRequestCreateRequest(new BigDecimal("30000"), "Medical emergency", 3);

    @Test void serviceRecordsWhoRaisedItAndTellsTheEmployee() {
        AdvanceResponse r = service.requestAdvanceOnBehalf(employeeId, company, body, manager, hr);
        ArgumentCaptor<AdvanceRequest> saved = ArgumentCaptor.forClass(AdvanceRequest.class);
        verify(repository).save(saved.capture());
        assertEquals(hr, saved.getValue().getRaisedByEmployeeId());
        assertEquals(employeeId, saved.getValue().getEmployeeId());
        assertEquals(manager, saved.getValue().getApproverId());
        assertEquals(AdvanceStatus.REQUESTED, saved.getValue().getStatus());
        assertEquals(new BigDecimal("10000.00"), saved.getValue().getMonthlyDeduction());
        assertEquals(hr, r.raisedById());
        // The approver gets the usual request; the employee gets told it was raised for them.
        verify(publisher).publishEvent(any(AdvanceRequestSubmittedEvent.class));
        ArgumentCaptor<Object> events = ArgumentCaptor.forClass(Object.class);
        verify(publisher, times(2)).publishEvent(events.capture());
        AdvanceRaisedOnBehalfEvent told = (AdvanceRaisedOnBehalfEvent) events.getAllValues().get(1);
        assertEquals(employeeId, told.employeeId());
        assertEquals(hr, told.raisedById());
        assertEquals(3, told.repaymentMonths());
    }

    @Test void ownRequestHasNoRaiserAndNoExtraNotice() {
        AdvanceResponse r = service.requestAdvance(employeeId, company, body, manager);
        assertNull(r.raisedById());
        verify(publisher, times(1)).publishEvent(any(AdvanceRequestSubmittedEvent.class));
        verify(publisher, never()).publishEvent(any(AdvanceRaisedOnBehalfEvent.class));
    }

    @Test void serviceRefusesToRaiseForYourself() {
        assertThrows(BusinessRuleException.class, () -> service.requestAdvanceOnBehalf(employeeId, company, body, manager, employeeId));
        verify(repository, never()).save(any());
    }

    // ── controller ──

    private final AdvanceService advanceService = mock(AdvanceService.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final ApproverFallbackResolver approvers = mock(ApproverFallbackResolver.class);
    private final AdvanceController controller = new AdvanceController(advanceService, employees, mock(AdvanceRecoveryService.class), approvers);

    private Jwt jwtFor(UUID emp) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", emp.toString()).claim("permissions", List.of("hrms.advance.request.others")).build();
    }

    private Employee employee(EmploymentStatus status, UUID managerId) {
        Employee e = new Employee();
        e.setId(employeeId);
        e.setCompanyId(company);
        e.setFirstName("Reader");
        e.setEmploymentStatus(status);
        e.setManagerId(managerId);
        return e;
    }

    private AdvanceController.AdvanceOnBehalfRequest onBehalf(UUID who) {
        return new AdvanceController.AdvanceOnBehalfRequest(who, new BigDecimal("30000"), "  Medical emergency ", 3);
    }

    private void serviceAnswers() {
        when(advanceService.requestAdvanceOnBehalf(any(), any(), any(), any(), any())).thenReturn(new AdvanceResponse(
                UUID.randomUUID(), employeeId, null, null, company, new BigDecimal("30000"), "Medical emergency", 3,
                new BigDecimal("10000"), AdvanceStatus.REQUESTED, manager, null, null, null, new BigDecimal("30000"), null, hr, null));
    }

    @Test void controllerRoutesToTheEmployeesApproverAndRecordsTheCaller() {
        when(employees.findById(employeeId)).thenReturn(Optional.of(employee(EmploymentStatus.ACTIVE, manager)));
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(manager);
        serviceAnswers();
        var res = controller.requestOnBehalf(onBehalf(employeeId), jwtFor(hr));
        assertEquals(201, res.getStatusCode().value());
        ArgumentCaptor<AdvanceRequestCreateRequest> req = ArgumentCaptor.forClass(AdvanceRequestCreateRequest.class);
        verify(advanceService).requestAdvanceOnBehalf(eq(employeeId), eq(company), req.capture(), eq(manager), eq(hr));
        assertEquals("Medical emergency", req.getValue().reason());
        assertEquals(3, req.getValue().repaymentMonths());
    }

    @Test void controllerFallsBackToHrWhenTheEmployeeHasNoManager() {
        UUID hrApprover = UUID.randomUUID();
        when(employees.findById(employeeId)).thenReturn(Optional.of(employee(EmploymentStatus.PROBATION, null)));
        when(approvers.resolveTerminalApprover(tenant)).thenReturn(Optional.of(hrApprover));
        when(approvers.redirectIfDelegated(eq(hrApprover), any())).thenReturn(hrApprover);
        serviceAnswers();
        controller.requestOnBehalf(onBehalf(employeeId), jwtFor(hr));
        verify(advanceService).requestAdvanceOnBehalf(eq(employeeId), eq(company), any(), eq(hrApprover), eq(hr));
    }

    @Test void controllerRefusesYourselfAndPeopleWhoHaveLeft() {
        BusinessRuleException self = assertThrows(BusinessRuleException.class, () -> controller.requestOnBehalf(onBehalf(hr), jwtFor(hr)));
        assertEquals("ADVANCE_ON_BEHALF_SELF", self.getErrorCode());
        for (EmploymentStatus gone : List.of(EmploymentStatus.EXITED, EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED)) {
            when(employees.findById(employeeId)).thenReturn(Optional.of(employee(gone, manager)));
            BusinessRuleException left = assertThrows(BusinessRuleException.class, () -> controller.requestOnBehalf(onBehalf(employeeId), jwtFor(hr)));
            assertEquals("ADVANCE_EMPLOYEE_SEPARATED", left.getErrorCode());
        }
        when(employees.findById(employeeId)).thenReturn(Optional.empty());
        assertThrows(com.hrms.core.exception.ResourceNotFoundException.class, () -> controller.requestOnBehalf(onBehalf(employeeId), jwtFor(hr)));
        verifyNoInteractions(advanceService);
    }
}
