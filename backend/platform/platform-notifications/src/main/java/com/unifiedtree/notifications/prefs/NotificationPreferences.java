package com.unifiedtree.notifications.prefs;

import com.unifiedtree.notifications.template.DeliveryChannel;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import com.unifiedtree.notifications.template.NotificationEventCatalog.EventDef;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The preference gate: given an event and a person's saved choices
 * ({@code auth.user_credentials.notification_preferences}), which channels
 * may carry it. Pure logic, covered by {@code NotificationPreferencesTest}.
 *
 * <p>Stored shape (every key optional; missing means the default):
 * <pre>
 * { "emailEnabled": true,          // master switch for email   (Profile)
 *   "pushEnabled":  true,          // master switch for phone push (Profile)
 *   "events": { "leave.submitted": { "inApp": true, "push": false, "email": true } } }
 * </pre>
 *
 * <p>Rules:
 * <ul>
 *   <li><b>Essential</b> events (password reset, invitation, billing, letters HR
 *       sends on purpose) and <b>external</b> ones (a candidate's offer) ignore
 *       preferences and go out on every channel they use.</li>
 *   <li>Email needs the email master switch AND the event's email choice.
 *       Events that are in-app first only email people who opt in; reminders
 *       that were always emails stay on until switched off.</li>
 *   <li>Push needs the push master switch AND the event's push choice.</li>
 *   <li>In-app (the bell) follows the event's in-app choice only.</li>
 * </ul>
 */
public final class NotificationPreferences {

    public static final String EMAIL_ENABLED = "emailEnabled";
    public static final String PUSH_ENABLED = "pushEnabled";
    public static final String EVENTS = "events";

    /** Channels a notification may use for one person. */
    public record Delivery(boolean inApp, boolean push, boolean email) {
        public boolean any() { return inApp || push || email; }
    }

    private NotificationPreferences() {}

    public static Delivery decide(EventDef def, Map<String, Object> prefs) {
        if (def == null) return new Delivery(true, true, false);
        if (def.essential() || def.external()) {
            return new Delivery(def.has(DeliveryChannel.IN_APP), def.has(DeliveryChannel.PUSH), def.has(DeliveryChannel.EMAIL));
        }
        boolean inApp = def.has(DeliveryChannel.IN_APP) && eventChoice(def, prefs, DeliveryChannel.IN_APP);
        boolean push = def.has(DeliveryChannel.PUSH) && masterOn(prefs, PUSH_ENABLED)
                && eventChoice(def, prefs, DeliveryChannel.PUSH);
        boolean email = def.has(DeliveryChannel.EMAIL) && masterOn(prefs, EMAIL_ENABLED)
                && eventChoice(def, prefs, DeliveryChannel.EMAIL);
        return new Delivery(inApp, push, email);
    }

    /** A master switch; on unless explicitly false. */
    public static boolean masterOn(Map<String, Object> prefs, String key) {
        Boolean b = bool(prefs == null ? null : prefs.get(key));
        return b == null || b;
    }

    /**
     * The person's choice for one event on one channel, ignoring the master
     * switches (what the per-event switch shows). Defaults: in-app and push
     * on; email on only for events that were always emailed.
     */
    public static boolean eventChoice(EventDef def, Map<String, Object> prefs, DeliveryChannel channel) {
        if (def.essential() || def.external()) return def.has(channel);
        Map<String, Object> ev = eventPrefs(prefs, def);
        Boolean b = ev == null ? null : bool(ev.get(field(channel)));
        if (b != null) return b;
        return channel != DeliveryChannel.EMAIL || def.emailByDefault();
    }

    /**
     * Applies a change on top of the stored preferences and returns the new
     * map to store. Anything not mentioned is kept.
     *
     * @throws IllegalArgumentException with a plain-English message when the
     *         change names an unknown event, a channel the event doesn't use,
     *         or tries to switch off something that is always sent
     */
    public static Map<String, Object> merge(Map<String, Object> stored, Boolean emailEnabled, Boolean pushEnabled,
                                            Map<String, Map<String, Boolean>> events) {
        Map<String, Object> out = stored == null ? new LinkedHashMap<>() : new LinkedHashMap<>(stored);
        if (emailEnabled != null) out.put(EMAIL_ENABLED, emailEnabled);
        if (pushEnabled != null) out.put(PUSH_ENABLED, pushEnabled);
        if (events == null || events.isEmpty()) return out;

        Map<String, Object> allEvents = new LinkedHashMap<>();
        Object existing = out.get(EVENTS);
        if (existing instanceof Map<?, ?> m) m.forEach((k, v) -> allEvents.put(String.valueOf(k), v));

        for (Map.Entry<String, Map<String, Boolean>> change : events.entrySet()) {
            EventDef def = NotificationEventCatalog.byKey(change.getKey())
                    .orElseThrow(() -> new IllegalArgumentException("There is no notification called \"" + change.getKey() + "\"."));
            if (def.external()) {
                throw new IllegalArgumentException("\"" + def.label() + "\" goes to people outside the workspace, so it has no personal setting.");
            }
            Map<String, Object> current = new LinkedHashMap<>();
            Object cur = allEvents.get(def.key());
            if (cur instanceof Map<?, ?> cm) cm.forEach((k, v) -> current.put(String.valueOf(k), v));
            if (change.getValue() == null) continue;
            for (Map.Entry<String, Boolean> ch : change.getValue().entrySet()) {
                DeliveryChannel channel = channelOf(ch.getKey());
                if (channel == null || !def.has(channel)) {
                    throw new IllegalArgumentException("\"" + def.label() + "\" isn't sent by " + ch.getKey() + ".");
                }
                if (ch.getValue() == null) continue;
                if (def.essential() && !ch.getValue()) {
                    throw new IllegalArgumentException("\"" + def.label() + "\" is always sent and can't be switched off.");
                }
                if (!def.essential()) current.put(field(channel), ch.getValue());
            }
            if (!current.isEmpty()) allEvents.put(def.key(), current);
        }
        out.put(EVENTS, allEvents);
        return out;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    public static String field(DeliveryChannel c) {
        return switch (c) {
            case IN_APP -> "inApp";
            case PUSH -> "push";
            case EMAIL -> "email";
        };
    }

    static DeliveryChannel channelOf(String field) {
        if (field == null) return null;
        return switch (field) {
            case "inApp", "IN_APP" -> DeliveryChannel.IN_APP;
            case "push", "PUSH" -> DeliveryChannel.PUSH;
            case "email", "EMAIL" -> DeliveryChannel.EMAIL;
            default -> null;
        };
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> eventPrefs(Map<String, Object> prefs, EventDef def) {
        if (prefs == null) return null;
        Object events = prefs.get(EVENTS);
        if (!(events instanceof Map<?, ?> m)) return null;
        Object ev = m.get(def.key());
        if (ev == null && def.alias() != null) ev = m.get(def.alias());
        return ev instanceof Map<?, ?> ? (Map<String, Object>) ev : null;
    }

    private static Boolean bool(Object v) {
        if (v instanceof Boolean b) return b;
        if (v instanceof String s) {
            if ("true".equalsIgnoreCase(s.trim())) return Boolean.TRUE;
            if ("false".equalsIgnoreCase(s.trim())) return Boolean.FALSE;
        }
        return null;
    }
}
