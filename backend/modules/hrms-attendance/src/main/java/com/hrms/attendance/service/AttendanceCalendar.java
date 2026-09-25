package com.hrms.attendance.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The attendance calendar rules both attendance services share, so the live
 * service ({@link AttendanceService}) and the alternate JDBC one
 * ({@code CanonicalAttendanceService}, profile {@code canonical-jdbc-api}) can't
 * disagree about a day.
 *
 * <ul>
 *   <li><b>Weekly offs:</b> the person's own {@code hrms.employees.weekly_off_days};
 *       when that's empty, their company's weekly offs from HR Configuration
 *       ({@code settings.hr_configuration.weekend_days}, the setting leave uses);
 *       Saturday and Sunday only when neither is set.</li>
 *   <li><b>A day with no punch:</b> a weekly off, a future day, a day before the
 *       person's attendance started, a holiday or approved leave is never an
 *       absence. <b>Today</b> isn't either until it's over: it's "not marked".</li>
 * </ul>
 * Everything reads under the caller's tenant (RLS), so call it inside a transaction.
 */
public final class AttendanceCalendar {

    /** ISO day numbers (1 = Monday … 7 = Sunday). */
    public static final Set<Integer> DEFAULT_OFF_DAYS =
            Set.of(DayOfWeek.SATURDAY.getValue(), DayOfWeek.SUNDAY.getValue());

    private AttendanceCalendar() {
    }

    /** "6,7" → {6, 7}. Blank, junk and out-of-range tokens are ignored; empty when nothing is left. */
    public static Set<Integer> parseOffDays(String csv) {
        Set<Integer> out = new HashSet<>();
        if (csv == null || csv.isBlank()) return out;
        for (String tok : csv.split(",")) {
            try {
                int d = Integer.parseInt(tok.trim());
                if (d >= 1 && d <= 7) out.add(d);
            } catch (NumberFormatException ignored) {
                // skip junk
            }
        }
        return out;
    }

    /** The first non-empty of the person's own days and their company's; Saturday and Sunday otherwise. */
    public static Set<Integer> pickOffDays(String employeeDays, String companyDays) {
        Set<Integer> own = parseOffDays(employeeDays);
        if (!own.isEmpty()) return own;
        Set<Integer> company = parseOffDays(companyDays);
        return company.isEmpty() ? DEFAULT_OFF_DAYS : company;
    }

    /** One person's weekly off days (see the class notes). Saturday and Sunday on any lookup failure. */
    public static Set<Integer> weeklyOffDays(JdbcTemplate jdbc, UUID employeeId) {
        if (jdbc == null || employeeId == null) return DEFAULT_OFF_DAYS;
        return weeklyOffDays(jdbc, List.of(employeeId)).getOrDefault(employeeId, DEFAULT_OFF_DAYS);
    }

    /** Weekly off days for many people in one query. Anyone not found gets Saturday and Sunday. */
    public static Map<UUID, Set<Integer>> weeklyOffDays(JdbcTemplate jdbc, Collection<UUID> employeeIds) {
        Map<UUID, Set<Integer>> out = new HashMap<>();
        if (employeeIds == null || employeeIds.isEmpty()) return out;
        for (UUID id : employeeIds) out.put(id, DEFAULT_OFF_DAYS);
        if (jdbc == null) return out;
        String in = String.join(",", Collections.nCopies(employeeIds.size(), "?"));
        try {
            jdbc.query("SELECT e.id, e.weekly_off_days, array_to_string(hc.weekend_days, ',') AS company_days "
                            + "FROM hrms.employees e "
                            + "LEFT JOIN settings.hr_configuration hc "
                            + "  ON hc.company_id = e.company_id AND hc.tenant_id = e.tenant_id "
                            + "WHERE e.id IN (" + in + ")",
                    (RowCallbackHandler) rs -> out.put((UUID) rs.getObject("id"),
                            pickOffDays(rs.getString("weekly_off_days"), rs.getString("company_days"))),
                    employeeIds.toArray());
        } catch (RuntimeException ex) {
            // keep Saturday and Sunday
        }
        return out;
    }

