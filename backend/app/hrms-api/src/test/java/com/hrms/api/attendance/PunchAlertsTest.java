package com.hrms.api.attendance;

import com.hrms.api.attendance.PunchAlertSettingsService.Rules;
import com.hrms.api.attendance.PunchAlerts.Candidate;
import com.hrms.api.attendance.PunchAlerts.Place;
import com.hrms.api.attendance.PunchAlerts.Where;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;
import com.unifiedtree.notifications.template.TemplateRenderer;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Punch-in alerts (V143.72) without a database: who gets one, where the punch
 * was (in a zone, or how far outside the nearest one), and what the alert says.
 */
class PunchAlertsTest {

    private static final UUID COMPANY = UUID.randomUUID();
    private static final UUID OTHER_COMPANY = UUID.randomUUID();
    private static final UUID EMP = UUID.randomUUID();
    /** Head Office, Hyderabad. 1° of latitude is about 111,195 m. */
    private static final double HQ_LAT = 17.385040, HQ_LNG = 78.486670;
    private static final double METER = 1 / 111_195.0;

    private static Rules rules(boolean manager, List<UUID> people, List<UUID> roles, String alertOn) {
        return new Rules(manager, people, roles, alertOn);
    }

    private static Candidate here(UUID id) {
        return new Candidate(id, COMPANY, true, true);
    }

    // ── who gets it ─────────────────────────────────────────────────────────

    @Test void theReportingManagerGetsItByDefault() {
        UUID mgr = UUID.randomUUID();
        assertEquals(List.of(mgr), PunchAlerts.recipients(Rules.defaults(), EMP, COMPANY, here(mgr), List.of(), List.of(), false));
    }

    @Test void noManagerWhenTheCompanyTurnedThatOff() {
        UUID mgr = UUID.randomUUID();
        assertEquals(List.of(), PunchAlerts.recipients(rules(false, List.of(), List.of(), "ALL"), EMP, COMPANY,
                here(mgr), List.of(), List.of(), true));
    }

    @Test void aManagerWhoLeftOrHasNoLoginIsSkipped() {
        UUID mgr = UUID.randomUUID();
        assertEquals(List.of(), PunchAlerts.recipients(Rules.defaults(), EMP, COMPANY,
                new Candidate(mgr, COMPANY, false, true), List.of(), List.of(), false));
        assertEquals(List.of(), PunchAlerts.recipients(Rules.defaults(), EMP, COMPANY,
                new Candidate(mgr, COMPANY, true, false), List.of(), List.of(), false));
        assertEquals(List.of(), PunchAlerts.recipients(Rules.defaults(), EMP, COMPANY, null, List.of(), List.of(), false));
    }

    @Test void theReportingLineCountsEvenAcrossCompanies() {
        UUID mgr = UUID.randomUUID();
        assertEquals(List.of(mgr), PunchAlerts.recipients(Rules.defaults(), EMP, COMPANY,
                new Candidate(mgr, OTHER_COMPANY, true, true), List.of(), List.of(), false));
    }

    @Test void pickedPeopleOfThisCompanyGetItToo() {
        UUID mgr = UUID.randomUUID(), hr = UUID.randomUUID(), sup = UUID.randomUUID();
        assertEquals(List.of(mgr, hr, sup), PunchAlerts.recipients(rules(true, List.of(hr, sup), List.of(), "ALL"), EMP, COMPANY,
                here(mgr), List.of(here(hr), here(sup)), List.of(), false));
    }

    @Test void pickedPeopleFromAnotherCompanyOrWhoLeftAreSkipped() {
        UUID elsewhere = UUID.randomUUID(), left = UUID.randomUUID(), noLogin = UUID.randomUUID(), ok = UUID.randomUUID();
        List<UUID> got = PunchAlerts.recipients(rules(false, List.of(elsewhere, left, noLogin, ok), List.of(), "ALL"), EMP, COMPANY, null,
                List.of(new Candidate(elsewhere, OTHER_COMPANY, true, true), new Candidate(left, COMPANY, false, true),
                        new Candidate(noLogin, COMPANY, true, false), here(ok)), List.of(), false);
        assertEquals(List.of(ok), got);
    }

    @Test void roleHoldersOfThisCompanyOnly() {
        UUID supervisor = UUID.randomUUID(), otherCompanySupervisor = UUID.randomUUID();
        List<UUID> got = PunchAlerts.recipients(rules(false, List.of(), List.of(UUID.randomUUID()), "ALL"), EMP, COMPANY, null,
                List.of(), List.of(here(supervisor), new Candidate(otherCompanySupervisor, OTHER_COMPANY, true, true)), false);
        assertEquals(List.of(supervisor), got);
    }

