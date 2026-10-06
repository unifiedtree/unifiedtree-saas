package com.hrms.app.reports;

import java.time.LocalDate;
import java.time.Period;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Workforce Analytics' breakdowns of the headcount on a date (by branch,
 * designation, employment type, gender, age band and tenure band) and the
 * joiners per month of a period. Pure: no database, no clock, so every rule
 * is unit-tested (WorkforceBreakdownTest). {@link WorkforceBreakdownService}
 * loads the rows.
 *
 * <p>The people are exactly the headcount report's people on that date
 * (ReportService.STATUS_ON + EMPLOYED_ON, the same SQL), each already put in
 * the headcount report's bucket, so every breakdown adds up to the
 * Headcount tab's total and its active / probation / on-notice split.
 */
public final class WorkforceBreakdown {

    private WorkforceBreakdown() {}

    /** The headcount report's buckets; OTHER counts in the total only (suspended, on leave…). */
    static final String ACTIVE = "ACTIVE", PROBATION = "PROBATION", NOTICE = "NOTICE", OTHER = "OTHER";

    /** One person employed on the date, names already resolved. */
    public record Person(String bucket, String branch, String designation, String employmentType,
                         String gender, LocalDate dateOfBirth, LocalDate dateOfJoining) {}

    /** One line of a breakdown. {@code none} marks the "No branch" / "Not recorded" line. */
    public record Group(String name, boolean none, int total, int active, int probation, int onNotice) {}

    public record Breakdown(LocalDate asOf, int total, int active, int probation, int onNotice,
                            List<Group> byBranch, List<Group> byDesignation, List<Group> byEmploymentType,
                            List<Group> byAgeBand, List<Group> byTenureBand,
                            boolean genderIncluded, List<Group> byGender) {}

    /** Age bands, youngest first: [label, lowest age, highest age]. */
    static final String[] AGE_BANDS = {"Under 25", "25–34", "35–44", "45–54", "55 and over"};
    /** Tenure bands, newest first. */
    static final String[] TENURE_BANDS = {"Under 6 months", "6–12 months", "1–3 years", "3–5 years", "5–10 years", "10 years and over"};
    static final String NOT_RECORDED = "Not recorded";

    /**
     * @param includeGender the caller may read the diversity report (hrms.report.diversity);
     *                      without it the gender breakdown is left out (null)
     */
    public static Breakdown build(LocalDate asOf, List<Person> people, boolean includeGender) {
        int active = 0, probation = 0, notice = 0;
        for (Person p : people) {
            if (ACTIVE.equals(p.bucket())) active++;
            else if (PROBATION.equals(p.bucket())) probation++;
            else if (NOTICE.equals(p.bucket())) notice++;
        }
        return new Breakdown(asOf, people.size(), active, probation, notice,
                byName(people, Person::branch, "No branch"),
                byName(people, Person::designation, "No designation"),
                byName(people, p -> blank(p.employmentType()) ? null : HeadcountWorkbook.employmentTypeLabel(p.employmentType()), "Not set"),
                banded(people, p -> ageBand(p.dateOfBirth(), asOf), AGE_BANDS),
                banded(people, p -> tenureBand(p.dateOfJoining(), asOf), TENURE_BANDS),
                includeGender,
                includeGender ? byName(people, p -> blank(p.gender()) || "NOT_SPECIFIED".equalsIgnoreCase(p.gender())
                        ? null : HeadcountWorkbook.genderLabel(p.gender()), "Not specified") : null);
    }

    /** The age band on {@code asOf}; null when the date of birth is missing or not before the date. */
    static String ageBand(LocalDate dob, LocalDate asOf) {
        if (dob == null || !dob.isBefore(asOf)) return null;
        int age = Period.between(dob, asOf).getYears();
        if (age < 25) return AGE_BANDS[0];
        if (age < 35) return AGE_BANDS[1];
        if (age < 45) return AGE_BANDS[2];
        if (age < 55) return AGE_BANDS[3];
        return AGE_BANDS[4];
    }

    /** Completed time since joining on {@code asOf}; null without a joining date. */
    static String tenureBand(LocalDate joined, LocalDate asOf) {
        if (joined == null || joined.isAfter(asOf)) return null;
        long months = Period.between(joined, asOf).toTotalMonths();
        if (months < 6) return TENURE_BANDS[0];
        if (months < 12) return TENURE_BANDS[1];
        if (months < 36) return TENURE_BANDS[2];
        if (months < 60) return TENURE_BANDS[3];
        if (months < 120) return TENURE_BANDS[4];
        return TENURE_BANDS[5];
    }

    /**
     * Joiners per month, one entry for every month from {@code from}'s to
     * {@code to}'s (months without joiners have 0, so a chart has no gaps).
     * A joiner is someone whose joining date falls in the month, up to
     * {@code today} (people hired ahead of their start date are not joiners
     * yet), as the attrition report counts a month up to today.
     */
    public static List<Map<String, Object>> joinersPerMonth(List<LocalDate> joiningDates, LocalDate from, LocalDate to, LocalDate today) {
        Map<YearMonth, Integer> perMonth = new LinkedHashMap<>();
        for (YearMonth m = YearMonth.from(from); !m.isAfter(YearMonth.from(to)); m = m.plusMonths(1)) perMonth.put(m, 0);
        for (LocalDate d : joiningDates) {
            if (d == null || d.isAfter(today)) continue;
            perMonth.computeIfPresent(YearMonth.from(d), (k, v) -> v + 1);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        perMonth.forEach((m, n) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("month", m.toString());
            row.put("joined", n);
            out.add(row);
        });
        return out;
    }

    // ── grouping ─────────────────────────────────────────────────────────────

    /** Biggest first, then by name; the missing-value line ({@code fallback}) last. */
    private static List<Group> byName(List<Person> people, Function<Person, String> key, String fallback) {
        Map<String, int[]> acc = new LinkedHashMap<>();
        for (Person p : people) add(acc, blank(key.apply(p)) ? null : key.apply(p).trim(), p);
        List<Group> named = new ArrayList<>();
        acc.forEach((name, c) -> { if (name != null) named.add(group(name, false, c)); });
        named.sort(Comparator.comparingInt(Group::total).reversed().thenComparing(Group::name, String.CASE_INSENSITIVE_ORDER));
        int[] none = acc.get(null);
        if (none != null) named.add(group(fallback, true, none));
        return named;
    }

    /** Every band in its own order (empty bands included, so the shape reads), then "Not recorded" when anyone has no date. */
    private static List<Group> banded(List<Person> people, Function<Person, String> band, String[] bands) {
        Map<String, int[]> acc = new LinkedHashMap<>();
        for (String b : bands) acc.put(b, new int[4]);
        for (Person p : people) add(acc, band.apply(p), p);
        List<Group> out = new ArrayList<>();
        for (String b : bands) out.add(group(b, false, acc.get(b)));
        int[] none = acc.get(null);
        if (none != null) out.add(group(NOT_RECORDED, true, none));
        return out;
    }

    private static void add(Map<String, int[]> acc, String key, Person p) {
        int[] c = acc.computeIfAbsent(key, k -> new int[4]);
        c[0]++;
        if (ACTIVE.equals(p.bucket())) c[1]++;
        else if (PROBATION.equals(p.bucket())) c[2]++;
        else if (NOTICE.equals(p.bucket())) c[3]++;
    }

    private static Group group(String name, boolean none, int[] c) {
        return new Group(name, none, c[0], c[1], c[2], c[3]);
    }

    private static boolean blank(String v) {
        return v == null || v.isBlank();
    }
}
