package com.hrms.api.attendance;

import com.hrms.api.attendance.PunchAlertSettingsService.Rules;
import com.hrms.attendance.dto.PunchInRecordedEvent;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The punch-in alert sender (V143.72): who it reaches, what it carries, and
 * that nothing about it can fail, slow or undo the punch.
 */
class PunchAlertNotifierTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID EMP = UUID.randomUUID();
    private static final UUID MANAGER = UUID.randomUUID();
    private static final UUID RECORD = UUID.randomUUID();
    private static final double HQ_LAT = 17.385040, HQ_LNG = 78.486670;

    private PunchAlertSettingsService settings;
    private PunchAlertFacts facts;
    private NotificationDispatcher dispatcher;
    private PunchAlertNotifier notifier;

    @BeforeEach void setUp() {
        settings = mock(PunchAlertSettingsService.class);
        facts = mock(PunchAlertFacts.class);
        dispatcher = mock(NotificationDispatcher.class);
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        // Run the background work right here, so the test can see it.
        notifier = new PunchAlertNotifier(settings, facts, dispatcher, mock(JdbcTemplate.class), tm, Runnable::run);
        when(facts.person(TENANT, EMP)).thenReturn(new PunchAlertFacts.Person("Priya Rao", COMPANY, null, null, MANAGER));
        when(facts.places(eq(TENANT), eq(COMPANY), any(), any()))
                .thenReturn(List.of(new PunchAlerts.Place("Head Office", HQ_LAT, HQ_LNG, 100, true)));
        when(facts.candidates(eq(TENANT), eq(List.of(MANAGER)))).thenReturn(List.of(new PunchAlerts.Candidate(MANAGER, COMPANY, true, true)));
        when(settings.rulesFor(TENANT, COMPANY)).thenReturn(Optional.of(Rules.defaults()));
    }

    @AfterEach void tearDown() {
        com.unifiedtree.security.tenant.TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private static PunchInRecordedEvent punch(double lat, double lng, boolean late) {
        return new PunchInRecordedEvent(TENANT, RECORD, EMP, COMPANY, LocalDate.of(2026, 10, 5),
                Instant.parse("2026-10-05T04:12:00Z"), "FACE_RECOGNITION", lat, lng, 15.0, late, late ? 12 : 0,
                false, false, Instant.parse("2026-10-05T04:12:02Z"));
    }

    @SuppressWarnings("unchecked")
    @Test void theManagerIsToldWhenHowAndWhereWithAMapLink() {
        notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, true));

        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(TENANT), eq(MANAGER), eq("attendance.punch_in_alert"), values.capture(), data.capture());
        assertEquals("Priya Rao", values.getValue().get("employeeName"));
        assertEquals("9:42 am", values.getValue().get("time"));
        assertEquals("At Head Office", values.getValue().get("place"));
        assertEquals(" · 12 min late", values.getValue().get("lateText"));
        assertEquals("https://www.google.com/maps?q=17.385040,78.486670", data.getValue().get("mapUrl"));
        assertEquals("PUNCH_IN_ALERT", data.getValue().get("type"));
        assertEquals(RECORD.toString(), data.getValue().get("attendanceRecordId"));
    }

    @Test void theTenantIsBoundOnTheAlertThreadAndClearedAfter() {
        AtomicReference<UUID> seen = new AtomicReference<>();
        when(dispatcher.dispatch(any(), any(), any(), any(), any())).thenAnswer(inv -> {
            seen.set(com.unifiedtree.security.tenant.TenantContext.getTenantId());
            return null;
        });
        notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, false));
        assertEquals(TENANT, seen.get());
        assertNull(com.unifiedtree.security.tenant.TenantContext.getTenantId());
        assertNull(com.hrms.core.tenant.TenantContext.getTenantId());
    }

    @Test void oneFailedRecipientNeverStopsTheOthers() {
        UUID hr = UUID.randomUUID();
        when(settings.rulesFor(TENANT, COMPANY)).thenReturn(Optional.of(new Rules(true, List.of(hr), List.of(), "ALL")));
        when(facts.candidates(eq(TENANT), eq(List.of(hr)))).thenReturn(List.of(new PunchAlerts.Candidate(hr, COMPANY, true, true)));
        when(dispatcher.dispatch(any(), eq(MANAGER), any(), any(), any())).thenThrow(new RuntimeException("push service down"));

        assertEquals(1, notifier.send(punch(HQ_LAT, HQ_LNG, false)));
        verify(dispatcher).dispatch(eq(TENANT), eq(hr), any(), any(), any());
    }

    @Test void aFailureWhileWorkingItOutIsLoggedNotThrown() {
        when(facts.person(TENANT, EMP)).thenThrow(new RuntimeException("database unavailable"));
        assertDoesNotThrow(() -> notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, false)));
        verifyNoInteractions(dispatcher);
    }

    @Test void aFullQueueDropsTheAlertWithoutFailingThePunch() {
        Executor full = r -> { throw new RejectedExecutionException("queue full"); };
        PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
        PunchAlertNotifier saturated = new PunchAlertNotifier(settings, facts, dispatcher, mock(JdbcTemplate.class), tm, full);
        assertDoesNotThrow(() -> saturated.onPunchIn(punch(HQ_LAT, HQ_LNG, false)));
        verifyNoInteractions(dispatcher);
    }

    @Test void nothingIsSentUntilTheMigrationSwitchesAlertsOn() {
        when(settings.rulesFor(TENANT, COMPANY)).thenReturn(Optional.empty());
        notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, true));
        verifyNoInteractions(dispatcher);
    }

    @Test void lateOrOutsideOnlySkipsAnOnTimePunchInTheOffice() {
        when(settings.rulesFor(TENANT, COMPANY)).thenReturn(Optional.of(new Rules(true, List.of(), List.of(), "LATE_OR_OUTSIDE")));
        notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, false));
        verifyNoInteractions(dispatcher);

        notifier.onPunchIn(punch(HQ_LAT + 0.01, HQ_LNG, false)); // about 1.1 km away
        verify(dispatcher).dispatch(eq(TENANT), eq(MANAGER), any(), argThat(v -> v.get("place").startsWith("Outside office, about 1.1 km")), any());
    }

    @Test void nobodyToTellMeansNoLookupsAndNoAlert() {
        when(settings.rulesFor(TENANT, COMPANY)).thenReturn(Optional.of(new Rules(false, List.of(), List.of(), "ALL")));
        notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, true));
        verify(facts, never()).places(any(), any(), any(), any());
        verifyNoInteractions(dispatcher);
    }

    @Test void neverThePersonWhoPunched() {
        // They manage themself (head of their own department, no reporting manager).
        when(facts.person(TENANT, EMP)).thenReturn(new PunchAlertFacts.Person("Priya Rao", COMPANY, null, null, EMP));
        when(facts.candidates(eq(TENANT), eq(List.of(EMP)))).thenReturn(List.of(new PunchAlerts.Candidate(EMP, COMPANY, true, true)));
        notifier.onPunchIn(punch(HQ_LAT, HQ_LNG, false));
        verifyNoInteractions(dispatcher);
    }

    @Test void anAssistedPunchSaysWhoMadeItAndUsesTheirPhonesAccuracy() {
        when(facts.assisted(TENANT, RECORD)).thenReturn(new PunchAlertFacts.Assisted("Ravi Kumar", 7.6));
        PunchInRecordedEvent e = new PunchInRecordedEvent(TENANT, RECORD, EMP, COMPANY, LocalDate.of(2026, 10, 5),
                Instant.parse("2026-10-05T04:12:00Z"), "FACE_RECOGNITION", HQ_LAT, HQ_LNG, null, false, 0, false, false,
                Instant.parse("2026-10-05T04:12:00Z"));
        notifier.onPunchIn(e);
        verify(dispatcher).dispatch(eq(TENANT), eq(MANAGER), any(),
                argThat(v -> v.get("method").equals("Punched in for them by Ravi Kumar with a face scan")
                        && v.get("coordinates").endsWith("(±8 m)")),
                argThat(d -> Boolean.TRUE.equals(d.get("assisted")) && "Ravi Kumar".equals(d.get("assistedByName"))));
    }

    @Test void theLegacyFacePunchFindsTheCompanyFromThePerson() {
        PunchInRecordedEvent noCompany = new PunchInRecordedEvent(TENANT, RECORD, EMP, null, LocalDate.of(2026, 10, 5),
                Instant.parse("2026-10-05T04:12:00Z"), "FACE_RECOGNITION", HQ_LAT, HQ_LNG, null, false, 0, false, false,
                Instant.parse("2026-10-05T04:12:00Z"));
        notifier.onPunchIn(noCompany);
        verify(settings).rulesFor(TENANT, COMPANY);
        verify(dispatcher).dispatch(eq(TENANT), eq(MANAGER), any(), any(), any());
    }

    @Test void anEventWithoutATenantIsIgnored() {
        assertDoesNotThrow(() -> notifier.onPunchIn(new PunchInRecordedEvent(null, RECORD, EMP, COMPANY, null, null,
                null, null, null, null, false, null, false, false, null)));
        assertDoesNotThrow(() -> notifier.onPunchIn(null));
        verifyNoInteractions(facts, dispatcher);
    }
}
