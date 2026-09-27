package com.hrms.api.payroll;

import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * payroll.payslip_query_raised / _answered: catalogued events, sent to the right
 * people, and never carrying the question or the answer (push notifications
 * show on lock screens).
 */
class PayslipQueryNotifierTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID QUERY = UUID.randomUUID();
    private static final UUID RUN = UUID.randomUUID();

    @Test
    void bothEventsAreInTheCatalog() {
        assertTrue(NotificationEventCatalog.byKey(PayslipQueryNotifier.RAISED).isPresent());
        assertTrue(NotificationEventCatalog.byKey(PayslipQueryNotifier.ANSWERED).isPresent());
    }

    @Test
    @SuppressWarnings("unchecked")
    void thePayrollTeamIsToldWhoAskedAndAboutWhichMonthOnly() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        UUID fin = UUID.randomUUID(), owner = UUID.randomUUID();
        new PayslipQueryNotifier(dispatcher).raised(TENANT, List.of(fin, owner), "Reader User", "Sep 2026", QUERY, RUN);

        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(TENANT), eq(fin), eq("payroll.payslip_query_raised"), values.capture(), data.capture());
        verify(dispatcher).dispatch(eq(TENANT), eq(owner), eq("payroll.payslip_query_raised"), anyMap(), anyMap());
        assertEquals(Map.of("employeeName", "Reader User", "period", "Sep 2026"), values.getValue());
        assertEquals(Map.of("type", "PAYSLIP_QUERY_RAISED", "route", "/hrms/payroll-dashboard",
                "queryId", QUERY.toString(), "runId", RUN.toString()), data.getValue());
    }

    @Test
    @SuppressWarnings("unchecked")
    void theEmployeeIsToldWhoAnsweredNotWhat() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        UUID reader = UUID.randomUUID();
        new PayslipQueryNotifier(dispatcher).answered(TENANT, reader, null, "Sep 2026", QUERY, RUN);

        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(TENANT), eq(reader), eq("payroll.payslip_query_answered"), values.capture(), data.capture());
        assertEquals(Map.of("answeredBy", "The payroll team", "period", "Sep 2026"), values.getValue());
        assertEquals(Map.of("type", "PAYSLIP_QUERY_ANSWERED", "route", "/me/payslips",
                "queryId", QUERY.toString(), "runId", RUN.toString()), data.getValue());
    }

    @Test
    void nobodyToTellIsFineAndAFailedSendIsOnlyLogged() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        PayslipQueryNotifier notifier = new PayslipQueryNotifier(dispatcher);
        notifier.raised(TENANT, List.of(), "Reader User", "Sep 2026", QUERY, RUN);
        notifier.answered(TENANT, null, "Fin", "Sep 2026", QUERY, RUN);
        verifyNoInteractions(dispatcher);

        when(dispatcher.dispatch(any(), any(), anyString(), anyMap(), anyMap())).thenThrow(new IllegalStateException("mail down"));
        assertDoesNotThrow(() -> notifier.answered(TENANT, UUID.randomUUID(), "Fin", "Sep 2026", QUERY, RUN));
    }
}
