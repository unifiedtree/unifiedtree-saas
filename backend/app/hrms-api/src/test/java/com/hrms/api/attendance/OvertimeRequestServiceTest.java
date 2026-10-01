package com.hrms.api.attendance;

import com.hrms.api.attendance.OvertimeRequestService.OvertimeRequestResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.notifications.events.OvertimeDecidedEvent;
import com.unifiedtree.notifications.events.OvertimeRequestedEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Overtime requests (DECISIONS 22): who may ask, for what, and who decides. */
class OvertimeRequestServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
    private final OvertimeRules rules = mock(OvertimeRules.class);
    private final OvertimeCap cap = mock(OvertimeCap.class);
    private final List<Object> events = new ArrayList<>();
    private final OvertimeRequestService service = new OvertimeRequestService(jdbc, scope, rules, cap);
    private final UUID employee = UUID.randomUUID();
    private final UUID manager = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    private final LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    @BeforeEach void setUp() {
        TenantContext.setTenantId(TENANT);
        ReflectionTestUtils.setField(service, "events", (ApplicationEventPublisher) events::add);
        when(jdbc.queryForObject(contains("to_regclass('attendance.overtime_requests')"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForList(contains("SELECT company_id FROM hrms.employees"), eq(UUID.class), any(), any())).thenReturn(List.of(company));
        when(rules.forCompany(TENANT, company)).thenReturn(OvertimeRules.Rules.none(company));
        when(jdbc.queryForObject(contains("FROM attendance.records"), eq(Integer.class), any(), any(), any())).thenReturn(0);
        Employee e = new Employee();
        e.setId(employee);
        when(scope.resolve(any(), isNull())).thenReturn(List.of(e));
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private OvertimeRequestResponse row(String status) {
        return new OvertimeRequestResponse(UUID.randomUUID(), employee, "Reader User", "EMP002", today.minusDays(1), 80,
                "Month-end closing", status, null, null, null, Instant.now());
    }

    @SuppressWarnings("unchecked")
    private void stored(OvertimeRequestResponse r) {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(r));
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any())).thenReturn(List.of(r));
    }

    private static Jwt token(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject("s").claim("employee_id", employeeId.toString()).build();
    }

    @Test void anHourAndTwentyIsSavedAndTheApproverIsTold() {
        stored(row("PENDING"));
        OvertimeRequestResponse r = service.create(employee, today.minusDays(1), 80, "  Month-end closing  ");
        assertEquals("PENDING", r.status());
        verify(jdbc).update(contains("INSERT INTO attendance.overtime_requests"), eq(TENANT), any(UUID.class), eq(employee), eq(company),
                eq(today.minusDays(1)), eq(80), eq("Month-end closing"));
        OvertimeRequestedEvent e = (OvertimeRequestedEvent) events.get(0);
        assertEquals(employee, e.employeeId());
        assertEquals(80, e.minutes());
    }

    @Test void underTheOneHourMinimumIsRefused() {
        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today, 45, "Forty five minutes extra"));
        assertEquals("OVERTIME_BELOW_MINIMUM", e.getErrorCode());
        assertTrue(e.getMessage().contains("1h"), e.getMessage());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void aDayWhosePunchesAlreadyCountIsRefused() {
        when(jdbc.queryForObject(contains("FROM attendance.records"), eq(Integer.class), any(), any(), any())).thenReturn(75);
        assertEquals("OVERTIME_ALREADY_RECORDED", assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today.minusDays(1), 90, "Stayed for the release")).getErrorCode());
        // Punches under the minimum don't block asking.
        when(jdbc.queryForObject(contains("FROM attendance.records"), eq(Integer.class), any(), any(), any())).thenReturn(30);
        stored(row("PENDING"));
        service.create(employee, today.minusDays(1), 90, "Stayed for the release");
    }

    @Test void theDayMinutesAndReasonAreChecked() {
        assertEquals("OVERTIME_REQUEST_DATE_INVALID", assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today.minusDays(61), 90, "Too long ago for this")).getErrorCode());
        assertEquals("OVERTIME_REQUEST_DATE_INVALID", assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today.plusDays(31), 90, "Too far ahead for this")).getErrorCode());
        assertEquals("OVERTIME_REQUEST_INVALID", assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today, 1441, "More than a whole day")).getErrorCode());
        assertEquals("OVERTIME_REQUEST_REASON_INVALID", assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today, 90, "short")).getErrorCode());
        // Ahead of time is fine: they can ask before the day.
        stored(row("PENDING"));
        service.create(employee, today.plusDays(30), 90, "Planned release night");
    }

    @Test void twiceForTheSameDayIsRefused() {
        when(jdbc.update(contains("INSERT INTO attendance.overtime_requests"), any(Object[].class)))
                .thenThrow(new DuplicateKeyException("uq_overtime_requests_open_per_day"));
        assertEquals("OVERTIME_REQUEST_EXISTS", assertThrows(BusinessRuleException.class,
                () -> service.create(employee, today, 90, "Stayed for the release")).getErrorCode());
    }

    @Test void withoutTheTableEveryCallIsNotReady() {
        when(jdbc.queryForObject(contains("to_regclass('attendance.overtime_requests')"), eq(Boolean.class))).thenReturn(false);
        assertThrows(FeatureNotReady.class, () -> service.create(employee, today, 90, "Stayed for the release"));
        assertThrows(FeatureNotReady.class, () -> service.mine(employee));
        assertThrows(FeatureNotReady.class, () -> service.team(token(manager), today.minusDays(7), today));
        assertThrows(FeatureNotReady.class, () -> service.decide(token(manager), UUID.randomUUID(), true, null));
        assertThrows(FeatureNotReady.class, () -> service.withdraw(UUID.randomUUID(), employee));
    }

    @Test void theApproverApprovesWithinTheCapAndTheEmployeeIsTold() {
        OvertimeRequestResponse r = row("PENDING");
        stored(r);
        when(jdbc.update(contains("SET status = ?"), any(Object[].class))).thenReturn(1);
        service.decide(token(manager), r.id(), true, null);
        verify(cap).requireWithin(TENANT, employee, r.date(), 80, null, null, r.id());
        verify(jdbc).update(contains("SET status = ?"), eq("APPROVED"), eq(manager), isNull(), eq(TENANT), eq(r.id()));
        OvertimeDecidedEvent e = (OvertimeDecidedEvent) events.get(0);
        assertTrue(e.approved());
        assertEquals(80, e.minutes());
    }

    @Test void aRejectionNeedsANoteAndSkipsTheCap() {
        OvertimeRequestResponse r = row("PENDING");
        stored(r);
        assertEquals("OVERTIME_REASON_REQUIRED", assertThrows(BusinessRuleException.class,
                () -> service.decide(token(manager), r.id(), false, " ")).getErrorCode());
        when(jdbc.update(contains("SET status = ?"), any(Object[].class))).thenReturn(1);
        service.decide(token(manager), r.id(), false, "Not agreed in advance");
        verifyNoInteractions(cap);
    }

    @Test void nobodyDecidesTheirOwnOrOutsideTheirTeamOrTwice() {
        OvertimeRequestResponse r = row("PENDING");
        stored(r);
        assertEquals("SELF_APPROVAL_NOT_ALLOWED", assertThrows(BusinessRuleException.class,
                () -> service.decide(token(employee), r.id(), true, null)).getErrorCode());
        when(scope.resolve(any(), isNull())).thenReturn(List.of());
        assertEquals("OVERTIME_SCOPE_DENIED", assertThrows(BusinessRuleException.class,
                () -> service.decide(token(manager), r.id(), true, null)).getErrorCode());
        Employee e = new Employee();
        e.setId(employee);
        when(scope.resolve(any(), isNull())).thenReturn(List.of(e));
        stored(row("APPROVED"));
        assertEquals("OVERTIME_REQUEST_NOT_PENDING", assertThrows(BusinessRuleException.class,
                () -> service.decide(token(manager), r.id(), true, null)).getErrorCode());
    }

    @Test void theEmployeeWithdrawsOnlyTheirOwnWaitingRequest() {
        OvertimeRequestResponse r = row("PENDING");
        stored(r);
        assertEquals("OVERTIME_REQUEST_NOT_YOURS", assertThrows(BusinessRuleException.class,
                () -> service.withdraw(r.id(), manager)).getErrorCode());
        when(jdbc.update(contains("status = 'CANCELLED'"), any(Object[].class))).thenReturn(0);
        assertEquals("OVERTIME_REQUEST_NOT_PENDING", assertThrows(BusinessRuleException.class,
                () -> service.withdraw(r.id(), employee)).getErrorCode());
        when(jdbc.update(contains("status = 'CANCELLED'"), any(Object[].class))).thenReturn(1);
        service.withdraw(r.id(), employee);
    }

    @Test void thePermissions() throws Exception {
        Class<OvertimeRequestController> c = OvertimeRequestController.class;
        assertEquals("hasAuthority('attendance.checkin.self')", c.getMethod("create", Jwt.class,
                OvertimeRequestController.CreateOvertimeRequest.class).getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAuthority('attendance.checkin.self')", c.getMethod("mine", Jwt.class).getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAuthority('attendance.checkin.self')", c.getMethod("withdraw", Jwt.class, UUID.class).getAnnotation(PreAuthorize.class).value());
        assertEquals("hasAuthority('attendance.team.read')", c.getMethod("team", Jwt.class, LocalDate.class, LocalDate.class).getAnnotation(PreAuthorize.class).value());
        for (String m : new String[]{"approve", "reject"}) {
            assertEquals("hasAuthority('attendance.overtime.approve')", c.getMethod(m, Jwt.class, UUID.class,
                    OvertimeRequestController.DecisionNote.class).getAnnotation(PreAuthorize.class).value());
        }
    }
}
