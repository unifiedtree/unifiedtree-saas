package com.hrms.api.ess;

import com.hrms.api.ess.ApproverChainService.Choice;
import com.hrms.api.ess.ApproverChainService.Kind;
import com.hrms.api.ess.ApproverChainService.Source;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.api.leave.LeaveController;
import com.hrms.api.wfh.WfhController;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.dto.LeaveRequestRequest;
import com.hrms.leave.dto.WfhRequestRequest;
import com.hrms.leave.dto.WfhRequestResponse;
import com.hrms.leave.service.LeaveService;
import com.hrms.leave.service.LeaveTypeService;
import com.hrms.leave.service.WfhService;
import com.unifiedtree.notifications.events.CorrectionSubmittedEvent;
import com.unifiedtree.notifications.events.ShiftChangeSubmittedEvent;
import com.unifiedtree.notifications.listener.DomainEventListener;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-122: the approver preview picks the same person the real request paths
 * pick. Each fixture is one workspace shape; for every one, the unchanged
 * {@code LeaveController.apply} and {@code WfhController.apply} are run and the
 * approver they hand to the service is compared with {@link ApproverChainService}
 * and with the preview endpoint. Fixes and shift changes are compared with the
 * person {@code DomainEventListener} actually notifies.
 */
class ApproverChainFixtureTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID OTHER_TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    /** One small workspace: the people, departments, terminal fallback, delegations and HR role holders. */
    private final Map<UUID, Employee> people = new HashMap<>();
    private final Map<UUID, Department> depts = new HashMap<>();
    private final Map<UUID, UUID> delegations = new HashMap<>();
    private final Set<UUID> hrHolders = new HashSet<>();
    private UUID terminal;
    /** The terminal fallback when {@code terminal} is the applicant themself (the next HR manager or admin); null when there is nobody else. */
    private UUID nextTerminal;
    private UUID firstHr;
    private UUID firstAdmin;

    private EmployeeRepository employees;
    private WorkforceDepartmentRepository departments;
    private ApproverFallbackResolver fallback;
    private NotificationLookupService lookup;
    private JdbcTemplate jdbc;
    private ApproverChainService chain;

    @BeforeEach
    void wire() {
        employees = mock(EmployeeRepository.class);
        departments = mock(WorkforceDepartmentRepository.class);
        fallback = mock(ApproverFallbackResolver.class);
        lookup = mock(NotificationLookupService.class);
        jdbc = mock(JdbcTemplate.class);
        when(employees.findById(any())).thenAnswer(i -> Optional.ofNullable(people.get((UUID) i.getArgument(0))));
        when(departments.findById(any())).thenAnswer(i -> Optional.ofNullable(depts.get((UUID) i.getArgument(0))));
        when(fallback.resolveTerminalApprover(any())).thenAnswer(i -> Optional.ofNullable(terminal));
        when(fallback.resolveTerminalApprover(any(), any())).thenAnswer(i ->
                Optional.ofNullable(terminal != null && terminal.equals(i.getArgument(1)) && nextTerminal != null ? nextTerminal : terminal));
        when(fallback.redirectIfDelegated(any(), any())).thenAnswer(i -> {
            UUID id = i.getArgument(0);
            return id == null ? null : delegations.getOrDefault(id, id);
        });
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(), any(), any()))
                .thenAnswer(i -> hrHolders.contains((UUID) i.getArgument(4)));
        // DomainEventListener's lookups, over the same workspace.
        when(lookup.directApprover(any(), any())).thenAnswer(i -> {
            Employee e = people.get((UUID) i.getArgument(0));
            if (e == null) return null;
            if (e.getManagerId() != null) return e.getManagerId();
            Department d = e.getDepartmentId() == null ? null : depts.get(e.getDepartmentId());
            return d == null ? null : d.getDepartmentHeadEmployeeId();
        });
        when(lookup.firstEmployeeWithRole(any(), eq(ApproverChainService.HR_MANAGER))).thenAnswer(i -> firstHr);
        when(lookup.firstEmployeeWithRole(any(), eq(ApproverChainService.SUPER_ADMIN))).thenAnswer(i -> firstAdmin);
        when(lookup.employeeName(any(), any())).thenReturn("Someone");
        chain = new ApproverChainService(employees, departments, fallback, lookup, jdbc);
    }

    private Employee person(String first, EmploymentStatus status) {
        Employee e = new Employee();
        e.setId(UUID.randomUUID());
        e.setTenantId(TENANT);
        e.setCompanyId(COMPANY);
        e.setFirstName(first);
        e.setLastName("Rao");
        e.setEmployeeCode("E-" + first);
        e.setEmploymentStatus(status);
        people.put(e.getId(), e);
        return e;
    }

    private Department department(Employee head) {
        Department d = new Department();
        d.setId(UUID.randomUUID());
        d.setDepartmentHeadEmployeeId(head == null ? null : head.getId());
        depts.put(d.getId(), d);
        return d;
    }

    private static Jwt tokenFor(Employee e) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", e.getId().toString()).claim("tenant_id", TENANT.toString()).build();
    }

    // ── what the real paths pick ─────────────────────────────────────────────

    /** The approver LeaveController.apply hands to LeaveService, or the refusal's code. */
    private Object leavePick(Employee applicant) {
        LeaveService leaveService = mock(LeaveService.class);
        LeaveController controller = new LeaveController(leaveService, mock(LeaveTypeService.class), employees, departments, fallback);
        try {
            controller.apply(new LeaveRequestRequest(UUID.randomUUID(), LocalDate.now().plusDays(3), LocalDate.now().plusDays(3), null, "Family"),
                    null, tokenFor(applicant));
        } catch (BusinessRuleException refused) {
            return refused.getErrorCode();
        }
        ArgumentCaptor<UUID> approver = ArgumentCaptor.forClass(UUID.class);
        verify(leaveService).applyLeave(eq(applicant.getId()), any(), any(), approver.capture());
        return approver.getValue();
    }

    /** The approver WfhController.apply hands to WfhService, or the refusal's code. */
    private Object wfhPick(Employee applicant) {
        WfhService wfhService = mock(WfhService.class);
        when(wfhService.apply(any(), any(), any())).thenAnswer(i -> new WfhRequestResponse(UUID.randomUUID(), applicant.getId(),
                null, null, null, LocalDate.now().plusDays(2), LocalDate.now().plusDays(2), "x", ApprovalStatus.PENDING,
                i.getArgument(2), null, null, Instant.now(), null));
        WfhController controller = new WfhController(wfhService, employees, departments, fallback);
        try {
            controller.apply(new WfhRequestRequest(LocalDate.now().plusDays(2), LocalDate.now().plusDays(2), "Plumber visit"), tokenFor(applicant));
        } catch (BusinessRuleException refused) {
            return refused.getErrorCode();
        }
        ArgumentCaptor<UUID> approver = ArgumentCaptor.forClass(UUID.class);
        verify(wfhService).apply(eq(applicant.getId()), any(), approver.capture());
        return approver.getValue();
    }

    /** Who DomainEventListener notifies for a fix (or shift change) of the applicant; null when nobody. */
    private UUID notifiedFor(Employee applicant, boolean shift) {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        DomainEventListener listener = new DomainEventListener(mock(AppNotificationService.class), lookup, dispatcher);
        if (shift) {
            listener.onShiftChangeSubmitted(new ShiftChangeSubmittedEvent(UUID.randomUUID(), applicant.getId(), TENANT, "Morning", LocalDate.now()));
        } else {
            listener.onCorrectionSubmitted(new CorrectionSubmittedEvent(UUID.randomUUID(), applicant.getId(), TENANT, LocalDate.now()));
        }
        ArgumentCaptor<UUID> recipient = ArgumentCaptor.forClass(UUID.class);
        verify(dispatcher, atMost(1)).dispatch(eq(TENANT), recipient.capture(), anyString(), anyMap(), anyMap());
        return recipient.getAllValues().isEmpty() ? null : recipient.getValue();
    }

    /** The preview endpoint's answer for the applicant. */
    private MyApproversController.ApproverPreview preview(Employee applicant, String kind) {
        return new MyApproversController(chain, employees).preview(kind, tokenFor(applicant));
    }

    /**
     * The heart of the fixture: leave, WFH, fix and shift change, each through the
     * real path, the service and the preview endpoint, all agree.
     */
    private void assertAllAgree(Employee applicant) {
        for (Kind kind : List.of(Kind.LEAVE, Kind.WFH)) {
            Object real = kind == Kind.LEAVE ? leavePick(applicant) : wfhPick(applicant);
            Object mine;
            try {
                mine = chain.requestApprover(applicant, kind).approverId();
            } catch (BusinessRuleException refused) {
                mine = refused.getErrorCode();
            }
            assertEquals(real, mine, kind + ": the service must pick what apply picks");
            MyApproversController.Approver shown = preview(applicant, kind.key).approver();
            if (real instanceof UUID id) {
                assertNotNull(shown, kind + ": the preview names someone");
                assertEquals(id.toString(), shown.employeeId(), kind + ": the preview names the person apply picks");
            } else {
                assertNull(shown, kind + ": nobody to name when apply would refuse (" + real + ")");
            }
        }
        for (boolean shift : List.of(false, true)) {
            UUID real = notifiedFor(applicant, shift);
            Choice mine = chain.notificationApprover(applicant);
            assertEquals(real, mine == null ? null : mine.approverId(), (shift ? "shift" : "fix") + ": the person notified");
            MyApproversController.Approver shown = preview(applicant, shift ? "shift" : "correction").approver();
            assertEquals(real == null ? null : real.toString(), shown == null ? null : shown.employeeId());
        }
    }

    // ── fixtures ─────────────────────────────────────────────────────────────

    @Test void theReportingManagerComesFirst() {
        Employee boss = person("Siddharth", EmploymentStatus.ACTIVE);
        Employee head = person("Meera", EmploymentStatus.ACTIVE);
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        me.setManagerId(boss.getId());
        me.setDepartmentId(department(head).getId());
        assertAllAgree(me);
        assertEquals(Source.MANAGER, chain.requestApprover(me, Kind.LEAVE).source());
        assertEquals("Siddharth Rao", preview(me, "leave").approver().name());
        assertEquals("MANAGER", preview(me, "wfh").approver().source());
        assertEquals(Source.MANAGER, chain.notificationApprover(me).source());
    }

    @Test void withoutAManagerTheDepartmentHead() {
        Employee head = person("Meera", EmploymentStatus.ACTIVE);
        Employee me = person("Kavya", EmploymentStatus.PROBATION);
        me.setDepartmentId(department(head).getId());
        assertAllAgree(me);
        assertEquals(Source.DEPARTMENT_HEAD, chain.requestApprover(me, Kind.WFH).source());
        assertEquals(Source.DEPARTMENT_HEAD, chain.notificationApprover(me).source());
    }

    @Test void withNeitherTheFirstHrManager() {
        Employee hr = person("Anita", EmploymentStatus.ACTIVE);
        terminal = hr.getId(); firstHr = hr.getId(); hrHolders.add(hr.getId());
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        me.setDepartmentId(department(null).getId());
        assertAllAgree(me);
        assertEquals(Source.HR, chain.requestApprover(me, Kind.LEAVE).source());
        assertEquals("HR", preview(me, "correction").approver().source());
    }

    @Test void withNoHrManagerTheAdmin() {
        Employee admin = person("Owner", EmploymentStatus.ACTIVE);
        terminal = admin.getId(); firstAdmin = admin.getId();
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        assertAllAgree(me);
        assertEquals(Source.ADMIN, chain.requestApprover(me, Kind.WFH).source());
        assertEquals(Source.ADMIN, chain.notificationApprover(me).source());
    }

    @Test void aManagerWhoLeftIsSkippedForTheTerminalFallbackNotTheHead() {
        Employee gone = person("Rahul", EmploymentStatus.EXITED);
        Employee head = person("Meera", EmploymentStatus.ACTIVE);
        Employee hr = person("Anita", EmploymentStatus.ACTIVE);
        terminal = hr.getId(); firstHr = hr.getId(); hrHolders.add(hr.getId());
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        me.setManagerId(gone.getId());
        me.setDepartmentId(department(head).getId());
        assertAllAgree(me);
        assertEquals(hr.getId(), chain.requestApprover(me, Kind.LEAVE).approverId());
        // Fixes keep notifying the manager on record, exactly as DomainEventListener does today.
        assertEquals(gone.getId(), chain.notificationApprover(me).approverId());
    }

    @Test void aManagerFromAnotherWorkspaceIsSkipped() {
        Employee stranger = person("Other", EmploymentStatus.ACTIVE);
        stranger.setTenantId(OTHER_TENANT);
        Employee admin = person("Owner", EmploymentStatus.ACTIVE);
        terminal = admin.getId(); firstAdmin = admin.getId();
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        me.setManagerId(stranger.getId());
        assertAllAgree(me);
        assertEquals(Source.ADMIN, chain.requestApprover(me, Kind.WFH).source());
    }

    @Test void aSuspendedFallbackIsRefusedLikeApply() {
        Employee gone = person("Rahul", EmploymentStatus.RESIGNED);
        Employee hr = person("Anita", EmploymentStatus.SUSPENDED);
        terminal = hr.getId();
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        me.setManagerId(gone.getId());
        assertAllAgree(me);
        BusinessRuleException refused = assertThrows(BusinessRuleException.class, () -> chain.requestApprover(me, Kind.LEAVE));
        assertEquals("APPROVER_INVALID", refused.getErrorCode());
    }

    @Test void nobodyAtAllIsRefusedAndThePreviewNamesNobody() {
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        assertAllAgree(me);
        BusinessRuleException leave = assertThrows(BusinessRuleException.class, () -> chain.requestApprover(me, Kind.LEAVE));
        assertEquals("NO_APPROVER_AVAILABLE", leave.getErrorCode());
        assertTrue(leave.getMessage().endsWith("before applying for leave"));
        assertTrue(assertThrows(BusinessRuleException.class, () -> chain.requestApprover(me, Kind.WFH)).getMessage()
                .endsWith("before applying for WFH"));
        assertNull(preview(me, "leave").approver());
        assertEquals("leave", preview(me, "leave").kind());
    }

    @Test void anActiveDelegationRedirectsAndNamesWhoTheyStandInFor() {
        Employee boss = person("Siddharth", EmploymentStatus.ACTIVE);
        Employee cover = person("Alice", EmploymentStatus.ACTIVE);
        delegations.put(boss.getId(), cover.getId());
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        me.setManagerId(boss.getId());
        assertAllAgree(me);
        Choice c = chain.requestApprover(me, Kind.LEAVE);
        assertEquals(Source.DELEGATE, c.source());
        assertEquals(cover.getId(), c.approverId());
        assertEquals(boss.getId(), c.delegateForId());
        MyApproversController.Approver shown = preview(me, "wfh").approver();
        assertEquals("DELEGATE", shown.source());
        assertEquals("Siddharth Rao", shown.delegateForName());
        // Delegations don't apply to the fix notification today, and the preview says so.
        assertEquals(boss.getId(), chain.notificationApprover(me).approverId());
    }

    @Test void theFixChainNeverNamesThePersonThemself() {
        Employee me = person("Anita", EmploymentStatus.ACTIVE);
        firstHr = me.getId(); hrHolders.add(me.getId()); terminal = me.getId();
        Employee admin = person("Owner", EmploymentStatus.ACTIVE);
        firstAdmin = admin.getId();
        assertAllAgree(me);
        assertEquals(admin.getId(), chain.notificationApprover(me).approverId());
        // Leave and WFH go to someone else too (audit 5 Oct 2026: nobody may decide their own).
        nextTerminal = admin.getId();
        assertAllAgree(me);
        assertEquals(admin.getId(), chain.requestApprover(me, Kind.LEAVE).approverId());
        assertEquals(admin.getId(), leavePick(me));
        assertEquals(admin.getId(), wfhPick(me));
    }

    @Test void aDepartmentHeadsOwnRequestGoesOnToHrNotToThemself() {
        Employee me = person("Meera", EmploymentStatus.ACTIVE);
        me.setDepartmentId(department(me).getId());
        Employee hr = person("Anita", EmploymentStatus.ACTIVE);
        terminal = hr.getId(); firstHr = hr.getId(); hrHolders.add(hr.getId());
        assertAllAgree(me);
        assertEquals(hr.getId(), leavePick(me));
        assertEquals(hr.getId(), wfhPick(me));
        assertEquals(Source.HR, chain.requestApprover(me, Kind.LEAVE).source());
    }

    @Test void theOnlyAdminStillGetsTheirOwnRequestAsBefore() {
        // Nobody else in the workspace: the request still goes somewhere (to them), never refused.
        Employee me = person("Owner", EmploymentStatus.ACTIVE);
        terminal = me.getId(); firstAdmin = me.getId();
        assertAllAgree(me);
        assertEquals(me.getId(), leavePick(me));
        assertEquals(me.getId(), chain.requestApprover(me, Kind.WFH).approverId());
    }

    @Test void theWholeMatrixAgrees() {
        // Every mix of: manager (none / active / exited), head (none / active / is me), fallback (none / HR / admin), delegation (on / off).
        int checked = 0;
        for (int manager = 0; manager < 3; manager++) for (int head = 0; head < 3; head++)
            for (int fb = 0; fb < 3; fb++) for (int deleg = 0; deleg < 2; deleg++) {
                people.clear(); depts.clear(); delegations.clear(); hrHolders.clear();
                terminal = null; nextTerminal = null; firstHr = null; firstAdmin = null;
                Employee me = person("Kavya", EmploymentStatus.ACTIVE);
                if (manager > 0) me.setManagerId(person("Boss", manager == 1 ? EmploymentStatus.ACTIVE : EmploymentStatus.EXITED).getId());
                if (head > 0) me.setDepartmentId(department(head == 1 ? person("Head", EmploymentStatus.ACTIVE) : me).getId());
                if (fb == 1) { Employee hr = person("Hr", EmploymentStatus.ACTIVE); terminal = hr.getId(); firstHr = hr.getId(); hrHolders.add(hr.getId()); }
                if (fb == 2) { Employee ad = person("Admin", EmploymentStatus.ACTIVE); terminal = ad.getId(); firstAdmin = ad.getId(); }
                if (deleg == 1) {
                    Employee cover = person("Cover", EmploymentStatus.ACTIVE);
                    for (UUID id : List.copyOf(people.keySet())) if (!id.equals(cover.getId())) delegations.put(id, cover.getId());
                }
                assertAllAgree(me);
                checked++;
            }
        assertEquals(54, checked);
    }

    @Test void anUnknownKindIsABadRequest() {
        Employee me = person("Kavya", EmploymentStatus.ACTIVE);
        com.hrms.core.exception.HrmsException e = assertThrows(com.hrms.core.exception.HrmsException.class, () -> preview(me, "expense"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("INVALID_PARAMETER", e.getErrorCode());
        assertEquals(Kind.SHIFT, Kind.of(" Shift "));
    }

    @Test void someoneWithoutAnEmployeeRecordGetsNobody() {
        Jwt stranger = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("tenant_id", TENANT.toString()).build();
        MyApproversController.ApproverPreview p = new MyApproversController(chain, employees).preview("wfh", stranger);
        assertEquals("wfh", p.kind());
        assertNull(p.approver());
    }
}
