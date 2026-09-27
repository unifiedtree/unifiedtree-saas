package com.hrms.api.wfh;

import com.hrms.api.ess.ApproverChainService;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.leave.dto.WfhBatchRequest;
import com.hrms.leave.dto.WfhRequestResponse;
import com.hrms.leave.entity.WfhRequest;
import com.hrms.leave.repository.WfhRequestRepository;
import com.hrms.leave.service.WfhService;
import com.unifiedtree.notifications.events.WfhRequestSubmittedEvent;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * BW-35: several separate days from home in one send. Each run of consecutive
 * days becomes one request, all in one transaction, overlaps are refused before
 * anything is saved, and the approver is told once.
 */
class WfhBatchTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final LocalDate MON = LocalDate.now().plusDays(7).with(java.time.DayOfWeek.MONDAY).plusWeeks(1);

    private WfhRequestRepository repository;
    private ApplicationEventPublisher events;
    private WfhService service;
    private final List<WfhRequest> saved = new ArrayList<>();

    @BeforeEach
    void wire() {
        TenantContext.setTenantId(TENANT);
        repository = mock(WfhRequestRepository.class);
        events = mock(ApplicationEventPublisher.class);
        when(repository.save(any())).thenAnswer(i -> {
            WfhRequest w = i.getArgument(0);
            w.setId(UUID.randomUUID());
            saved.add(w);
            return w;
        });
        when(repository.findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(any(), any(), any(), any()))
                .thenReturn(List.of());
        service = new WfhService(repository, events);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    private static List<LocalDate> days(int... offsets) {
        List<LocalDate> out = new ArrayList<>();
        for (int o : offsets) out.add(MON.plusDays(o));
        return out;
    }

    @Test void separateDaysBecomeOneRequestPerRunWithOneApprover() {
        UUID me = UUID.randomUUID(), boss = UUID.randomUUID();
        // Mon, Tue (a run), Fri, and Tue again (a repeat), out of order.
        List<WfhRequestResponse> out = service.applyBatch(me, days(4, 0, 1, 1), "Plumber visit", boss);
        assertEquals(2, out.size());
        assertEquals(MON, out.get(0).fromDate());
        assertEquals(MON.plusDays(1), out.get(0).toDate());
        assertEquals(MON.plusDays(4), out.get(1).fromDate());
        assertEquals(MON.plusDays(4), out.get(1).toDate());
        for (WfhRequest w : saved) {
            assertEquals(boss, w.getApproverId());
            assertEquals(ApprovalStatus.PENDING, w.getStatus());
            assertEquals(TENANT, w.getTenantId());
            assertEquals(me, w.getEmployeeId());
            assertEquals("Plumber visit", w.getReason());
        }
    }

    @Test void theApproverIsToldOnceForTheWholeBatch() {
        UUID me = UUID.randomUUID(), boss = UUID.randomUUID();
        service.applyBatch(me, days(0, 2, 4), "Renovation at home", boss);
        ArgumentCaptor<Object> published = ArgumentCaptor.forClass(Object.class);
        verify(events, times(1)).publishEvent(published.capture());
        WfhService.BatchSubmitted e = assertInstanceOf(WfhService.BatchSubmitted.class, published.getValue());
        assertEquals(3, e.requestIds().size());
        assertEquals(boss, e.approverId());
        assertEquals(TENANT, e.tenantId());
        assertEquals(3, e.runs().size());

        // The listener sends exactly one "wfh.submitted" message to the approver, listing every day.
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        NotificationLookupService lookup = mock(NotificationLookupService.class);
        when(lookup.employeeName(me, TENANT)).thenReturn("Kavya Menon");
        new WfhBatchNotificationListener(dispatcher, lookup).onBatchSubmitted(e);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher, times(1)).dispatch(eq(TENANT), eq(boss), eq("wfh.submitted"), values.capture(), data.capture());
        assertEquals("Kavya Menon", values.getValue().get("employeeName"));
        assertTrue(values.getValue().get("dates").startsWith("on 3 days: "), values.getValue().get("dates"));
        assertEquals(e.requestIds().get(0).toString(), data.getValue().get("wfhRequestId"));
        assertEquals("WFH_SUBMITTED", data.getValue().get("type"));
        assertEquals("/requests-tab", data.getValue().get("route"));
    }

    @Test void oneRunIsAnnouncedExactlyLikeASingleRequest() {
        UUID me = UUID.randomUUID(), boss = UUID.randomUUID();
        service.applyBatch(me, days(0, 1, 2), null, boss);
        ArgumentCaptor<Object> published = ArgumentCaptor.forClass(Object.class);
        verify(events, times(1)).publishEvent(published.capture());
        WfhRequestSubmittedEvent single = assertInstanceOf(WfhRequestSubmittedEvent.class, published.getValue());
        assertEquals(MON, single.fromDate());
        assertEquals(MON.plusDays(2), single.toDate());
        assertEquals(boss, single.approverId());
    }

    @Test void anOverlapIsRefusedBeforeAnythingIsSaved() {
        UUID me = UUID.randomUUID();
        WfhRequest existing = new WfhRequest();
        existing.setFromDate(MON.plusDays(4));
        existing.setToDate(MON.plusDays(4));
        when(repository.findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(
                eq(me), any(), eq(MON.plusDays(4)), eq(MON.plusDays(4)))).thenReturn(List.of(existing));
        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> service.applyBatch(me, days(0, 4), "x", UUID.randomUUID()));
        assertEquals("WFH_OVERLAP", e.getErrorCode());
        assertTrue(e.getMessage().contains(WfhService.describe(new LocalDate[] {MON.plusDays(4), MON.plusDays(4)})), e.getMessage());
        verify(repository, never()).save(any());
        verify(events, never()).publishEvent(any());
    }

    @Test void theOverlapCheckIsTheSingleRequestsForEachRun() {
        UUID me = UUID.randomUUID();
        service.applyBatch(me, days(0, 1, 4), "x", UUID.randomUUID());
        @SuppressWarnings("unchecked") ArgumentCaptor<Collection<ApprovalStatus>> statuses = ArgumentCaptor.forClass(Collection.class);
        verify(repository).findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(
                eq(me), statuses.capture(), eq(MON.plusDays(1)), eq(MON));
        verify(repository).findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(
                eq(me), any(), eq(MON.plusDays(4)), eq(MON.plusDays(4)));
        assertEquals(List.of(ApprovalStatus.PENDING, ApprovalStatus.APPROVED), List.copyOf(statuses.getValue()));
    }

    @Test void theRulesOfTheSingleRequestHold() {
        UUID me = UUID.randomUUID();
        assertEquals("INVALID_DATES", assertThrows(BusinessRuleException.class,
                () -> service.applyBatch(me, List.of(), "x", UUID.randomUUID())).getErrorCode());
        assertEquals("NO_APPROVER_AVAILABLE", assertThrows(BusinessRuleException.class,
                () -> service.applyBatch(me, days(0), "x", null)).getErrorCode());
        assertEquals("WFH_START_TOO_FAR", assertThrows(BusinessRuleException.class,
                () -> service.applyBatch(me, List.of(LocalDate.now().plusDays(400)), "x", UUID.randomUUID())).getErrorCode());
        List<LocalDate> tooMany = new ArrayList<>();
        for (int i = 0; i < 32; i++) tooMany.add(MON.plusDays(2L * i));
        assertEquals("WFH_TOO_MANY_DAYS", assertThrows(BusinessRuleException.class,
                () -> service.applyBatch(me, tooMany, "x", UUID.randomUUID())).getErrorCode());
        verify(repository, never()).save(any());
    }

    @Test void itIsOneTransactionAndOneLockPerPerson() throws Exception {
        Transactional tx = WfhService.class.getMethod("applyBatch", UUID.class, Collection.class, String.class, UUID.class)
                .getAnnotation(Transactional.class);
        assertNotNull(tx, "all the days are saved or none");
        assertFalse(tx.readOnly());
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ReflectionTestUtils.invokeMethod(service, "setJdbcTemplate", jdbc);
        UUID me = UUID.randomUUID();
        service.applyBatch(me, days(0), "x", UUID.randomUUID());
        verify(jdbc).query(contains("pg_advisory_xact_lock"), any(ResultSetExtractor.class), eq("wfh-batch:" + me));
    }

    @Test void runsAreConsecutiveCalendarDays() {
        List<LocalDate[]> runs = WfhService.runsOf(days(0, 1, 2, 4, 7, 8));
        assertEquals(3, runs.size());
        assertArrayEquals(new LocalDate[] {MON, MON.plusDays(2)}, runs.get(0));
        assertArrayEquals(new LocalDate[] {MON.plusDays(4), MON.plusDays(4)}, runs.get(1));
        assertArrayEquals(new LocalDate[] {MON.plusDays(7), MON.plusDays(8)}, runs.get(2));
        assertTrue(WfhService.runsOf(List.of()).isEmpty());
    }

    @Test void theDatesReadNaturally() {
        LocalDate d = LocalDate.of(2026, 9, 30);
        assertEquals("on 1 day: 30 Sep 2026", WfhBatchNotificationListener.dates(List.<LocalDate[]>of(new LocalDate[] {d, d})));
        assertEquals("on 4 days: 30 Sep 2026 to 2 Oct 2026 and 5 Oct 2026",
                WfhBatchNotificationListener.dates(List.of(new LocalDate[] {d, d.plusDays(2)}, new LocalDate[] {d.plusDays(5), d.plusDays(5)})));
        assertEquals("on 3 days: 30 Sep 2026, 2 Oct 2026 and 5 Oct 2026",
                WfhBatchNotificationListener.dates(List.of(new LocalDate[] {d, d}, new LocalDate[] {d.plusDays(2), d.plusDays(2)},
                        new LocalDate[] {d.plusDays(5), d.plusDays(5)})));
    }

    // ── the endpoint ─────────────────────────────────────────────────────────

    @Test void theEndpointSendsToTheSameApproverASingleRequestGetsAndNamesThem() {
        EmployeeRepository employees = mock(EmployeeRepository.class);
        Employee me = new Employee(), boss = new Employee();
        me.setId(UUID.randomUUID()); me.setTenantId(TENANT); me.setFirstName("Kavya"); me.setLastName("Menon");
        boss.setId(UUID.randomUUID()); boss.setTenantId(TENANT); boss.setFirstName("Siddharth"); boss.setLastName("Rao");
        boss.setEmploymentStatus(EmploymentStatus.ACTIVE);
        me.setManagerId(boss.getId());
        when(employees.findById(me.getId())).thenReturn(Optional.of(me));
        when(employees.findById(boss.getId())).thenReturn(Optional.of(boss));
        when(employees.findAllById(any())).thenReturn(List.of(me, boss));
        ApproverFallbackResolver fallback = mock(ApproverFallbackResolver.class);
        when(fallback.redirectIfDelegated(any(), any())).thenAnswer(i -> i.getArgument(0));
        WorkforceDepartmentRepository departments = mock(WorkforceDepartmentRepository.class);
        ApproverChainService chain = new ApproverChainService(employees, departments, fallback,
                mock(NotificationLookupService.class), mock(JdbcTemplate.class));
        WfhController controller = new WfhController(service, employees, departments, fallback);
        ReflectionTestUtils.setField(controller, "approverChain", chain);
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.getId().toString()).build();

        ResponseEntity<WfhController.BatchResult> r = controller.applyBatch(new WfhBatchRequest(days(0, 2, 2), "Home repairs"), jwt);
        assertEquals(201, r.getStatusCode().value());
        assertEquals(2, r.getBody().days());
        assertEquals(2, r.getBody().requests().size());
        for (WfhRequestResponse row : r.getBody().requests()) {
            assertEquals(boss.getId(), row.approverId());
            assertEquals("Siddharth Rao", row.approverName());
            assertEquals("Kavya Menon", row.employeeName());
        }
    }
}