    /** Active company holidays (Settings → Holidays) in [start, end] for the person's company. Empty on failure. */
    public static Set<LocalDate> holidayDates(JdbcTemplate jdbc, UUID employeeId, LocalDate start, LocalDate end) {
        Set<LocalDate> dates = new HashSet<>();
        if (jdbc == null || employeeId == null) return dates;
        try {
            jdbc.query("SELECT h.holiday_date FROM settings.holiday_calendar h "
                            + "JOIN hrms.employees e ON e.company_id = h.company_id AND e.tenant_id = h.tenant_id "
                            + "WHERE e.id = ? AND h.is_active = TRUE AND h.holiday_date BETWEEN ? AND ?",
                    (RowCallbackHandler) rs -> dates.add(rs.getDate("holiday_date").toLocalDate()),
                    employeeId, java.sql.Date.valueOf(start), java.sql.Date.valueOf(end));
        } catch (RuntimeException ex) {
            // no holiday overlay
        }
        return dates;
    }

    /** Days in [start, end] covered by the person's APPROVED leave. Empty on failure. */
    public static Set<LocalDate> approvedLeaveDates(JdbcTemplate jdbc, UUID employeeId, LocalDate start, LocalDate end) {
        Set<LocalDate> dates = new HashSet<>();
        if (jdbc == null || employeeId == null) return dates;
        try {
            jdbc.query("SELECT start_date, end_date FROM leave_mgmt.leave_requests "
                            + "WHERE employee_id = ? AND status = 'APPROVED' AND start_date <= ? AND end_date >= ?",
                    (RowCallbackHandler) rs -> {
                        LocalDate s = rs.getDate("start_date").toLocalDate();
                        LocalDate e = rs.getDate("end_date").toLocalDate();
                        LocalDate d = s.isBefore(start) ? start : s;
                        LocalDate last = e.isAfter(end) ? end : e;
                        while (!d.isAfter(last)) {
                            dates.add(d);
                            d = d.plusDays(1);
                        }
                    },
                    employeeId, java.sql.Date.valueOf(end), java.sql.Date.valueOf(start));
        } catch (RuntimeException ex) {
            // no leave overlay
        }
        return dates;
    }

    /**
     * Where counting starts: the later of the joining date and the first punch
     * ever. With no punch ever, today (there's nothing to judge before it).
     */
    public static LocalDate attendanceStart(LocalDate joining, LocalDate firstRecord, LocalDate today) {
        if (firstRecord == null) return today;
        return joining != null && joining.isAfter(firstRecord) ? joining : firstRecord;
    }

    /** {@link #attendanceStart(LocalDate, LocalDate, LocalDate)} read from the database. */
    public static LocalDate attendanceStart(JdbcTemplate jdbc, UUID employeeId, LocalDate today) {
        if (jdbc == null || employeeId == null) return today;
        LocalDate joining = null;
        LocalDate first = null;
        try {
            java.sql.Date d = jdbc.queryForObject(
                    "SELECT date_of_joining FROM hrms.employees WHERE id = ?", java.sql.Date.class, employeeId);
            joining = d != null ? d.toLocalDate() : null;
        } catch (RuntimeException ignored) {
            // unknown joining date
        }
        try {
            java.sql.Date d = jdbc.queryForObject(
                    "SELECT MIN(attendance_date) FROM attendance.records WHERE employee_id = ?", java.sql.Date.class, employeeId);
            first = d != null ? d.toLocalDate() : null;
        } catch (RuntimeException ignored) {
            // no records
        }
        return attendanceStart(joining, first, today);
    }

    /** What a day is, before the punch itself is judged on time or late. */
    public enum DayKind {
        /** One of the person's weekly offs (a punch on it still counts its hours). */
        WEEKLY_OFF,
        /** Later than today. */
        UPCOMING,
        /** Before the person's attendance started: nothing to judge. */
        NOT_TRACKED,
        /** Has a check-in. */
        PUNCHED,
        HOLIDAY,
        ON_LEAVE,
        /** Today with no punch yet: not an absence until the day is over. */
        NOT_MARKED,
        ABSENT
    }

    /**
     * Classifies one day, in the order the weekly summary uses: weekly off,
     * future, before attendance started, punched, holiday, leave, then today
     * (not marked) or an earlier day (absent).
     */
    public static DayKind classify(LocalDate day, LocalDate today, LocalDate attendanceStart,
                                   boolean weeklyOff, boolean punched, boolean holiday, boolean onLeave) {
        if (weeklyOff) return DayKind.WEEKLY_OFF;
        if (day.isAfter(today)) return DayKind.UPCOMING;
        if (attendanceStart != null && day.isBefore(attendanceStart)) return DayKind.NOT_TRACKED;
        if (punched) return DayKind.PUNCHED;
        if (holiday) return DayKind.HOLIDAY;
        if (onLeave) return DayKind.ON_LEAVE;
        return day.equals(today) ? DayKind.NOT_MARKED : DayKind.ABSENT;
    }
}
