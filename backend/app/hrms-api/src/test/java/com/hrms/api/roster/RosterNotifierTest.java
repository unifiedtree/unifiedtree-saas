package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterPublishedEvent.Change;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.TemplateRenderer;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Who is told what when a roster is published (D-S12, design §1.8): "Your shift schedule is ready" to
 * people who now have a published day and had none (everyone at the first publish, people added
 * later), "Your schedule changed" to everyone else whose days changed; in the app and on the phone,
 * with a route; a failed notice never throws.
 */
class RosterNotifierTest {

    static final UUID TENANT = UUID.randomUUID(), ROSTER = UUID.randomUUID();
    static final UUID RAVI = UUID.randomUUID(), SITA = UUID.randomUUID(), ARUN = UUID.randomUUID(), MEERA = UUID.randomUUID();
    static final LocalDate D12 = LocalDate.of(2026, 10, 12), D14 = LocalDate.of(2026, 10, 14), D20 = LocalDate.of(2026, 10, 20);

    static Change added(UUID e, LocalDate d) { return new Change(e, d, ChangeKind.ADDED, "SHIFT", "A (Morning, 06:00–14:00)"); }
    static Change changed(UUID e, LocalDate d, String text) { return new Change(e, d, ChangeKind.CHANGED, "SHIFT", text); }
    static Change toWo(UUID e, LocalDate d) { return new Change(e, d, ChangeKind.CHANGED, "WO", null); }
    static Change removed(UUID e, LocalDate d) { return new Change(e, d, ChangeKind.REMOVED, null, null); }

    @Test
    void atTheFirstPublishEveryoneWithADayIsToldTheScheduleIsReady() {
        RosterNotifier.Recipients r = RosterNotifier.recipients(Set.of(), Set.of(RAVI, SITA),
                List.of(added(RAVI, D12), added(RAVI, D14), added(SITA, D12)));
        assertEquals(Set.of(RAVI, SITA), r.published());
        assertTrue(r.changed().isEmpty());
        assertEquals(2, r.count());
    }

    @Test
    void atARepublishPeopleAddedAreToldItIsReadyAndTheOthersWhatChanged() {
        RosterNotifier.Recipients r = RosterNotifier.recipients(Set.of(RAVI, SITA, MEERA), Set.of(RAVI, SITA, ARUN),
                List.of(changed(RAVI, D14, "B (Evening, 14:00–22:00)"), removed(RAVI, D20), added(ARUN, D12), added(ARUN, D14),
                        removed(MEERA, D12)));
        assertEquals(Set.of(ARUN), r.published());
        assertEquals(Set.of(RAVI, MEERA), r.changed().keySet(), "Sita had no change; Meera was taken off and is told");
        assertEquals(3, r.count());
    }

    @Test
    void theChangeSaysTheFirstDayAndHowManyMore() {
        assertEquals("14 Oct is now B (Evening, 14:00–22:00), and 1 more day.",
                RosterNotifier.changeText(List.of(removed(RAVI, D20), changed(RAVI, D14, "B (Evening, 14:00–22:00)"))));
        assertEquals("12 Oct is now a weekly off.", RosterNotifier.changeText(List.of(toWo(RAVI, D12))));
        assertEquals("20 Oct is no longer planned, and 2 more days.",
                RosterNotifier.changeText(List.of(removed(RAVI, D20), removed(RAVI, D20.plusDays(1)), removed(RAVI, D20.plusDays(2)))));
    }

    static RosterPublishedEvent event(Set<UUID> before, Set<UUID> now, List<Change> changes) {
        return new RosterPublishedEvent(TENANT, ROSTER, "October 2026 · Technical", "October 2026", D12, LocalDate.of(2026, 10, 31),
                before, now, changes);
    }

