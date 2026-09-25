package com.hrms.api.hiring;

import com.hrms.core.exception.BusinessRuleException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The rules for scheduling interviews and scoring them, kept free of any
 * database access so they can be tested on their own.
 */
public final class InterviewRules {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    public static final List<String> DEFAULT_CRITERIA = List.of("Role knowledge", "Problem solving", "Communication", "Culture fit");
    public static final Set<String> MODES = Set.of("IN_PERSON", "VIDEO", "PHONE");
    public static final List<String> RECOMMENDATIONS = List.of("STRONG_YES", "YES", "NO", "STRONG_NO");
    /** Stages at which an interview can be booked: a screening call or the interview rounds. */
    public static final Set<String> SCHEDULABLE_STAGES = Set.of("SCREENING", "INTERVIEW");
    public static final int MAX_INTERVIEWERS = 10;
    public static final int MAX_CRITERIA = 10;

    private InterviewRules() {}

    /** What HR fills in to book or change an interview. {@code scheduledAt} is IST wall-clock time. */
    public record Schedule(String title, LocalDateTime scheduledAt, Integer durationMinutes, String mode,
                           String location, List<UUID> interviewerIds, List<String> criteria, String notes) {}

    /** The cleaned-up version the service stores. */
    public record CleanSchedule(String title, Instant scheduledAt, int durationMinutes, String mode,
                                String location, List<UUID> interviewerIds, List<String> criteria, String notes) {}

    public static Instant istToInstant(LocalDateTime ist) {
        return ist.atZone(IST).toInstant();
    }

    public static LocalDateTime instantToIst(Instant at) {
        return LocalDateTime.ofInstant(at, IST);
    }

    public static void assertStageAllowsScheduling(String stage) {
        if (stage == null || !SCHEDULABLE_STAGES.contains(stage)) {
            throw new BusinessRuleException(
                    "Interviews can be scheduled while the candidate is in Screening or Interview. Move the candidate to one of those stages first.",
                    "INTERVIEW_STAGE_INVALID");
        }
    }

    public static CleanSchedule clean(Schedule s, Instant now) {
        return clean(s, now, null);
    }

    /**
     * @param keepTime the interview's current start when it is being changed:
     *                 keeping that time is allowed even once it has passed, so
     *                 HR can still fix the panel (for example add the person who
     *                 actually took the interview, so they can file a scorecard).
     *                 A new time must still be in the future.
     */
    public static CleanSchedule clean(Schedule s, Instant now, Instant keepTime) {
        if (s == null) throw new BusinessRuleException("Interview details are required", "INTERVIEW_FIELDS_REQUIRED");
        String title = trimToNull(s.title());
        if (title == null) title = "Interview";
        if (title.length() > 120) throw new BusinessRuleException("Keep the interview name under 120 characters", "INTERVIEW_TITLE_TOO_LONG");

        if (s.scheduledAt() == null) throw new BusinessRuleException("Choose the interview date and time", "INTERVIEW_TIME_REQUIRED");
        Instant at = istToInstant(s.scheduledAt()).truncatedTo(ChronoUnit.MINUTES);
        boolean unchanged = keepTime != null && at.equals(keepTime.truncatedTo(ChronoUnit.MINUTES));
        if (unchanged) at = keepTime; // not a change, so nobody is told it moved
        else if (!at.isAfter(now)) throw new BusinessRuleException("The interview time must be in the future", "INTERVIEW_TIME_PAST");
        if (at.isAfter(now.plus(366, ChronoUnit.DAYS))) throw new BusinessRuleException("Schedule the interview within the next year", "INTERVIEW_TIME_TOO_FAR");

        int duration = s.durationMinutes() == null ? 45 : s.durationMinutes();
        if (duration < 15 || duration > 480) throw new BusinessRuleException("An interview lasts between 15 minutes and 8 hours", "INTERVIEW_DURATION_INVALID");

        String mode = s.mode() == null ? "" : s.mode().trim().toUpperCase(Locale.ROOT);
        if (!MODES.contains(mode)) throw new BusinessRuleException("Choose how the interview happens: in person, video call or phone", "INTERVIEW_MODE_INVALID");

        String location = trimToNull(s.location());
        if (location != null && location.length() > 500) throw new BusinessRuleException("Keep the location or link under 500 characters", "INTERVIEW_LOCATION_TOO_LONG");
        if (mode.equals("IN_PERSON") && location == null) throw new BusinessRuleException("Add where the in-person interview happens", "INTERVIEW_LOCATION_REQUIRED");
        if (mode.equals("VIDEO")) {
            if (location == null) throw new BusinessRuleException("Add the video call link", "INTERVIEW_LINK_REQUIRED");
            String lower = location.toLowerCase(Locale.ROOT);
            if (!(lower.startsWith("https://") || lower.startsWith("http://")) || location.contains(" "))
                throw new BusinessRuleException("The video call link must be a web address starting with https://", "INTERVIEW_LINK_INVALID");
        }

        List<UUID> interviewers = s.interviewerIds() == null ? List.of()
                : new ArrayList<>(new LinkedHashSet<>(s.interviewerIds().stream().filter(java.util.Objects::nonNull).toList()));
        if (interviewers.isEmpty()) throw new BusinessRuleException("Choose at least one interviewer", "INTERVIEW_INTERVIEWERS_REQUIRED");
        if (interviewers.size() > MAX_INTERVIEWERS) throw new BusinessRuleException("An interview can have up to " + MAX_INTERVIEWERS + " interviewers", "INTERVIEW_TOO_MANY_INTERVIEWERS");

        String notes = trimToNull(s.notes());
        if (notes != null && notes.length() > 2000) throw new BusinessRuleException("Keep the notes under 2000 characters", "INTERVIEW_NOTES_TOO_LONG");

        return new CleanSchedule(title, at, duration, mode, location, List.copyOf(interviewers), criteria(s.criteria()), notes);
    }

