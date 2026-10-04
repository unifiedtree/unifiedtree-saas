package com.hrms.api.leave;

import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.dto.LeaveRequestRequest;
import com.hrms.leave.dto.LeaveRequestResponse;
import com.hrms.leave.enums.LeaveDuration;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Applying for leave in an employee's name (BW-43): who may, for whom, under
 * whose company, through whose approver, and that the employee is told.
 */
class LeaveApplyOnBehalfTest {

    private final UUID tenant = UUID.randomUUID(), otherTenant = UUID.randomUUID();
    private final UUID hr = UUID.randomUUID(), employeeId = UUID.randomUUID(), manager = UUID.randomUUID();
    private final UUID company = UUID.randomUUID(), hrCompany = UUID.randomUUID(), typeId = UUID.randomUUID();
    private final LocalDate start = LocalDate.of(2026, 10, 12), end = LocalDate.of(2026, 10, 13);

    private LeaveService leaveService;
    private EmployeeRepository employees;
    private WorkforceDepartmentRepository departments;
    private ApproverFallbackResolver approvers;
    private LeaveOnBehalfNotifier notifier;
    private AuditService audit;
    private LeaveController controller;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        leaveService = mock(LeaveService.class);
        employees = mock(EmployeeRepository.class);
        departments = mock(WorkforceDepartmentRepository.class);
        approvers = mock(ApproverFallbackResolver.class);
        notifier = mock(LeaveOnBehalfNotifier.class);
        audit = mock(AuditService.class);
        controller = new LeaveController(leaveService, mock(LeaveTypeService.class), employees, departments, approvers);
        ReflectionTestUtils.setField(controller, "onBehalfNotifier", notifier);
        ReflectionTestUtils.setField(controller, "auditService", audit);
        when(approvers.redirectIfDelegated(any(), any())).thenAnswer(inv -> inv.getArgument(0));
        when(leaveService.companyOfLeaveType(typeId)).thenReturn(company);
        when(leaveService.applyLeave(any(), any(), any(), any())).thenAnswer(inv -> new LeaveRequestResponse(
                UUID.randomUUID(), inv.getArgument(0), null, null, null, typeId, "Casual leave", start, end, 2, "Unwell",
                ApprovalStatus.PENDING, null, null, null));
        when(employees.findById(hr)).thenReturn(Optional.of(person(hr, "Priya", "Rao", hrCompany, null, null, EmploymentStatus.ACTIVE)));
        when(employees.findById(manager)).thenReturn(Optional.of(person(manager, "Dept", "Manager", company, null, null, EmploymentStatus.ACTIVE)));
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private Employee person(UUID id, String first, String last, UUID companyId, UUID managerId, UUID departmentId,
                            EmploymentStatus status) {
        Employee e = new Employee();
        e.setId(id);
        e.setTenantId(tenant);
        e.setCompanyId(companyId);
        e.setFirstName(first);
        e.setLastName(last);
        e.setManagerId(managerId);
        e.setDepartmentId(departmentId);
        e.setEmploymentStatus(status);
        return e;
    }

    private Employee reader(UUID managerId, UUID departmentId, EmploymentStatus status) {
        Employee e = person(employeeId, "Reader", "User", company, managerId, departmentId, status);
        when(employees.findById(employeeId)).thenReturn(Optional.of(e));
        return e;
    }

