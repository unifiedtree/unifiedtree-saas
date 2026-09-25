package com.unifiedtree.notifications.service;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService;
import com.unifiedtree.notifications.prefs.NotificationPreferenceService.Recipient;
import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationTemplateLookup;
import com.unifiedtree.notifications.template.NotificationTemplateLookup.TemplateText;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.task.TaskExecutor;

import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NotificationDispatcherTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID EMPLOYEE = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final Map<String, String> VALUES = Map.of("employeeName", "Asha <Rao>", "leaveType", "Casual Leave",
            "startDate", "5 Jul 2026", "endDate", "7 Jul 2026");

    private AppNotificationService notifications;
    private NotificationPreferenceService preferences;
    private NotificationTemplateLookup templates;
    private NotificationMailTransport transport;
    private NotificationDispatcher dispatcher;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        notifications = mock(AppNotificationService.class);
        preferences = mock(NotificationPreferenceService.class);
        templates = mock(NotificationTemplateLookup.class);
        transport = mock(NotificationMailTransport.class);
        ObjectProvider<NotificationMailTransport> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(transport);
        TaskExecutor sameThread = Runnable::run;
        dispatcher = new NotificationDispatcher(notifications, preferences, templates, provider, sameThread);
        when(templates.activeTemplates(any(), any(), any(), any())).thenReturn(new EnumMap<>(DeliveryChannel.class));
    }

    private void prefs(Map<String, Object> p) {
        when(preferences.recipient(TENANT, EMPLOYEE)).thenReturn(new Recipient(UUID.randomUUID(), "asha@acme.test", COMPANY, p));
    }

    @Test
    void builtInWordingWhenTheCompanyHasNoTemplate() {
        prefs(null);
        dispatcher.dispatch(TENANT, EMPLOYEE, "leave.submitted", VALUES, Map.of());
        verify(notifications).deliver(eq(TENANT), eq(EMPLOYEE), eq(AppNotificationType.LEAVE_SUBMITTED),
                eq("New leave request"), eq("Asha <Rao> requested Casual Leave from 5 Jul 2026 to 7 Jul 2026"),
                any(), eq(true), eq(true), eq("New leave request"),
                eq("Asha <Rao> requested Casual Leave from 5 Jul 2026 to 7 Jul 2026"));
        verify(transport, never()).send(anyString(), any(), anyString(), anyString());
    }

    @Test
    void companyTemplateIsUsedForInAppAndPush() {
        prefs(null);
        Map<DeliveryChannel, TemplateText> found = new EnumMap<>(DeliveryChannel.class);
        found.put(DeliveryChannel.IN_APP, new TemplateText("Leave from {{employeeName}}", "{{leaveType}}: {{startDate}} to {{endDate}}"));
        found.put(DeliveryChannel.PUSH, new TemplateText(null, "Tap to review {{employeeName}}"));
        when(templates.activeTemplates(eq(TENANT), eq(COMPANY), any(), any())).thenReturn(found);
        dispatcher.dispatch(TENANT, EMPLOYEE, "leave.submitted", VALUES, Map.of());
        verify(notifications).deliver(eq(TENANT), eq(EMPLOYEE), eq(AppNotificationType.LEAVE_SUBMITTED),
                eq("Leave from Asha <Rao>"), eq("Casual Leave: 5 Jul 2026 to 7 Jul 2026"),
                any(), eq(true), eq(true), eq("Leave from Asha <Rao>"), eq("Tap to review Asha <Rao>"));
    }

    @Test
    void switchedOffEventIsNotSentAtAll() {
        prefs(Map.of("events", Map.of("leave.submitted", Map.of("inApp", false, "push", false))));
        dispatcher.dispatch(TENANT, EMPLOYEE, "leave.submitted", VALUES, Map.of());
        verify(notifications, never()).deliver(any(), any(), any(), any(), any(), any(), anyBoolean(), anyBoolean(), any(), any());
        verify(transport, never()).send(anyString(), any(), anyString(), anyString());
    }

    @Test
    void pushOffKeepsTheBellOnly() {
        prefs(Map.of("pushEnabled", false));
        dispatcher.dispatch(TENANT, EMPLOYEE, "leave.submitted", VALUES, Map.of());
        verify(notifications).deliver(eq(TENANT), eq(EMPLOYEE), any(), any(), any(), any(), eq(true), eq(false), any(), any());
    }

    @Test
    void optedInEmailUsesTheEmailTemplateWithEscapedValues() {
        prefs(Map.of("events", Map.of("leave.submitted", Map.of("email", true))));
        Map<DeliveryChannel, TemplateText> found = new EnumMap<>(DeliveryChannel.class);
        found.put(DeliveryChannel.EMAIL, new TemplateText("Leave: {{employeeName}}", "{{employeeName}} is off {{startDate}}"));
        when(templates.activeTemplates(eq(TENANT), eq(COMPANY), any(), any())).thenReturn(found);
        dispatcher.dispatch(TENANT, EMPLOYEE, "leave.submitted", VALUES, Map.of());
        var html = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(transport).send(eq("asha@acme.test"), isNull(), eq("Leave: Asha <Rao>"), html.capture());
        assertTrue(html.getValue().contains("Asha &lt;Rao&gt; is off 5 Jul 2026"), html.getValue());
    }

    @Test
    void emailMasterOffWinsOverTheEventOptIn() {
        prefs(Map.of("emailEnabled", false, "events", Map.of("leave.submitted", Map.of("email", true))));
        dispatcher.dispatch(TENANT, EMPLOYEE, "leave.submitted", VALUES, Map.of());
        verify(transport, never()).send(anyString(), any(), anyString(), anyString());
    }

    @Test
    void unknownEventSendsNothing() {
        dispatcher.dispatch(TENANT, EMPLOYEE, "not.an.event", VALUES, Map.of());
        verify(preferences, never()).recipient(any(), any());
        verify(notifications, never()).deliver(any(), any(), any(), any(), any(), any(), anyBoolean(), anyBoolean(), any(), any());
    }
}
