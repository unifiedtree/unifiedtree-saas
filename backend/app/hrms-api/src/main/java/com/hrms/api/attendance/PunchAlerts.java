package com.hrms.api.attendance;

import com.unifiedtree.notifications.enums.AppNotificationType;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * The decisions behind a punch-in alert (V143.72), kept free of the database so
 * they can be tested on their own: who gets it, where the punch was, and what
 * the alert says. {@link PunchAlertNotifier} loads the facts and sends it.
 */
final class PunchAlerts {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** The most people one punch-in alerts: a safety limit, far above any real list. */
    static final int MAX_RECIPIENTS = 100;
    /** An offline punch is called out as "sent later" only past this gap. */
    static final Duration OFFLINE_NOTE_AFTER = Duration.ofMinutes(5);
    /** Where a tap opens in the mobile app: the Alerts list (the app opens the map itself). */
    static final String MOBILE_ROUTE = "/notifications";

    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(IST);
    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final double EARTH_RADIUS_METERS = 6_371_000.0;

    private PunchAlerts() {}

    // ── who gets it ─────────────────────────────────────────────────────────

    /**
     * Someone who might get the alert, as the database knows them.
     *
     * @param companyId the company they work in
     * @param working   still working here (active, on probation, serving notice or on long leave)
     * @param hasLogin  has an active login, so there is someone to read the alert
     */
    record Candidate(UUID employeeId, UUID companyId, boolean working, boolean hasLogin) {
        boolean reachable() {
            return employeeId != null && working && hasLogin;
        }
    }

    /**
     * Who gets the alert, in order (manager, picked people, role holders), each
     * once, never the person who punched, at most {@link #MAX_RECIPIENTS}.
     * <ul>
     *   <li>Nobody when the company asked only for late or outside punch-ins and
     *       this one is neither ({@code exception} false).</li>
     *   <li>The reporting manager when the company left that on; they may work in
     *       another company of the workspace (the reporting line is the person's
     *       own, set by HR).</li>
     *   <li>Picked people and role holders only from the punch's own company.</li>
     *   <li>Only people still working here who have a login.</li>
     * </ul>
     * Every candidate was read inside the punch's workspace (tenant), so nobody
     * from another workspace can be among them.
     */
    static List<UUID> recipients(PunchAlertSettingsService.Rules rules, UUID employeeId, UUID companyId,
                                 Candidate manager, Collection<Candidate> people, Collection<Candidate> roleHolders,
                                 boolean exception) {
        if (rules == null) return List.of();
        if (rules.onlyExceptions() && !exception) return List.of();
        Set<UUID> out = new LinkedHashSet<>();
        if (rules.notifyManager() && manager != null && manager.reachable()) out.add(manager.employeeId());
        for (Collection<Candidate> list : java.util.Arrays.asList(people, roleHolders)) {
            if (list == null) continue;
            for (Candidate c : list) {
                if (c != null && c.reachable() && companyId != null && companyId.equals(c.companyId())) out.add(c.employeeId());
            }
        }
        out.remove(employeeId);
        return out.stream().limit(MAX_RECIPIENTS).toList();
    }

    /**
     * A punch-in the "only late or outside the office" choice reports: a late
     * one, or (unless it's an approved work-from-home day or the person may punch
     * from anywhere) one outside every office, or one with no location at all.
     */
    static boolean isException(boolean late, Where where, boolean wfhDay, boolean anywhere) {
        if (late) return true;
        if (wfhDay || anywhere) return false;
        return where == null || !where.located() || where.outside();
    }

    // ── where it was ────────────────────────────────────────────────────────

    /**
     * An office zone or a branch with a position and a radius.
     *
     * @param own the person's own work area (their assigned zone, else their branch)
     */
    record Place(String name, double latitude, double longitude, int radiusMeters, boolean own) {}

    /**
     * Where a punch was, against the company's places.
     *
     * @param zoneName       the place it was inside (null when outside or unknown)
     * @param distanceMeters from the nearest place, when outside every place
     * @param nearestName    that nearest place
     */
    record Where(boolean located, boolean inside, String zoneName, Integer distanceMeters, String nearestName) {
        /** Outside every office the company has set up (false when it has none, or the location is unknown). */
        boolean outside() {
            return located && !inside && nearestName != null;
        }

