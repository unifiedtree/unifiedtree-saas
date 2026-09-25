package com.hrms.app.reports;

import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * The dashboard's "Export headcount" workbook, worked out from one company's
 * employee rows. Pure: no database, no clock, so every rule is unit-tested
 * (HeadcountWorkbookTest). {@link HeadcountWorkbookService} loads the rows.
 *
 * <p><b>Who counts on the as-of date.</b>
 * <ul>
 *   <li>Today (or later): people working now, as everywhere else in the app
 *       (LiveHeadcount): Active, On probation or On notice, plus Suspended.</li>
 *   <li>A past date: statuses aren't kept historically, so they are worked out
 *       from dates. Someone counts when they had joined by then (joining date,
 *       else the day their record was created) and hadn't left yet (a leaver's
 *       last working day is still a working day). On notice from the notice
 *       start to the last day; on probation until confirmed (or until the
 *       probation end date when no confirmation date is recorded).</li>
 * </ul>
 *
 * <p>No ids ever leave this class (not even the company's): every department,
 * branch, designation and manager is a name, and missing ones read
 * "No department" etc.
 */
public final class HeadcountWorkbook {

    private HeadcountWorkbook() {}

    static final String ACTIVE = "Active";
    static final String PROBATION = "On probation";
    static final String NOTICE = "On notice";
    static final String SUSPENDED = "Suspended";

    private static final Set<String> EXIT_STATUSES = Set.of("EXITED", "TERMINATED", "RESIGNED");

    /** One employee row as loaded (names already resolved, never ids apart from {@code id}). */
    public record Row(UUID id, String code, String firstName, String middleName, String lastName, String workEmail,
                      String gender, String employmentType, String employmentStatus, boolean active,
                      LocalDate dateOfJoining, LocalDate createdOn, LocalDate probationEndDate, LocalDate confirmationDate,
                      LocalDate noticeStartDate, LocalDate lastWorkingDay, LocalDate dateOfTermination,
                      String department, String designation, String branch, String manager) {}

    public record FiscalYear(String startMonth, LocalDate from, LocalDate to, String label) {}

    public record Totals(int total, int active, int probation, int onNotice, int suspended,
                         int joinedThisMonth, int leftThisMonth, int joinedThisFiscalYear, int leftThisFiscalYear) {}

    /** One line of a breakdown table. */
    public record Group(String name, int total, int active, int probation, int onNotice) {}

    /** One line of the Employees sheet. Dates are ISO (yyyy-MM-dd) so they sort in a spreadsheet. */
    public record Person(String employeeCode, String name, String department, String designation, String branch,
                         String employmentType, String status, String dateOfJoining, String reportingManager,
                         String workEmail, String probationEnds, String noticeLastDay) {}

    public record Workbook(String companyName, LocalDate asOf, boolean pastDate, FiscalYear fiscalYear,
                           Totals totals,
                           List<Group> byDepartment, List<Group> byBranch, List<Group> byDesignation,
                           List<Group> byEmploymentType,
                           boolean genderIncluded, List<Group> byGender,
                           boolean employeesIncluded, List<Person> employees) {}

    /**
     * @param today            the India business date (asOf is capped to it by the caller)
     * @param fiscalStartMonth the company's fiscal year start ("APRIL")
     * @param includeEmployees the caller may read employee records (hrms.employee.read)
     * @param includeGender    the caller may read the diversity report (hrms.report.diversity)
     */
    public static Workbook build(String companyName, LocalDate asOf, LocalDate today,
                                 String fiscalStartMonth, List<Row> rows,
                                 boolean includeEmployees, boolean includeGender) {
        FiscalYear fy = fiscalYear(asOf, fiscalStartMonth);
        LocalDate monthStart = asOf.withDayOfMonth(1);

        List<Row> employed = new ArrayList<>();
        Map<Row, String> status = new LinkedHashMap<>();
        int joinedMonth = 0, leftMonth = 0, joinedFy = 0, leftFy = 0;
        for (Row r : rows) {
            // A removed record (is_active = false) isn't a joiner, a leaver or headcount.
            if (!r.active()) continue;
            String s = statusOn(r, asOf, today);
            if (s != null) { employed.add(r); status.put(r, s); }
            LocalDate joined = joinedOn(r);
            if (joined != null && !joined.isAfter(asOf)) {
                if (!joined.isBefore(monthStart)) joinedMonth++;
                if (!joined.isBefore(fy.from())) joinedFy++;
            }
            LocalDate left = leftOn(r);
            if (left != null && !left.isAfter(asOf)) {
                if (!left.isBefore(monthStart)) leftMonth++;
                if (!left.isBefore(fy.from())) leftFy++;
            }
        }
        Totals totals = new Totals(employed.size(),
                count(status, ACTIVE), count(status, PROBATION), count(status, NOTICE), count(status, SUSPENDED),
                joinedMonth, leftMonth, joinedFy, leftFy);

        List<Person> people = null;
        if (includeEmployees) {
            people = employed.stream()
                    .sorted(Comparator.comparing((Row r) -> r.code() == null ? "" : r.code(), String.CASE_INSENSITIVE_ORDER))
                    .map(r -> new Person(r.code(), fullName(r), or(r.department(), "No department"),
                            or(r.designation(), "No designation"), or(r.branch(), "No branch"),
                            employmentTypeLabel(r.employmentType()), status.get(r), iso(joinedOn(r)),
                            blankToNull(r.manager()), blankToNull(r.workEmail()), iso(r.probationEndDate()),
                            iso(noticeLastDay(r))))
                    .toList();
        }
        return new Workbook(companyName, asOf, asOf.isBefore(today), fy, totals,
                groups(employed, status, r -> or(r.department(), "No department")),
                groups(employed, status, r -> or(r.branch(), "No branch")),
                groups(employed, status, r -> or(r.designation(), "No designation")),
                groups(employed, status, r -> employmentTypeLabel(r.employmentType())),
                includeGender,
                includeGender ? groups(employed, status, r -> genderLabel(r.gender())) : null,
                includeEmployees, people);
    }

    /** The person's status on {@code asOf}, or null when they weren't working there then. */
    static String statusOn(Row r, LocalDate asOf, LocalDate today) {
        String current = r.employmentStatus() == null ? "" : r.employmentStatus();
        if (!asOf.isBefore(today)) {
            if (!r.active()) return null;
            return switch (current) {
                case "ACTIVE" -> ACTIVE;
                case "PROBATION" -> PROBATION;
                case "NOTICE_PERIOD" -> NOTICE;
                case "SUSPENDED" -> SUSPENDED;
                default -> null;
            };
        }
        if (!r.active()) return null;
        LocalDate joined = joinedOn(r);
        if (joined == null || joined.isAfter(asOf)) return null;
        if (EXIT_STATUSES.contains(current)) {
            LocalDate left = leftOn(r);
            if (left == null || left.isBefore(asOf)) return null;
        }
        LocalDate lastDay = r.lastWorkingDay();
        boolean noticeKnown = "NOTICE_PERIOD".equals(current) || EXIT_STATUSES.contains(current);
        if (noticeKnown && r.noticeStartDate() != null && !r.noticeStartDate().isAfter(asOf)
                && (lastDay == null || !lastDay.isBefore(asOf))) return NOTICE;
        LocalDate confirmed = r.confirmationDate();
        if (confirmed != null && !confirmed.isAfter(asOf)) return ACTIVE;
        if ("PROBATION".equals(current)) return PROBATION;
        if (confirmed != null) return PROBATION;
        if (r.probationEndDate() != null && !r.probationEndDate().isBefore(asOf)) return PROBATION;
        return ACTIVE;
    }

    /** When they joined: the joining date, else the day the record was created. */
    static LocalDate joinedOn(Row r) {
        return r.dateOfJoining() != null ? r.dateOfJoining() : r.createdOn();
    }

    /** When a leaver left (last working day, else termination date); null for people who haven't left. */
    static LocalDate leftOn(Row r) {
        if (r.employmentStatus() == null || !EXIT_STATUSES.contains(r.employmentStatus())) return null;
        return r.lastWorkingDay() != null ? r.lastWorkingDay() : r.dateOfTermination();
    }

    /** The last working day of someone who is (or was) serving notice. */
    static LocalDate noticeLastDay(Row r) {
        String s = r.employmentStatus() == null ? "" : r.employmentStatus();
        boolean notice = r.noticeStartDate() != null || "NOTICE_PERIOD".equals(s) || EXIT_STATUSES.contains(s);
        return notice ? r.lastWorkingDay() : null;
    }

    /**
     * The fiscal year containing {@code asOf}. {@code startMonth} is the
     * company's month name; blank or unknown means April (the Indian financial
     * year, April to March). Labelled "FY 2026-27", or "FY 2026" for a year
     * that starts in January.
     */
    static FiscalYear fiscalYear(LocalDate asOf, String startMonth) {
        Month m;
        try {
            m = Month.valueOf(startMonth == null ? "" : startMonth.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException notAMonth) {
            m = Month.APRIL;
        }
        int year = asOf.getMonthValue() >= m.getValue() ? asOf.getYear() : asOf.getYear() - 1;
        LocalDate from = LocalDate.of(year, m, 1);
        LocalDate to = from.plusYears(1).minusDays(1);
        String label = m == Month.JANUARY
                ? "FY " + year
                : "FY " + year + "-" + String.format(Locale.ROOT, "%02d", (year + 1) % 100);
        return new FiscalYear(m.name(), from, to, label);
    }

    static String employmentTypeLabel(String type) {
        if (type == null || type.isBlank()) return "Not set";
        return switch (type) {
            case "FULL_TIME" -> "Full-time";
            case "PART_TIME" -> "Part-time";
            case "CONTRACT" -> "Contract";
            case "INTERN" -> "Intern";
            case "CONSULTANT" -> "Consultant";
            default -> sentence(type);
        };
    }

    static String genderLabel(String gender) {
        if (gender == null || gender.isBlank()) return "Not specified";
        return switch (gender.toUpperCase(Locale.ROOT)) {
            case "MALE" -> "Male";
            case "FEMALE" -> "Female";
            case "OTHER" -> "Other";
            case "PREFER_NOT_TO_SAY" -> "Prefer not to say";
            case "NOT_SPECIFIED" -> "Not specified";
            default -> sentence(gender);
        };
    }

    static String fullName(Row r) {
        String name = String.join(" ", java.util.stream.Stream.of(r.firstName(), r.middleName(), r.lastName())
                .filter(s -> s != null && !s.isBlank()).map(String::trim).toList());
        return name.isBlank() ? r.code() : name;
    }

    private static List<Group> groups(List<Row> employed, Map<Row, String> status, Function<Row, String> key) {
        Map<String, int[]> acc = new LinkedHashMap<>();
        for (Row r : employed) {
            int[] c = acc.computeIfAbsent(key.apply(r), k -> new int[4]);
            c[0]++;
            String s = status.get(r);
            if (ACTIVE.equals(s)) c[1]++;
            else if (PROBATION.equals(s)) c[2]++;
            else if (NOTICE.equals(s)) c[3]++;
        }
        return acc.entrySet().stream()
                .map(e -> new Group(e.getKey(), e.getValue()[0], e.getValue()[1], e.getValue()[2], e.getValue()[3]))
                .sorted(Comparator.comparingInt(Group::total).reversed().thenComparing(Group::name, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    private static int count(Map<Row, String> status, String label) {
        return (int) status.values().stream().filter(label::equals).count();
    }

    private static String sentence(String code) {
        String w = code.replace('_', ' ').trim().toLowerCase(Locale.ROOT);
        return w.isEmpty() ? w : Character.toUpperCase(w.charAt(0)) + w.substring(1);
    }

    private static String or(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v.trim();
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String iso(LocalDate d) {
        return d == null ? null : d.toString();
    }
}
