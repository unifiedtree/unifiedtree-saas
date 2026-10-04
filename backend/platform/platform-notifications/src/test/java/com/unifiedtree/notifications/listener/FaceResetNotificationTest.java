package com.unifiedtree.notifications.listener;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.events.FaceEnrollmentResetEvent;
import com.unifiedtree.notifications.service.AppNotificationService;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.service.NotificationLookupService;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import com.unifiedtree.notifications.template.TemplateRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * HR reset someone's face: the person is told on the bell and the phone, and
 * the phone's tap opens face enrollment with the reset explained.
 */
class FaceResetNotificationTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID EMPLOYEE = UUID.randomUUID();
    private static final UUID HR = UUID.randomUUID();

    private NotificationLookupService lookup;
    private NotificationDispatcher dispatcher;
    private DomainEventListener listener;

    @BeforeEach
    void setUp() {
        lookup = mock(NotificationLookupService.class);
        dispatcher = mock(NotificationDispatcher.class);
        listener = new DomainEventListener(mock(AppNotificationService.class), lookup, dispatcher);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private Map<String, String>[] sent() {
        ArgumentCaptor<Map> values = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(TENANT), eq(EMPLOYEE), eq("attendance.face_reset"), values.capture(), data.capture());
        Map<String, Object> d = data.getValue();
        return new Map[]{values.getValue(), Map.of("type", String.valueOf(d.get("type")), "route", String.valueOf(d.get("route")))};
    }

    private static String body(Map<String, String> values) {
        EventDef def = NotificationEventCatalog.byKey("attendance.face_reset").orElseThrow();
        return TemplateRenderer.render(def.defaultBody(), values).strip();
    }

    @Test
    void tellsThePersonWhoResetItAndOpensReEnrollmentOnThePhone() {
        when(lookup.employeeName(HR, TENANT)).thenReturn("Priya Rao");
        listener.onFaceEnrollmentReset(new FaceEnrollmentResetEvent(TENANT, EMPLOYEE, HR, null));

        Map<String, String>[] s = sent();
        assertEquals(AppNotificationType.FACE_ENROLLMENT_RESET.name(), s[1].get("type"));
        assertEquals("/face-enroll?reason=reset", s[1].get("route"));
        assertEquals("Your face enrolment was reset by Priya Rao, so face punch-in is off until you enrol again. It takes about a minute.",
                body(s[0]));
    }

    @Test
    void aGivenReasonIsShown() {
        when(lookup.employeeName(HR, TENANT)).thenReturn("Priya Rao");
        listener.onFaceEnrollmentReset(new FaceEnrollmentResetEvent(TENANT, EMPLOYEE, HR, "New glasses"));
        assertEquals("Your face enrolment was reset by Priya Rao, so face punch-in is off until you enrol again. It takes about a minute. Reason: New glasses",
                body(sent()[0]));
    }

    @Test
    void notSaidByAnyoneWhenUnknownOrTheirOwn() {
        when(lookup.employeeName(HR, TENANT)).thenReturn(null);
        listener.onFaceEnrollmentReset(new FaceEnrollmentResetEvent(TENANT, EMPLOYEE, HR, null));
        String unknown = body(sent()[0]);
        assertFalse(unknown.contains(" by "), unknown);

        setUp();
        listener.onFaceEnrollmentReset(new FaceEnrollmentResetEvent(TENANT, EMPLOYEE, EMPLOYEE, null));
        String own = body(sent()[0]);
        assertEquals("Your face enrolment was reset, so face punch-in is off until you enrol again. It takes about a minute.", own);
        verify(lookup, never()).employeeName(eq(EMPLOYEE), any());
    }

    @Test
    void noRecipientSendsNothing() {
        listener.onFaceEnrollmentReset(new FaceEnrollmentResetEvent(TENANT, null, HR, null));
        verify(dispatcher, never()).dispatch(any(), any(), anyString(), anyMap(), anyMap());
    }

    @Test
    void aDispatchFailureIsSwallowed() {
        when(dispatcher.dispatch(any(), any(), anyString(), anyMap(), anyMap())).thenThrow(new RuntimeException("push down"));
        listener.onFaceEnrollmentReset(new FaceEnrollmentResetEvent(TENANT, EMPLOYEE, null, null));
        verify(dispatcher).dispatch(eq(TENANT), eq(EMPLOYEE), eq("attendance.face_reset"), anyMap(), anyMap());
    }
}
