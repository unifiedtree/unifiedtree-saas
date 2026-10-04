package com.unifiedtree.notifications.template;

import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import org.junit.jupiter.api.Test;

import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
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

    /** The events the HRMS redesign adds (AUDIT §5.16, and addendum D): type → { key, group, audience }. */
    private static final Map<AppNotificationType, String[]> REDESIGN_EVENTS = new LinkedHashMap<>();
    static {
        REDESIGN_EVENTS.put(AppNotificationType.DECISION_UNDONE, new String[]{"approvals.decision_undone", "Approvals", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.CHECKIN_REMINDER, new String[]{"attendance.checkin_reminder", "Attendance", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.PERFORMANCE_REVIEW_REMINDER, new String[]{"performance.review_reminder", "Performance", "Reviewers"});
        REDESIGN_EVENTS.put(AppNotificationType.TEAM_MESSAGE, new String[]{"team.message", "Team", "Team members"});
        REDESIGN_EVENTS.put(AppNotificationType.ASSET_ISSUE_REPORTED, new String[]{"assets.issue_reported", "Assets", "HR"});
        REDESIGN_EVENTS.put(AppNotificationType.PAYSLIP_QUERY_RAISED, new String[]{"payroll.payslip_query_raised", "Payroll", "Payroll team"});
        REDESIGN_EVENTS.put(AppNotificationType.PAYSLIP_QUERY_ANSWERED, new String[]{"payroll.payslip_query_answered", "Payroll", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.LEAVE_APPLIED_ON_BEHALF, new String[]{"leave.applied_on_behalf", "Leave", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.EXPENSE_CLAIM_RAISED_FOR_YOU, new String[]{"expense.raised_for_you", "Expenses and advances", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.TIMESHEET_SUBMITTED, new String[]{"attendance.timesheet_submitted", "Attendance", "Approver"});
        REDESIGN_EVENTS.put(AppNotificationType.TIMESHEET_DECIDED, new String[]{"attendance.timesheet_decided", "Attendance", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.LETTER_SIGNATURE_REQUESTED, new String[]{"letters.signature_requested", "Letters", "Employee"});
        REDESIGN_EVENTS.put(AppNotificationType.PROBATION_TEAM_DECISION, new String[]{"people.probation_team_decision", "People", "Employee and HR"});
    }

    /**
     * Each redesign event has its own entry (not the "general" fallback) with the
     * key the senders use, in the right group, for the right people. None is
     * always-sent, so everyone can switch them off in their notification choices.
     */
    @Test
    void redesignEventsHaveTheirOwnEntriesInTheRightGroup() {
        assertEquals(13, REDESIGN_EVENTS.size());
        for (Map.Entry<AppNotificationType, String[]> e : REDESIGN_EVENTS.entrySet()) {
            AppNotificationType type = e.getKey();
            String key = e.getValue()[0];
            assertTrue(NotificationEventCatalog.covers(type), type + " has no entry of its own");
            EventDef d = NotificationEventCatalog.forType(type);
            assertEquals(key, d.key(), type + " key");
            assertEquals(e.getValue()[1], d.group(), type + " group");
            assertEquals(e.getValue()[2], d.audience(), type + " audience");
            assertSame(d, NotificationEventCatalog.byKey(key).orElseThrow(), key + " by key");
            assertSame(d, NotificationEventCatalog.byKey(type.name()).orElseThrow(), type + " by its enum name");
            assertFalse(d.essential(), key + " must follow the person's choices");
            assertFalse(d.external(), key + " goes to people in the workspace");
            assertTrue(d.has(DeliveryChannel.IN_APP) && d.has(DeliveryChannel.PUSH), key + " is in the app and on the phone");
            assertTrue(d.templatable(DeliveryChannel.IN_APP), key + " can have a company template");
            assertFalse(d.emailByDefault(), key + " emails only people who switch it on");
        }
    }

    /**
     * Punch-in alerts (V143.72): their own entry under Attendance, in the app and
     * on the phone only (never email: it carries an exact location), following
     * each person's choices, templatable, and readable with every value filled.
     */
    @Test
    void punchInAlertsAreAnAttendanceEventInTheAppAndOnThePhone() {
        assertTrue(NotificationEventCatalog.covers(AppNotificationType.PUNCH_IN_ALERT));
        EventDef d = NotificationEventCatalog.forType(AppNotificationType.PUNCH_IN_ALERT);
        assertEquals("attendance.punch_in_alert", d.key());
        assertEquals("Attendance", d.group());
        assertSame(d, NotificationEventCatalog.byKey("PUNCH_IN_ALERT").orElseThrow());
        assertEquals(EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH), d.channels());
        assertFalse(d.essential(), "people can switch it off for themselves");
        assertTrue(d.templatable(DeliveryChannel.PUSH));
        assertTrue(d.placeholder("mapLink").link());
        Map<String, String> values = new HashMap<>();
        for (NotificationEventCatalog.Placeholder p : d.placeholders()) values.put(p.name(), "x");
        for (String text : new String[]{d.defaultTitle(), d.defaultBody()}) {
            String rendered = TemplateRenderer.render(text, values);
            assertFalse(rendered.contains("{{") || rendered.contains("}}"), rendered);
        }
        assertEquals("Priya Rao punched in at 9:42 am", TemplateRenderer.render(d.defaultTitle(),
                Map.of("employeeName", "Priya Rao", "time", "9:42 am")));
        assertEquals("At Head Office. Face scan in the app. Location: 17.385040, 78.486670 (±15 m).",
                TemplateRenderer.render(d.defaultBody(), Map.of("place", "At Head Office", "method", "Face scan in the app",
                        "coordinatesText", " Location: 17.385040, 78.486670 (±15 m).")));
    }

    /** A reminder a person sends by hand and a team message never go by email (DECISIONS 15). */
    @Test
    void checkInRemindersAndTeamMessagesAreAppAndPhoneOnly() {
        for (AppNotificationType type : EnumSet.of(AppNotificationType.CHECKIN_REMINDER, AppNotificationType.TEAM_MESSAGE)) {
            EventDef d = NotificationEventCatalog.forType(type);
            assertEquals(EnumSet.of(DeliveryChannel.IN_APP, DeliveryChannel.PUSH), d.channels(), type + " channels");
        }
    }

    /** With every placeholder filled, the built-in wording of the new events reads as a whole sentence. */
    @Test
    void redesignWordingRendersWithNothingLeftOver() {
        EventDef undo = NotificationEventCatalog.byKey("approvals.decision_undone").orElseThrow();
        assertEquals("Priya Rao took back their decision on your leave request for 5 Jul 2026 to 7 Jul 2026. It is waiting for a decision again.",
                TemplateRenderer.render(undo.defaultBody(), Map.of("decidedBy", "Priya Rao",
                        "requestText", "leave request for 5 Jul 2026 to 7 Jul 2026")));
        EventDef remind = NotificationEventCatalog.byKey("attendance.checkin_reminder").orElseThrow();
        assertEquals("Priya Rao is reminding you to check in for 28 Sep 2026. If you're away that day, apply for leave.",
                TemplateRenderer.render(remind.defaultBody(), Map.of("sentBy", "Priya Rao", "date", "28 Sep 2026")));
        EventDef decided = NotificationEventCatalog.byKey("attendance.timesheet_decided").orElseThrow();
        assertEquals("Timesheet rejected", TemplateRenderer.render(decided.defaultTitle(), Map.of("decision", "rejected")));
        EventDef probation = NotificationEventCatalog.byKey("people.probation_team_decision").orElseThrow();
        assertEquals("Probation extended", TemplateRenderer.render(probation.defaultTitle(), Map.of("decision", "extended")));
        assertEquals("Priya Rao extended your probation to 5 Nov 2026.",
                TemplateRenderer.render(probation.defaultBody(), Map.of("message", "Priya Rao extended your probation to 5 Nov 2026.")));

        for (AppNotificationType type : REDESIGN_EVENTS.keySet()) {
            EventDef d = NotificationEventCatalog.forType(type);
            Map<String, String> values = new HashMap<>();
            for (NotificationEventCatalog.Placeholder p : d.placeholders()) values.put(p.name(), "x");
            for (String text : new String[]{d.defaultTitle(), d.defaultBody(), d.defaultEmailSubject(), d.defaultEmailBody()}) {
                String rendered = TemplateRenderer.render(text, values);
                assertNotBlank(rendered, d.key() + " wording");
                assertFalse(rendered.contains("{{") || rendered.contains("}}"), d.key() + " leaves a placeholder: " + rendered);
            }
        }
    }

    private static void assertNotBlank(String s, String what) {
        assertTrue(s != null && !s.isBlank(), what + " is blank");
    }
}
