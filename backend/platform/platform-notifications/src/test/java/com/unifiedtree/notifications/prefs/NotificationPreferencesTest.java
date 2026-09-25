package com.unifiedtree.notifications.prefs;

import com.unifiedtree.notifications.prefs.NotificationPreferences.Delivery;
import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NotificationPreferencesTest {

    private static final EventDef LEAVE_SUBMITTED = def("leave.submitted");
    private static final EventDef PROBATION = def("people.probation_reminder");
    private static final EventDef RESET = def("account.password_reset");
    private static final EventDef INVITE = def("account.invitation");
    private static final EventDef OFFER = def("hiring.offer");
    private static final EventDef BILLING = def("billing.payment_failed");

    @Test
    void noSavedChoicesMeansTodaysBehaviour() {
        // In-app events: bell + push, no email unless the person opts in.
        assertEquals(new Delivery(true, true, false), NotificationPreferences.decide(LEAVE_SUBMITTED, null));
        // Reminders that were always emailed stay on.
        assertEquals(new Delivery(false, false, true), NotificationPreferences.decide(PROBATION, Map.of()));
    }

    @Test
    void emailMasterOffStopsNonEssentialEmail() {
        Map<String, Object> prefs = Map.of("emailEnabled", false);
        assertFalse(NotificationPreferences.decide(PROBATION, prefs).email());
        Map<String, Object> optedIn = Map.of("emailEnabled", false,
                "events", Map.of("leave.submitted", Map.of("email", true)));
        assertFalse(NotificationPreferences.decide(LEAVE_SUBMITTED, optedIn).email());
    }

    @Test
    void securityAndAccessEmailsAlwaysSend() {
        Map<String, Object> prefs = Map.of("emailEnabled", false, "pushEnabled", false,
                "events", Map.of("account.password_reset", Map.of("email", false)));
        assertTrue(NotificationPreferences.decide(RESET, prefs).email());
        assertTrue(NotificationPreferences.decide(INVITE, prefs).email());
        Delivery billing = NotificationPreferences.decide(BILLING, prefs);
        assertTrue(billing.inApp() && billing.push() && billing.email());
        assertTrue(NotificationPreferences.decide(OFFER, prefs).email());
    }

    @Test
    void pushMasterOffStopsPushButKeepsTheBell() {
        Delivery d = NotificationPreferences.decide(LEAVE_SUBMITTED, Map.of("pushEnabled", false));
        assertTrue(d.inApp());
        assertFalse(d.push());
    }

    @Test
    void perEventChoicesApplyPerChannel() {
        Map<String, Object> prefs = Map.of("events", Map.of("leave.submitted",
                Map.of("inApp", false, "push", true, "email", true)));
        assertEquals(new Delivery(false, true, true), NotificationPreferences.decide(LEAVE_SUBMITTED, prefs));
        // Other events are untouched.
        assertEquals(new Delivery(true, true, false), NotificationPreferences.decide(def("leave.approved"), prefs));
    }

    @Test
    void enumSpellingAndStringBooleansAreUnderstood() {
        Map<String, Object> prefs = Map.of("pushEnabled", "false",
                "events", Map.of("LEAVE_SUBMITTED", Map.of("inApp", "false")));
        Delivery d = NotificationPreferences.decide(LEAVE_SUBMITTED, prefs);
        assertFalse(d.inApp());
        assertFalse(d.push());
    }

    @Test
    void everythingOffMeansNothingIsSent() {
        Map<String, Object> prefs = Map.of("events", Map.of("leave.submitted", Map.of("inApp", false, "push", false)));
        assertFalse(NotificationPreferences.decide(LEAVE_SUBMITTED, prefs).any());
    }

    @Test
    void mergeKeepsWhatIsNotMentioned() {
        Map<String, Object> stored = new HashMap<>();
        stored.put("emailEnabled", true);
        stored.put("events", Map.of("leave.approved", Map.of("push", false)));
        Map<String, Object> out = NotificationPreferences.merge(stored, null, false,
                Map.of("LEAVE_SUBMITTED", Map.of("email", true)));
        assertEquals(true, out.get("emailEnabled"));
        assertEquals(false, out.get("pushEnabled"));
        @SuppressWarnings("unchecked")
        Map<String, Object> events = (Map<String, Object>) out.get("events");
        assertEquals(Map.of("push", false), events.get("leave.approved"));
        assertEquals(Map.of("email", true), events.get("leave.submitted"));
        assertTrue(NotificationPreferences.decide(LEAVE_SUBMITTED, out).email());
        assertFalse(NotificationPreferences.decide(def("leave.approved"), out).push());
    }

    @Test
    void mergeRefusesWhatCannotBeChanged() {
        IllegalArgumentException unknown = assertThrows(IllegalArgumentException.class, () ->
                NotificationPreferences.merge(null, null, null, Map.of("no.such.event", Map.of("email", false))));
        assertTrue(unknown.getMessage().contains("no.such.event"));
        IllegalArgumentException essential = assertThrows(IllegalArgumentException.class, () ->
                NotificationPreferences.merge(null, null, null, Map.of("account.password_reset", Map.of("email", false))));
        assertTrue(essential.getMessage().contains("always sent"));
        assertThrows(IllegalArgumentException.class, () ->
                NotificationPreferences.merge(null, null, null, Map.of("people.probation_reminder", Map.of("push", true))));
        assertThrows(IllegalArgumentException.class, () ->
                NotificationPreferences.merge(null, null, null, Map.of("hiring.offer", Map.of("email", false))));
    }

    @Test
    void perEventSwitchShowsTheEventChoiceOnly() {
        Map<String, Object> prefs = Map.of("emailEnabled", false);
        // The per-event switch reflects the event choice; the master decides separately.
        assertTrue(NotificationPreferences.eventChoice(PROBATION, prefs, DeliveryChannel.EMAIL));
        assertFalse(NotificationPreferences.eventChoice(LEAVE_SUBMITTED, prefs, DeliveryChannel.EMAIL));
        assertFalse(NotificationPreferences.masterOn(prefs, NotificationPreferences.EMAIL_ENABLED));
        assertTrue(NotificationPreferences.masterOn(null, NotificationPreferences.PUSH_ENABLED));
    }

    private static EventDef def(String key) {
        return NotificationEventCatalog.byKey(key).orElseThrow();
    }
}