    /** Trimmed, de-duplicated (ignoring case) criteria; none given means the default four. */
    public static List<String> criteria(List<String> raw) {
        Map<String, String> seen = new LinkedHashMap<>();
        if (raw != null) {
            for (String c : raw) {
                String t = trimToNull(c);
                if (t == null) continue;
                if (t.length() > 80) throw new BusinessRuleException("Keep each criterion under 80 characters", "INTERVIEW_CRITERION_TOO_LONG");
                seen.putIfAbsent(t.toLowerCase(Locale.ROOT), t);
            }
        }
        if (seen.isEmpty()) return DEFAULT_CRITERIA;
        if (seen.size() > MAX_CRITERIA) throw new BusinessRuleException("Use at most " + MAX_CRITERIA + " criteria", "INTERVIEW_TOO_MANY_CRITERIA");
        return List.copyOf(seen.values());
    }

    public record Rating(String criterion, Integer rating) {}

    /**
     * Every criterion of the interview rated 1-5, nothing else; the overall
     * rating is their average to two decimals.
     */
    public static BigDecimal overall(List<String> criteria, List<Rating> ratings) {
        if (ratings == null || ratings.isEmpty()) throw new BusinessRuleException("Rate every criterion from 1 to 5", "SCORECARD_RATINGS_REQUIRED");
        Map<String, Integer> byName = new LinkedHashMap<>();
        for (Rating r : ratings) {
            if (r == null || r.criterion() == null) throw new BusinessRuleException("Each rating needs its criterion", "SCORECARD_RATING_INVALID");
            String match = criteria.stream().filter(c -> c.equalsIgnoreCase(r.criterion().trim())).findFirst()
                    .orElseThrow(() -> new BusinessRuleException("\"" + r.criterion() + "\" is not a criterion of this interview", "SCORECARD_CRITERION_UNKNOWN"));
            if (r.rating() == null || r.rating() < 1 || r.rating() > 5) throw new BusinessRuleException("Ratings go from 1 to 5", "SCORECARD_RATING_RANGE");
            if (byName.putIfAbsent(match, r.rating()) != null) throw new BusinessRuleException("\"" + match + "\" is rated twice", "SCORECARD_RATING_DUPLICATE");
        }
        for (String c : criteria) {
            if (!byName.containsKey(c)) throw new BusinessRuleException("Rate \"" + c + "\" too", "SCORECARD_RATING_MISSING");
        }
        int sum = byName.values().stream().mapToInt(Integer::intValue).sum();
        return BigDecimal.valueOf(sum).divide(BigDecimal.valueOf(byName.size()), 2, RoundingMode.HALF_UP);
    }

    public static String recommendation(String raw) {
        String r = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT).replace(' ', '_');
        if (!RECOMMENDATIONS.contains(r)) throw new BusinessRuleException("Choose a recommendation: strong yes, yes, no or strong no", "SCORECARD_RECOMMENDATION_INVALID");
        return r;
    }

    /** Scorecard summary for a candidate: how many, the average overall rating, and the recommendation tally. */
    public record Summary(int count, BigDecimal averageRating, Map<String, Integer> recommendations) {}

    public static Summary summarise(List<BigDecimal> overallRatings, List<String> recommendations) {
        Map<String, Integer> tally = new LinkedHashMap<>();
        RECOMMENDATIONS.forEach(r -> tally.put(r, 0));
        recommendations.forEach(r -> tally.computeIfPresent(r, (k, v) -> v + 1));
        if (overallRatings.isEmpty()) return new Summary(0, null, tally);
        BigDecimal sum = overallRatings.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        return new Summary(overallRatings.size(), sum.divide(BigDecimal.valueOf(overallRatings.size()), 2, RoundingMode.HALF_UP), tally);
    }

    /** What an update changes for the interviewers: who is new, who was removed, and whether the others must be told. */
    public record Diff(List<UUID> added, List<UUID> removed, List<UUID> kept, boolean detailsChanged) {}

    public static Diff diff(List<UUID> before, List<UUID> after, boolean timeOrPlaceChanged) {
        List<UUID> added = after.stream().filter(id -> !before.contains(id)).toList();
        List<UUID> removed = before.stream().filter(id -> !after.contains(id)).toList();
        List<UUID> kept = after.stream().filter(before::contains).toList();
        return new Diff(added, removed, kept, timeOrPlaceChanged);
    }

    static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
