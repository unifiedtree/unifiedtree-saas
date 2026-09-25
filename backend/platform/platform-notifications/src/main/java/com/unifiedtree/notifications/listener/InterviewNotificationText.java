package com.unifiedtree.notifications.listener;

import com.unifiedtree.notifications.events.InterviewNotificationEvent;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Wording of the interview notifications. Times are always shown in IST. */
public final class InterviewNotificationText {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH);

    private InterviewNotificationText() {}

    public static String title(String kind) {
        return switch (kind == null ? "" : kind) {
            case "RESCHEDULED" -> "Interview changed";
            case "CANCELLED" -> "Interview cancelled";
            case "REMOVED" -> "You're no longer on an interview";
            default -> "You're interviewing a candidate";
        };
    }

    /** "Priya Sharma for Senior Engineer · Technical round · Sat 26 Sep, 10:30 am IST (45 min) · Video call" */
    public static String body(InterviewNotificationEvent e) {
        StringBuilder b = new StringBuilder();
        b.append(e.candidateName() == null || e.candidateName().isBlank() ? "A candidate" : e.candidateName().trim());
        if (e.roleTitle() != null && !e.roleTitle().isBlank()) b.append(" for ").append(e.roleTitle().trim());
        if (e.interviewTitle() != null && !e.interviewTitle().isBlank()) b.append(" · ").append(e.interviewTitle().trim());
        if (e.scheduledAt() != null) {
            b.append(" · ").append(WHEN.format(e.scheduledAt().atZone(IST)).replace("AM", "am").replace("PM", "pm")).append(" IST");
            if (e.durationMinutes() > 0) b.append(" (").append(e.durationMinutes()).append(" min)");
        }
        String mode = modeLabel(e.mode());
        if (mode != null) b.append(" · ").append(mode);
        String kind = e.kind() == null ? "" : e.kind();
        if (kind.equals("CANCELLED")) b.append(". It has been cancelled.");
        else if (kind.equals("REMOVED")) b.append(". You have been taken off this interview.");
        else if (e.location() != null && !e.location().isBlank()) b.append(" · ").append(e.location().trim());
        return b.toString();
    }

    /**
     * Placeholder values for the interview events (NotificationEventCatalog
     * hiring.interview_*). {{details}} is the body without the closing sentence
     * the cancelled / removed wording adds, so the built-in text reads exactly
     * as {@link #body} does.
     */
    public static java.util.Map<String, String> values(InterviewNotificationEvent e) {
        java.util.Map<String, String> v = new java.util.HashMap<>();
        String body = body(e);
        String kind = e.kind() == null ? "" : e.kind();
        String details = body;
        String cancelled = ". It has been cancelled.", removed = ". You have been taken off this interview.";
        if (kind.equals("CANCELLED") && body.endsWith(cancelled)) details = body.substring(0, body.length() - cancelled.length());
        if (kind.equals("REMOVED") && body.endsWith(removed)) details = body.substring(0, body.length() - removed.length());
        v.put("details", details);
        v.put("candidateName", e.candidateName() == null || e.candidateName().isBlank() ? "A candidate" : e.candidateName().trim());
        v.put("roleTitle", e.roleTitle() == null ? "" : e.roleTitle().trim());
        v.put("interviewTitle", e.interviewTitle() == null ? "" : e.interviewTitle().trim());
        v.put("when", e.scheduledAt() == null ? "" : WHEN.format(e.scheduledAt().atZone(IST)).replace("AM", "am").replace("PM", "pm") + " IST");
        v.put("durationMinutes", e.durationMinutes() > 0 ? String.valueOf(e.durationMinutes()) : "");
        String mode = modeLabel(e.mode());
        v.put("mode", mode == null ? "" : mode);
        v.put("location", e.location() == null ? "" : e.location().trim());
        return v;
    }

    static String modeLabel(String mode) {
        if (mode == null) return null;
        return switch (mode) {
            case "IN_PERSON" -> "In person";
            case "VIDEO" -> "Video call";
            case "PHONE" -> "Phone call";
            default -> null;
        };
    }
}