    @Test void everyoneOnceManagerFirst() {
        UUID mgr = UUID.randomUUID(), hr = UUID.randomUUID();
        List<UUID> got = PunchAlerts.recipients(rules(true, List.of(hr, mgr), List.of(UUID.randomUUID()), "ALL"), EMP, COMPANY,
                here(mgr), List.of(here(hr), here(mgr)), List.of(here(mgr), here(hr), here(hr)), false);
        assertEquals(List.of(mgr, hr), got);
    }

    @Test void neverThePersonWhoPunched() {
        // They head their own department (so they are their own "manager"), were picked and hold the role.
        List<UUID> got = PunchAlerts.recipients(rules(true, List.of(EMP), List.of(UUID.randomUUID()), "ALL"), EMP, COMPANY,
                here(EMP), List.of(here(EMP)), List.of(here(EMP)), true);
        assertEquals(List.of(), got);
    }

    @Test void lateOrOutsideOnlySkipsAnOrdinaryPunchIn() {
        UUID mgr = UUID.randomUUID();
        Rules onlyExceptions = rules(true, List.of(), List.of(), "LATE_OR_OUTSIDE");
        assertEquals(List.of(), PunchAlerts.recipients(onlyExceptions, EMP, COMPANY, here(mgr), List.of(), List.of(), false));
        assertEquals(List.of(mgr), PunchAlerts.recipients(onlyExceptions, EMP, COMPANY, here(mgr), List.of(), List.of(), true));
        // Every punch-in (the default) ignores whether it's an exception.
        assertEquals(List.of(mgr), PunchAlerts.recipients(Rules.defaults(), EMP, COMPANY, here(mgr), List.of(), List.of(), false));
    }

    @Test void atMostAHundredPeople() {
        List<Candidate> many = new ArrayList<>();
        for (int i = 0; i < 150; i++) many.add(here(UUID.randomUUID()));
        assertEquals(PunchAlerts.MAX_RECIPIENTS, PunchAlerts.recipients(rules(false, List.of(), List.of(UUID.randomUUID()), "ALL"),
                EMP, COMPANY, null, List.of(), many, false).size());
        assertEquals(List.of(), PunchAlerts.recipients(null, EMP, COMPANY, here(UUID.randomUUID()), List.of(), List.of(), true));
    }

    @Test void whatCountsAsLateOrOutside() {
        Where inside = new Where(true, true, "Head Office", null, null);
        Where outside = new Where(true, false, null, 900, "Head Office");
        Where noOffice = new Where(true, false, null, null, null);
        Where unknown = new Where(false, false, null, null, null);
        assertFalse(PunchAlerts.isException(false, inside, false, false));
        assertTrue(PunchAlerts.isException(true, inside, false, false), "late");
        assertTrue(PunchAlerts.isException(false, outside, false, false), "outside the office");
        assertFalse(PunchAlerts.isException(false, outside, true, false), "an approved work-from-home day");
        assertFalse(PunchAlerts.isException(false, outside, false, true), "allowed to punch from anywhere");
        assertTrue(PunchAlerts.isException(true, outside, true, false), "late is late, even from home");
        assertTrue(PunchAlerts.isException(false, unknown, false, false), "no location at all");
        assertFalse(PunchAlerts.isException(false, noOffice, false, false), "no office set up to be outside of");
    }

    // ── where it was ────────────────────────────────────────────────────────

    private static final Place HQ = new Place("Head Office", HQ_LAT, HQ_LNG, 100, false);
    private static final Place PLANT = new Place("Plant 2", HQ_LAT + 5000 * METER, HQ_LNG, 200, false);

    @Test void insideAZoneSaysWhichOne() {
        Where w = PunchAlerts.where(HQ_LAT + 40 * METER, HQ_LNG, List.of(PLANT, HQ));
        assertTrue(w.inside());
        assertFalse(w.outside());
        assertEquals("At Head Office", w.text());
    }

    @Test void outsideSaysHowFarFromTheNearestZone() {
        Where w = PunchAlerts.where(HQ_LAT + 347 * METER, HQ_LNG, List.of(PLANT, HQ));
        assertFalse(w.inside());
        assertTrue(w.outside());
        assertEquals("Head Office", w.nearestName());
        assertEquals(347, w.distanceMeters(), 1);
        assertEquals("Outside office, about 350 m from Head Office", w.text());

        Where far = PunchAlerts.where(HQ_LAT - 1234 * METER, HQ_LNG, List.of(PLANT, HQ));
        assertEquals("Outside office, about 1.2 km from Head Office", far.text());
    }

