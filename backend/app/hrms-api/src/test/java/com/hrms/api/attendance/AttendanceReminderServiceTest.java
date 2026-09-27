package com.hrms.api.attendance;

import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** "Send a reminder": today only, the caller's team only, and who is never reminded. */
class AttendanceReminderServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();
    private TeamEmployeeScope scope;
    private NotificationDispatcher dispatcher;
    private NotificationPreferenceService prefs;
    private AttendanceReminderService service;
    private Jwt jwt;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        scope = mock(TeamEmployeeScope.class);
        dispatcher = mock(NotificationDispatcher.class);
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        service = new AttendanceReminderService(scope, mock(JdbcTemplate.class), dispatcher,
                prefs = mock(NotificationPreferenceService.class), mock(AuditService.class), tm);
        jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).claim("permissions", List.of("attendance.team.read")).build();
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private static LocalDate today() {
        return LocalDate.now(ZoneId.of("Asia/Kolkata"));
    }

    @Test void onlyTodayAndOnlyTheKnownReason() {
        UUID someone = UUID.randomUUID();
        HrmsException past = assertThrows(HrmsException.class, () -> service.send(
                new AttendanceReminderService.SendRemindersRequest(today().minusDays(1), "NOT_CHECKED_IN", List.of(someone)), jwt));
        assertEquals("REMINDER_DATE_NOT_TODAY", past.getErrorCode());
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, past.getStatus());
        assertEquals("REMINDER_REASON_INVALID", assertThrows(HrmsException.class, () -> service.send(
                new AttendanceReminderService.SendRemindersRequest(today(), "LATE", List.of(someone)), jwt)).getErrorCode());
        assertEquals("REMINDER_PEOPLE_INVALID", assertThrows(HrmsException.class, () -> service.send(
                new AttendanceReminderService.SendRemindersRequest(today(), "NOT_CHECKED_IN", List.of()), jwt)).getErrorCode());
        List<UUID> tooMany = java.util.stream.IntStream.range(0, 201).mapToObj(i -> UUID.randomUUID()).toList();
        assertEquals("REMINDER_PEOPLE_INVALID", assertThrows(HrmsException.class, () -> service.send(
                new AttendanceReminderService.SendRemindersRequest(today(), "NOT_CHECKED_IN", tooMany), jwt)).getErrorCode());
        verifyNoInteractions(dispatcher);
    }

    @Test void peopleOutsideTheCallersTeamAreSkippedAndNeverNotified() {
        Employee member = new Employee();
        member.setId(UUID.randomUUID());
        when(scope.resolve(jwt, null)).thenReturn(List.of(member));
        UUID outsider = UUID.randomUUID();
        var results = service.send(new AttendanceReminderService.SendRemindersRequest(today(), "NOT_CHECKED_IN",
                List.of(outsider, outsider)), jwt);
        assertEquals(1, results.size()); // duplicates collapse
        assertEquals("SKIPPED", results.get(0).outcome());
        assertEquals("Not in your team.", results.get(0).message());
        verifyNoInteractions(dispatcher);
    }

    @Test void noOneWithoutALoginOrWhoIsInOrAwayIsReminded() {
        assertEquals("They don't have a login yet.", AttendanceReminderService.skipReason(false, false, false, false, false));
        assertEquals("Already checked in.", AttendanceReminderService.skipReason(true, true, false, false, false));
        assertEquals("On leave today.", AttendanceReminderService.skipReason(true, false, true, false, false));
        assertEquals("It's their weekly off.", AttendanceReminderService.skipReason(true, false, false, true, false));
        assertEquals("It's a holiday.", AttendanceReminderService.skipReason(true, false, false, false, true));
        assertNull(AttendanceReminderService.skipReason(true, false, false, false, false));
    }

    @Test void atMostOncePerPersonDayAndReason() {
        UUID member = UUID.randomUUID();
        LocalDate day = today();
        AttendanceReminderService spy = spy(service);
        doReturn(new AttendanceReminderService.PersonFacts(true, false, false, false, false)).when(spy).facts(tenant, member, day);
        // nobody reminded yet: sent (and the in-app row / audit event it writes is what the next check finds)
        doReturn(java.util.Map.of()).when(spy).sentFor(eq(tenant), any(), eq(day), eq("NOT_CHECKED_IN"));
        when(prefs.recipient(tenant, member)).thenReturn(new NotificationPreferenceService.Recipient(
                UUID.randomUUID(), "m@example.invalid", null, java.util.Map.of()));
        var first = spy.sendOne(tenant, member, day, "NOT_CHECKED_IN", me, "Priya Rao");
        assertEquals("SENT", first.outcome());
        verify(dispatcher).dispatch(eq(tenant), eq(member), eq("attendance.checkin_reminder"), any(), any());

        // someone reminded them already: not sent again
        doReturn(java.util.Map.of(member, new AttendanceReminderService.SentReminder(member, "NOT_CHECKED_IN",
                java.time.Instant.now(), "Priya Rao"))).when(spy).sentFor(eq(tenant), any(), eq(day), eq("NOT_CHECKED_IN"));
        var second = spy.sendOne(tenant, member, day, "NOT_CHECKED_IN", me, "Hari Nair");
        assertEquals("ALREADY_SENT", second.outcome());
        assertEquals("Already reminded today by Priya Rao.", second.message());
        verify(dispatcher, times(1)).dispatch(any(), any(), any(), any(), any());
    }

    @Test void someoneWhoCheckedInIsNotReminded() {
        UUID member = UUID.randomUUID();
        AttendanceReminderService spy = spy(service);
        doReturn(new AttendanceReminderService.PersonFacts(true, true, false, false, false)).when(spy).facts(any(), any(), any());
        assertEquals("SKIPPED", spy.sendOne(tenant, member, today(), "NOT_CHECKED_IN", me, "Priya Rao").outcome());
        verifyNoInteractions(dispatcher);
    }

    @Test void theThrottleMarkerNamesTheDayAndReason() {
        assertEquals("[checkin-reminder 2026-09-27 NOT_CHECKED_IN]",
                AttendanceReminderService.marker(LocalDate.of(2026, 9, 27), "NOT_CHECKED_IN"));
    }
}