    private Jwt jwtFor(UUID emp) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", emp.toString()).claim("permissions", List.of("hrms.leave.apply.others")).build();
    }

    private final LeaveRequestRequest body = new LeaveRequestRequest(typeId, LocalDate.of(2026, 10, 12),
            LocalDate.of(2026, 10, 13), LeaveDuration.FULL_DAY, "Unwell");

    @Test void itIsTheEmployeesOwnRequestSentToTheirManagerUnderTheirCompany() {
        reader(manager, null, EmploymentStatus.ACTIVE);
        var res = controller.applyFor(employeeId, body, jwtFor(hr));
        assertEquals(201, res.getStatusCode().value());
        // Filed for the employee, under the EMPLOYEE's company (never the caller's), to the employee's manager.
        verify(leaveService).applyLeave(eq(employeeId), eq(company), same(body), eq(manager));
        assertEquals(employeeId, res.getBody().employeeId());
    }

    @Test void theApproverChainIsTheEmployeesDepartmentHeadThenHr() {
        UUID dept = UUID.randomUUID(), head = UUID.randomUUID(), hrApprover = UUID.randomUUID();
        Department d = new Department();
        d.setId(dept);
        d.setDepartmentHeadEmployeeId(head);
        when(departments.findById(dept)).thenReturn(Optional.of(d));
        when(employees.findById(head)).thenReturn(Optional.of(person(head, "Head", "One", company, null, null, EmploymentStatus.ACTIVE)));
        reader(null, dept, EmploymentStatus.PROBATION);
        controller.applyFor(employeeId, body, jwtFor(hr));
        verify(leaveService).applyLeave(eq(employeeId), eq(company), any(), eq(head));

        reset(leaveService);
        when(leaveService.companyOfLeaveType(typeId)).thenReturn(company);
        when(leaveService.applyLeave(any(), any(), any(), any())).thenReturn(new LeaveRequestResponse(UUID.randomUUID(),
                employeeId, null, null, null, typeId, "Casual leave", start, end, 2, null, ApprovalStatus.PENDING, null, null, null));
        reader(null, null, EmploymentStatus.NOTICE_PERIOD);
        when(approvers.resolveTerminalApprover(eq(tenant), eq(employeeId))).thenReturn(Optional.of(hrApprover));
        when(employees.findById(hrApprover)).thenReturn(Optional.of(person(hrApprover, "HR", "Manager", company, null, null, EmploymentStatus.ACTIVE)));
        controller.applyFor(employeeId, body, jwtFor(hr));
        verify(leaveService).applyLeave(eq(employeeId), eq(company), any(), eq(hrApprover));
    }

    @Test void anActiveDelegationIsFollowedAsForAnyRequest() {
        UUID delegate = UUID.randomUUID();
        reader(manager, null, EmploymentStatus.ACTIVE);
        when(approvers.redirectIfDelegated(eq(manager), any())).thenReturn(delegate);
        controller.applyFor(employeeId, body, jwtFor(hr));
        verify(leaveService).applyLeave(eq(employeeId), eq(company), any(), eq(delegate));
    }

    @Test void theEmployeeIsToldWhoAppliedAndItIsAudited() {
        reader(manager, null, EmploymentStatus.ACTIVE);
        LeaveRequestResponse created = controller.applyFor(employeeId, body, jwtFor(hr)).getBody();
        verify(notifier).tellEmployee(tenant, employeeId, created.id(), "Priya Rao", "Casual leave", start, end);
        verify(audit).record(eq("leave"), eq("LEAVE_APPLIED_ON_BEHALF"), eq("LEAVE_REQUEST"), eq(created.id()),
                argThat(s -> s.contains("Reader User") && s.contains("Casual leave")));
    }

    @Test void neverForYourselfPeopleWhoLeftOrSomeoneElsesWorkspace() {
        assertEquals("LEAVE_ON_BEHALF_SELF",
                assertThrows(BusinessRuleException.class, () -> controller.applyFor(hr, body, jwtFor(hr))).getErrorCode());
        for (EmploymentStatus gone : List.of(EmploymentStatus.EXITED, EmploymentStatus.TERMINATED,
                EmploymentStatus.RESIGNED, EmploymentStatus.RETIRED)) {
            reader(manager, null, gone);
            assertEquals("LEAVE_EMPLOYEE_SEPARATED", assertThrows(BusinessRuleException.class,
                    () -> controller.applyFor(employeeId, body, jwtFor(hr))).getErrorCode(), gone.name());
        }
        Employee elsewhere = reader(manager, null, EmploymentStatus.ACTIVE);
        elsewhere.setTenantId(otherTenant);
        assertThrows(ResourceNotFoundException.class, () -> controller.applyFor(employeeId, body, jwtFor(hr)));
        when(employees.findById(employeeId)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> controller.applyFor(employeeId, body, jwtFor(hr)));
        verify(leaveService, never()).applyLeave(any(), any(), any(), any());
        verifyNoInteractions(notifier, audit);
    }

    @Test void aLeaveTypeOfAnotherCompanyIsRefused() {
        reader(manager, null, EmploymentStatus.ACTIVE);
        when(leaveService.companyOfLeaveType(typeId)).thenReturn(hrCompany);
        assertEquals("LEAVE_TYPE_OTHER_COMPANY", assertThrows(BusinessRuleException.class,
                () -> controller.applyFor(employeeId, body, jwtFor(hr))).getErrorCode());
        verify(leaveService, never()).applyLeave(any(), any(), any(), any());
    }

    @Test void theEmployeesRulesStillApplyAndARefusedRequestTellsNobody() {
        reader(manager, null, EmploymentStatus.ACTIVE);
        when(leaveService.applyLeave(any(), any(), any(), any())).thenThrow(new BusinessRuleException(
                "Insufficient leave balance. Available: 1.0, Requested: 2.0", "INSUFFICIENT_LEAVE_BALANCE"));
        assertEquals("INSUFFICIENT_LEAVE_BALANCE", assertThrows(BusinessRuleException.class,
                () -> controller.applyFor(employeeId, body, jwtFor(hr))).getErrorCode());
        verifyNoInteractions(notifier, audit);
    }

    @Test void applyingForYourselfStillUsesTheSameChain() {
        Employee me = person(employeeId, "Reader", "User", company, manager, null, EmploymentStatus.ACTIVE);
        when(employees.findById(employeeId)).thenReturn(Optional.of(me));
        controller.apply(body, null, jwtFor(employeeId));
        verify(leaveService).applyLeave(eq(employeeId), eq(company), same(body), eq(manager));
        // The optional company override of /apply is unchanged.
        UUID other = UUID.randomUUID();
        controller.apply(body, other, jwtFor(employeeId));
        verify(leaveService).applyLeave(eq(employeeId), eq(other), same(body), eq(manager));
        verifyNoInteractions(notifier);
    }

    @Test void onlyHoldersOfTheNewPermissionMayApplyForOthers() throws Exception {
        PreAuthorize guard = LeaveController.class.getMethod("applyFor", UUID.class, LeaveRequestRequest.class, Jwt.class)
                .getAnnotation(PreAuthorize.class);
        assertEquals("@perm.check('hrms.leave.apply.others')", guard.value());
    }

    // ── the notification ─────────────────────────────────────────────────────

    @Test void theNotificationUsesItsCatalogEntryAndTheEmployeesRoute() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        UUID requestId = UUID.randomUUID();
        new LeaveOnBehalfNotifier(dispatcher).tellEmployee(tenant, employeeId, requestId, "Priya Rao", "Casual leave", start, end);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(tenant), eq(employeeId), eq("leave.applied_on_behalf"), values.capture(), data.capture());
        assertEquals(Map.of("raisedBy", "Priya Rao", "leaveType", "Casual leave", "startDate", "12 Oct 2026",
                "endDate", "13 Oct 2026"), values.getValue());
        assertEquals("LEAVE_APPLIED_ON_BEHALF", data.getValue().get("type"));
        assertEquals(requestId.toString(), data.getValue().get("leaveRequestId"));
        assertEquals("/leave-history", data.getValue().get("route"));
        // The event exists in the catalog (C0) with this type and every placeholder we fill.
        var def = NotificationEventCatalog.byKey("leave.applied_on_behalf").orElseThrow();
        assertEquals(AppNotificationType.LEAVE_APPLIED_ON_BEHALF, def.type());
        for (String placeholder : values.getValue().keySet()) {
            assertTrue(def.defaultBody().contains("{{" + placeholder + "}}"), placeholder);
        }
    }

    @Test void anUnknownRaiserReadsAsHrAndAFailedNotificationNeverFailsTheRequest() {
        assertEquals("HR", LeaveOnBehalfNotifier.values(null, "Casual leave", start, end).get("raisedBy"));
        assertEquals("leave", LeaveOnBehalfNotifier.values("Priya", null, start, end).get("leaveType"));
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        when(dispatcher.dispatch(any(), any(), any(), any(), any())).thenThrow(new IllegalStateException("mail down"));
        assertDoesNotThrow(() -> new LeaveOnBehalfNotifier(dispatcher)
                .tellEmployee(tenant, employeeId, UUID.randomUUID(), "Priya", "Casual leave", start, end));
    }
}