    @Test
    @SuppressWarnings("unchecked")
    void eachPersonGetsTheirNoticeWithItsRoute() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        RosterNotifier n = new RosterNotifier(dispatcher, Runnable::run);
        n.onPublished(event(Set.of(RAVI), Set.of(RAVI, ARUN), List.of(changed(RAVI, D14, "B (Evening, 14:00–22:00)"), added(ARUN, D12))));

        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(TENANT), eq(ARUN), eq("roster.published"), values.capture(), data.capture());
        assertEquals("October 2026", values.getValue().get("period"));
        assertEquals("ROSTER_PUBLISHED", data.getValue().get("type"));
        assertEquals(ROSTER.toString(), data.getValue().get("rosterId"));
        assertEquals("2026-10-12", data.getValue().get("from"));
        assertEquals("2026-10-31", data.getValue().get("to"));
        assertEquals("/my-schedule", data.getValue().get("route"));

        verify(dispatcher).dispatch(eq(TENANT), eq(RAVI), eq("roster.day_changed"), values.capture(), data.capture());
        assertEquals("14 Oct is now B (Evening, 14:00–22:00).", values.getValue().get("changeText"));
        assertEquals("ROSTER_DAY_CHANGED", data.getValue().get("type"));
        assertEquals(List.of("2026-10-14"), data.getValue().get("dates"));
        assertEquals("/my-schedule", data.getValue().get("route"));
        verifyNoMoreInteractions(dispatcher);
    }

    @Test
    void aFailedNoticeIsLoggedNotThrownAndTheOthersStillGo() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        when(dispatcher.dispatch(any(), eq(RAVI), anyString(), any(), any())).thenThrow(new IllegalStateException("push down"));
        RosterNotifier n = new RosterNotifier(dispatcher, Runnable::run);
        RosterPublishedEvent e = event(Set.of(), Set.of(RAVI, SITA), List.of(added(RAVI, D12), added(SITA, D12)));
        assertDoesNotThrow(() -> n.onPublished(e));
        verify(dispatcher).dispatch(eq(TENANT), eq(SITA), eq("roster.published"), any(), any());
        assertEquals(1, n.send(e), "one of the two was handed over");
        // a queue that refuses the work never fails the publish either
        RosterNotifier refusing = new RosterNotifier(dispatcher, r -> { throw new java.util.concurrent.RejectedExecutionException("full"); });
        assertDoesNotThrow(() -> refusing.onPublished(e));
        assertDoesNotThrow(() -> n.onPublished(null));
    }

    @Test
    void nothingIsSentWhenNobodysDayChanged() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        new RosterNotifier(dispatcher, Runnable::run).onPublished(event(Set.of(RAVI), Set.of(RAVI), List.of()));
        verifyNoInteractions(dispatcher);
    }

    /** The two events are their own Shifts entries, in the app and on the phone only, following each person's choices. */
    @Test
    void theCatalogHasBothEventsUnderShifts() {
        for (AppNotificationType type : List.of(AppNotificationType.ROSTER_PUBLISHED, AppNotificationType.ROSTER_DAY_CHANGED)) {
            assertTrue(NotificationEventCatalog.covers(type), type + " has its own entry");
            NotificationEventCatalog.EventDef d = NotificationEventCatalog.forType(type);
            assertEquals("Shifts", d.group());
            assertEquals(EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH), d.channels());
            assertFalse(d.essential(), "people can switch it off");
            assertTrue(d.templatable(DeliveryChannel.IN_APP));
            assertSame(d, NotificationEventCatalog.byKey(type.name()).orElseThrow());
        }
        NotificationEventCatalog.EventDef published = NotificationEventCatalog.byKey(RosterNotifier.PUBLISHED).orElseThrow();
        assertEquals("Your shift schedule is ready", published.defaultTitle());
        assertEquals("Your schedule for October 2026 is published. Open it to see your shifts.",
                TemplateRenderer.render(published.defaultBody(), Map.of("period", "October 2026")));
        NotificationEventCatalog.EventDef changed = NotificationEventCatalog.byKey(RosterNotifier.DAY_CHANGED).orElseThrow();
        assertEquals("Your schedule changed", changed.defaultTitle());
        assertEquals("12 Oct is now a weekly off.", TemplateRenderer.render(changed.defaultBody(), Map.of("changeText", "12 Oct is now a weekly off.")));
    }
}