    @Test void theirOwnZoneWinsWhenZonesOverlap() {
        Place gate = new Place("Main gate", HQ_LAT + 30 * METER, HQ_LNG, 100, true);
        assertEquals("At Main gate", PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(HQ, gate)).text());
        Place notOwnGate = new Place("Main gate", HQ_LAT + 30 * METER, HQ_LNG, 100, false);
        assertEquals("At Head Office", PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(notOwnGate, HQ)).text(), "else the closest");
    }

    @Test void noLocationOrNoOfficeIsSaidPlainly() {
        assertEquals("Location not shared", PunchAlerts.where(null, null, List.of(HQ)).text());
        assertEquals("Location not shared", PunchAlerts.where(0.0, 0.0, List.of(HQ)).text());
        Where none = PunchAlerts.where(HQ_LAT, HQ_LNG, List.of());
        assertEquals("Office location not set up", none.text());
        assertFalse(none.outside());
        Place noPosition = new Place("Branch without a pin", 0, 0, 100, true);
        assertEquals("Office location not set up", PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(noPosition)).text());
    }

    @Test void distancesReadNaturally() {
        assertEquals("10 m", PunchAlerts.distanceText(4));
        assertEquals("350 m", PunchAlerts.distanceText(347));
        assertEquals("1.2 km", PunchAlerts.distanceText(1234));
        assertEquals("23 km", PunchAlerts.distanceText(23_456));
    }

    // ── what it says ────────────────────────────────────────────────────────

    @Test void howTheyPunchedIn() {
        assertEquals("Face scan in the app", PunchAlerts.methodText("FACE_RECOGNITION", false, null));
        assertEquals("Web check-in with a face scan", PunchAlerts.methodText("WEB", false, null));
        assertEquals("Location check-in in the app", PunchAlerts.methodText("GPS", false, null));
        assertEquals("Punched in for them by Ravi Kumar with a face scan", PunchAlerts.methodText("FACE_RECOGNITION", true, "Ravi Kumar"));
        assertEquals("Punched in for them by their manager with a face scan", PunchAlerts.methodText("FACE_RECOGNITION", true, " "));
        assertEquals("Check-in from the app", PunchAlerts.methodText(null, false, null));
    }

    @Test void timeInIndiaAndTheMapLink() {
        assertEquals("9:42 am", PunchAlerts.clock(Instant.parse("2026-10-05T04:12:00Z")));
        assertEquals("6:10 pm", PunchAlerts.clock(Instant.parse("2026-10-05T12:40:00Z")));
        assertEquals("https://www.google.com/maps?q=17.385040,78.486670", PunchAlerts.mapUrl(HQ_LAT, HQ_LNG));
        assertNull(PunchAlerts.mapUrl(0.0, 0.0));
        assertEquals("17.385040, 78.486670 (±15 m)", PunchAlerts.coordinates(HQ_LAT, HQ_LNG, 14.6));
        assertEquals("17.385040, 78.486670", PunchAlerts.coordinates(HQ_LAT, HQ_LNG, null));
        assertEquals("", PunchAlerts.coordinates(null, HQ_LNG, 5.0));
    }

    private static PunchAlerts.Alert alert(double lat, double lng, Double accuracy, Where where, boolean late, Integer lateBy,
                                           String method, boolean assisted, boolean offline, Instant receivedAt) {
        return new PunchAlerts.Alert(UUID.randomUUID(), EMP, "Priya Rao", LocalDate.of(2026, 10, 5),
                Instant.parse("2026-10-05T04:12:00Z"), receivedAt, offline, method, assisted, assisted ? "Ravi Kumar" : null,
                lat, lng, accuracy, where, late, lateBy, false);
    }

    private static String body(Map<String, String> values) {
        EventDef def = NotificationEventCatalog.byKey(PunchAlertNotifier.EVENT_KEY).orElseThrow();
        return TemplateRenderer.render(def.defaultBody(), values);
    }

    @Test void theAlertInAZone() {
        Where w = PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(HQ));
        Map<String, String> v = PunchAlerts.values(alert(HQ_LAT, HQ_LNG, 15.0, w, true, 12, "FACE_RECOGNITION", false, false,
                Instant.parse("2026-10-05T04:12:03Z")));
        EventDef def = NotificationEventCatalog.byKey(PunchAlertNotifier.EVENT_KEY).orElseThrow();
        assertEquals("Priya Rao punched in at 9:42 am", TemplateRenderer.renderSubject(def.defaultTitle(), v));
        assertEquals("At Head Office · 12 min late. Face scan in the app. Location: 17.385040, 78.486670 (±15 m).", body(v));
        assertEquals("https://www.google.com/maps?q=17.385040,78.486670", v.get("mapLink"));
        assertEquals("5 Oct 2026", v.get("date"));
    }

    @Test void theAlertOutsideTheOffice() {
        double lat = HQ_LAT + 347 * METER;
        Where w = PunchAlerts.where(lat, HQ_LNG, List.of(HQ));
        Map<String, String> v = PunchAlerts.values(alert(lat, HQ_LNG, null, w, false, 0, "WEB", false, false, null));
        assertEquals("Outside office, about 350 m from Head Office. Web check-in with a face scan. Location: "
                + PunchAlerts.coordinates(lat, HQ_LNG, null) + ".", body(v));
    }

    @Test void anAssistedPunchSaysWhoMadeIt() {
        Where w = PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(HQ));
        Map<String, String> v = PunchAlerts.values(alert(HQ_LAT, HQ_LNG, 8.0, w, false, 0, "FACE_RECOGNITION", true, false, null));
        assertEquals("At Head Office. Punched in for them by Ravi Kumar with a face scan. Location: 17.385040, 78.486670 (±8 m).", body(v));
    }

    @Test void anOfflinePunchSaysWhenItReachedUs() {
        Where w = PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(HQ));
        Map<String, String> late = PunchAlerts.values(alert(HQ_LAT, HQ_LNG, null, w, false, 0, "FACE_RECOGNITION", false, true,
                Instant.parse("2026-10-05T12:40:00Z")));
        assertTrue(body(late).endsWith(" The phone was offline; this reached us at 6:10 pm."), body(late));
        Map<String, String> soon = PunchAlerts.values(alert(HQ_LAT, HQ_LNG, null, w, false, 0, "FACE_RECOGNITION", false, true,
                Instant.parse("2026-10-05T04:14:00Z")));
        assertEquals("", soon.get("offlineText"), "two minutes isn't worth mentioning");
    }

    @Test void withoutALocationThereIsNoMapLink() {
        Where w = PunchAlerts.where(0.0, 0.0, List.of(HQ));
        Map<String, String> v = PunchAlerts.values(alert(0.0, 0.0, null, w, false, 0, "FACE_RECOGNITION", false, false, null));
        assertEquals("Location not shared. Face scan in the app.", body(v));
        assertEquals("", v.get("mapLink"));
        Map<String, Object> d = PunchAlerts.data(alert(0.0, 0.0, null, w, false, 0, "FACE_RECOGNITION", false, false, null));
        assertNull(d.get("mapUrl"));
        assertNull(d.get("latitude"));
    }

    @Test void thePayloadCarriesThePlaceAndTheMapLink() {
        double lat = HQ_LAT + 347 * METER;
        Map<String, Object> outside = PunchAlerts.data(alert(lat, HQ_LNG, 12.4, PunchAlerts.where(lat, HQ_LNG, List.of(HQ)),
                true, 5, "WEB", false, false, null));
        assertEquals("PUNCH_IN_ALERT", outside.get("type"));
        assertEquals("/notifications", outside.get("route"));
        assertEquals(false, outside.get("insideZone"));
        assertNull(outside.get("zoneName"));
        assertEquals("Head Office", outside.get("nearestZoneName"));
        assertEquals(347, (Integer) outside.get("distanceMeters"), 1);
        assertEquals(PunchAlerts.mapUrl(lat, HQ_LNG), outside.get("mapUrl"));
        assertEquals(12.0, outside.get("accuracyMeters"));
        assertEquals(true, outside.get("late"));
        assertEquals(5, outside.get("lateByMinutes"));
        assertEquals("2026-10-05T04:12:00Z", outside.get("checkInAt"));

        Map<String, Object> inside = PunchAlerts.data(alert(HQ_LAT, HQ_LNG, null, PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(HQ)),
                false, 0, "FACE_RECOGNITION", false, false, null));
        assertEquals(true, inside.get("insideZone"));
        assertEquals("Head Office", inside.get("zoneName"));
        assertNull(inside.get("distanceMeters"));
        assertNull(inside.get("lateByMinutes"));
    }

    @Test void theBuiltInWordingUsesEveryPlaceholderItNeeds() {
        Where w = PunchAlerts.where(HQ_LAT, HQ_LNG, List.of(HQ));
        Map<String, String> v = PunchAlerts.values(alert(HQ_LAT, HQ_LNG, 15.0, w, false, 0, "GPS", false, false, null));
        EventDef def = NotificationEventCatalog.byKey(PunchAlertNotifier.EVENT_KEY).orElseThrow();
        for (NotificationEventCatalog.Placeholder p : def.placeholders()) {
            assertTrue(v.containsKey(p.name()), "no value for {{" + p.name() + "}}");
        }
    }
}