        /** "At Head Office", "Outside office, about 350 m from Head Office", "Location not shared". */
        String text() {
            if (!located) return "Location not shared";
            if (inside) return "At " + zoneName;
            if (nearestName != null) return "Outside office, about " + distanceText(distanceMeters) + " from " + nearestName;
            return "Office location not set up";
        }
    }

    /**
     * Matches a position against the places: the person's own area when they are
     * inside it, else the closest place they are inside, else the closest place
     * and how far it is. Places without a usable position are ignored.
     */
    static Where where(Double latitude, Double longitude, List<Place> places) {
        if (!PunchRulesService.hasLocation(latitude, longitude)) return new Where(false, false, null, null, null);
        Place insideOwn = null, inside = null, nearest = null;
        double insideDist = Double.MAX_VALUE, nearestDist = Double.MAX_VALUE;
        for (Place p : places == null ? List.<Place>of() : places) {
            if (p == null || p.name() == null || p.name().isBlank() || !PunchRulesService.hasLocation(p.latitude(), p.longitude())) continue;
            double d = distanceMeters(latitude, longitude, p.latitude(), p.longitude());
            if (d <= Math.max(1, p.radiusMeters())) {
                if (p.own() && insideOwn == null) insideOwn = p;
                if (d < insideDist) { inside = p; insideDist = d; }
            }
            if (d < nearestDist) { nearest = p; nearestDist = d; }
        }
        Place at = insideOwn != null ? insideOwn : inside;
        if (at != null) return new Where(true, true, at.name().trim(), null, null);
        if (nearest == null) return new Where(true, false, null, null, null);
        return new Where(true, false, null, (int) Math.round(nearestDist), nearest.name().trim());
    }

    /** "350 m" (to the nearest 10 m), "1.2 km", "23 km". */
    static String distanceText(Integer meters) {
        if (meters == null) return "an unknown distance";
        if (meters < 1000) return Math.max(10, Math.round(meters / 10.0) * 10) + " m";
        if (meters < 10_000) return String.format(Locale.ENGLISH, "%.1f km", meters / 1000.0);
        return Math.round(meters / 1000.0) + " km";
    }

    static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── what it says ────────────────────────────────────────────────────────

    /** How they punched in, as the alert says it. {@code assistedBy}: who punched for them, when someone did. */
    static String methodText(String method, boolean assisted, String assistedBy) {
        if (assisted) {
            String who = assistedBy == null || assistedBy.isBlank() ? "their manager" : assistedBy.trim();
            return "Punched in for them by " + who + " with a face scan";
        }
        String m = method == null ? "" : method.toUpperCase(Locale.ROOT);
        return switch (m) {
            case "WEB" -> "Web check-in with a face scan";
            case "FACE_RECOGNITION" -> "Face scan in the app";
            case "GPS" -> "Location check-in in the app";
            case "PIN" -> "PIN in the app";
            case "BIOMETRIC_DEVICE" -> "Biometric device";
            default -> "Check-in from the app";
        };
    }

    /** "9:42 am" in IST. */
    static String clock(Instant at) {
        return at == null ? "" : CLOCK.format(at).replace("AM", "am").replace("PM", "pm");
    }

    /** "https://www.google.com/maps?q=17.385040,78.486670", or null without a location. */
    static String mapUrl(Double latitude, Double longitude) {
        if (!PunchRulesService.hasLocation(latitude, longitude)) return null;
        return "https://www.google.com/maps?q=" + coordinate(latitude) + "," + coordinate(longitude);
    }

    /** "17.385040, 78.486670 (±15 m)", or "" without a location. */
    static String coordinates(Double latitude, Double longitude, Double accuracyMeters) {
        if (!PunchRulesService.hasLocation(latitude, longitude)) return "";
        String at = coordinate(latitude) + ", " + coordinate(longitude);
        if (accuracyMeters != null && Double.isFinite(accuracyMeters) && accuracyMeters > 0) {
            at += " (±" + Math.max(1, Math.round(accuracyMeters)) + " m)";
        }
        return at;
    }

    private static String coordinate(double v) {
        return String.format(Locale.ROOT, "%.6f", v);
    }

