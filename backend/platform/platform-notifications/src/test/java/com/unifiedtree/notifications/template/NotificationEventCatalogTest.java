package com.unifiedtree.notifications.template;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NotificationEventCatalogTest {

    /** Requirement: every AppNotificationType has an event key, default wording and a description. */
    @Test
    void everyNotificationTypeHasAnEntryWithWordingAndDescription() {
        for (AppNotificationType type : AppNotificationType.values()) {
            assertTrue(NotificationEventCatalog.covers(type), "No catalog entry for " + type
                    + " — add it to NotificationEventCatalog (event key, description, default text)");
            EventDef d = NotificationEventCatalog.forType(type);
            assertNotBlank(d.key(), type + " key");
            assertNotBlank(d.description(), type + " description");
            assertNotBlank(d.defaultTitle(), type + " default title");
            assertNotBlank(d.defaultBody(), type + " default body");
        }
    }

    @Test
    void keysAreUniqueLowercaseAndEveryEventIsDescribed() {
        Set<String> seen = new HashSet<>();
        for (EventDef d : NotificationEventCatalog.all()) {
            assertTrue(seen.add(d.key()), "duplicate " + d.key());
            assertEquals(d.key().toLowerCase(), d.key());
            assertNotBlank(d.label(), d.key() + " label");
            assertNotBlank(d.description(), d.key() + " description");
            assertNotBlank(d.group(), d.key() + " group");
            assertNotBlank(d.audience(), d.key() + " audience");
            assertFalse(d.channels().isEmpty(), d.key() + " channels");
            assertTrue(d.channels().containsAll(d.templateChannels()), d.key() + " template channels");
        }
    }

    /** The built-in wording may only use placeholders the event provides (else it would render blanks). */
    @Test
    void defaultWordingUsesOnlyTheEventsOwnPlaceholders() {
        for (EventDef d : NotificationEventCatalog.all()) {
            if (d.templateChannels().isEmpty()) continue;
            for (String text : new String[]{d.defaultTitle(), d.defaultBody(), d.defaultEmailSubject(), d.defaultEmailBody()}) {
                for (String name : TemplateRenderer.placeholders(text)) {
                    assertNotNull(d.placeholder(name), d.key() + " default text uses {{" + name + "}} which it doesn't provide");
                }
            }
        }
    }

    @Test
    void noBrandNameInBuiltInWording() {
        for (EventDef d : NotificationEventCatalog.all()) {
            String all = String.join(" ", d.label(), d.description(), d.defaultTitle(), d.defaultBody(),
                    String.valueOf(d.defaultEmailSubject()), String.valueOf(d.defaultEmailBody())).toLowerCase();
            assertFalse(all.contains("unifiedtree") || all.contains("unified tree"), d.key());
        }
    }

    @Test
    void findsByKeyCaseInsensitivelyAndByEnumAlias() {
        assertEquals("leave.approved", NotificationEventCatalog.byKey("LEAVE_APPROVED").orElseThrow().key());
        assertEquals("leave.approved", NotificationEventCatalog.byKey(" Leave.Approved ").orElseThrow().key());
        assertTrue(NotificationEventCatalog.byKey("nope").isEmpty());
        assertTrue(NotificationEventCatalog.byKey(null).isEmpty());
    }

    @Test
    void essentialEventsAreTheSecurityBillingAndDocumentOnes() {
        assertTrue(NotificationEventCatalog.byKey("account.password_reset").orElseThrow().essential());
        assertTrue(NotificationEventCatalog.byKey("account.invitation").orElseThrow().essential());
        assertTrue(NotificationEventCatalog.byKey("billing.payment_failed").orElseThrow().essential());
        assertFalse(NotificationEventCatalog.byKey("leave.submitted").orElseThrow().essential());
        assertFalse(NotificationEventCatalog.byKey("people.probation_reminder").orElseThrow().essential());
        assertTrue(NotificationEventCatalog.byKey("hiring.offer").orElseThrow().external());
    }

    /** The defaults reproduce the wording the listener used to hard-code. */
    @Test
    void defaultWordingMatchesTheOldBuiltInText() {
        EventDef rejected = NotificationEventCatalog.byKey("leave.rejected").orElseThrow();
        assertEquals("Your Casual Leave from 5 Jul 2026 to 7 Jul 2026 has been rejected. Reason: Busy week",
                TemplateRenderer.render(rejected.defaultBody(), Map.of("leaveType", "Casual Leave",
                        "startDate", "5 Jul 2026", "endDate", "7 Jul 2026", "reasonText", " Reason: Busy week")));
        EventDef submitted = NotificationEventCatalog.byKey("leave.submitted").orElseThrow();
        assertEquals("Asha Rao requested Casual Leave from 5 Jul 2026 to 7 Jul 2026",
                TemplateRenderer.render(submitted.defaultBody(), Map.of("employeeName", "Asha Rao",
                        "leaveType", "Casual Leave", "startDate", "5 Jul 2026", "endDate", "7 Jul 2026")));
        EventDef doc = NotificationEventCatalog.byKey("document.rejected").orElseThrow();
        assertEquals("Your PAN card was rejected. Please re-upload.",
                TemplateRenderer.render(doc.defaultBody(), Map.of("documentType", "PAN card", "reasonText", "")));
    }

    private static void assertNotBlank(String s, String what) {
        assertTrue(s != null && !s.isBlank(), what + " is blank");
    }
}