    /** Everything the alert needs to say, worked out by the notifier. */
    record Alert(UUID attendanceRecordId, UUID employeeId, String employeeName, LocalDate attendanceDate,
                 Instant checkInAt, Instant receivedAt, boolean offline, String method, boolean assisted, String assistedBy,
                 Double latitude, Double longitude, Double accuracyMeters, Where where,
                 boolean late, Integer lateByMinutes, boolean wfhDay) {}

    /** The catalog's placeholders for attendance.punch_in_alert. */
    static Map<String, String> values(Alert a) {
        Map<String, String> v = new HashMap<>();
        v.put("employeeName", a.employeeName() == null || a.employeeName().isBlank() ? "An employee" : a.employeeName());
        v.put("time", clock(a.checkInAt()));
        v.put("date", a.attendanceDate() == null ? "" : LONG.format(a.attendanceDate()));
        String place = a.where() == null ? "Location not shared" : a.where().text();
        if (a.wfhDay()) place += " (work-from-home day)";
        v.put("place", place);
        v.put("lateText", a.late() && a.lateByMinutes() != null && a.lateByMinutes() > 0
                ? " · " + a.lateByMinutes() + " min late" : a.late() ? " · late" : "");
        v.put("method", methodText(a.method(), a.assisted(), a.assistedBy()));
        String coords = coordinates(a.latitude(), a.longitude(), a.accuracyMeters());
        v.put("coordinates", coords);
        v.put("coordinatesText", coords.isEmpty() ? "" : " Location: " + coords + ".");
        String url = mapUrl(a.latitude(), a.longitude());
        v.put("mapLink", url == null ? "" : url);
        v.put("offlineText", sentLate(a) ? " The phone was offline; this reached us at " + clock(a.receivedAt()) + "." : "");
        return v;
    }

    /** The payload stored with the alert and sent with the push: ids, the place and the map link. */
    static Map<String, Object> data(Alert a) {
        Map<String, Object> d = new HashMap<>();
        d.put("type", AppNotificationType.PUNCH_IN_ALERT.name());
        d.put("route", MOBILE_ROUTE);
        d.put("employeeId", str(a.employeeId()));
        d.put("employeeName", a.employeeName());
        d.put("attendanceRecordId", str(a.attendanceRecordId()));
        d.put("attendanceDate", a.attendanceDate() == null ? null : a.attendanceDate().toString());
        d.put("checkInAt", a.checkInAt() == null ? null : a.checkInAt().toString());
        d.put("method", a.method());
        d.put("assisted", a.assisted());
        d.put("assistedByName", a.assisted() ? a.assistedBy() : null);
        boolean located = PunchRulesService.hasLocation(a.latitude(), a.longitude());
        d.put("latitude", located ? a.latitude() : null);
        d.put("longitude", located ? a.longitude() : null);
        d.put("accuracyMeters", located && a.accuracyMeters() != null && Double.isFinite(a.accuracyMeters())
                ? (double) Math.round(a.accuracyMeters()) : null);
        d.put("mapUrl", mapUrl(a.latitude(), a.longitude()));
        Where w = a.where();
        d.put("insideZone", w != null && w.inside());
        d.put("zoneName", w != null && w.inside() ? w.zoneName() : null);
        d.put("distanceMeters", w != null && !w.inside() ? w.distanceMeters() : null);
        d.put("nearestZoneName", w != null && !w.inside() ? w.nearestName() : null);
        d.put("place", w == null ? "Location not shared" : w.text());
        d.put("late", a.late());
        d.put("lateByMinutes", a.late() ? a.lateByMinutes() : null);
        d.put("wfhDay", a.wfhDay());
        d.put("offline", sentLate(a));
        return d;
    }

    /** An offline punch that reached the server noticeably after it was made. */
    static boolean sentLate(Alert a) {
        return a.offline() && a.checkInAt() != null && a.receivedAt() != null
                && Duration.between(a.checkInAt(), a.receivedAt()).compareTo(OFFLINE_NOTE_AFTER) > 0;
    }

    private static String str(UUID id) {
        return id == null ? null : id.toString();
    }

    /** Distinct, non-null ids in their first order. */
    static List<UUID> distinct(Collection<UUID> ids) {
        if (ids == null) return List.of();
        return new ArrayList<>(new LinkedHashSet<>(ids.stream().filter(Objects::nonNull).toList()));
    }
}
