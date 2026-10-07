package com.hrms.app.reports;

import com.hrms.core.exception.BusinessRuleException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * The Reports Center's and Workforce analytics' small numbers (redesign
 * P-REPORTS): the headcount change between two dates (BW-86), one small series
 * per report for the tiles (BW-87), the month-end headcount trend and the
 * company's fiscal year (BW-88).
 *
 * <p>Every figure is read through {@link ReportService}, the same queries the
 * report pages use, so a tile or a hero number always agrees with the report
 * it opens. Every query there filters every table by the request's tenant.
 * Each series of the summary comes back only when the caller holds that
 * report's own permission (the same code its report endpoint checks); a
 * series the caller may not read is left out of the answer altogether.
 */
@Service
public class ReportInsightsService {

    static final String HEADCOUNT = "hrms.report.headcount";
    static final String ATTRITION = "hrms.report.attrition";
    static final String DIVERSITY = "hrms.report.diversity";
    static final String ATTENDANCE = "hrms.report.attendance";
    static final String LEAVE = "hrms.report.leave";

    /** Days on the attendance tile and the late marks tile. */
    static final int ATTENDANCE_DAYS = 7, LATE_DAYS = 14;
    /** Months on the attrition tile. */
    static final int ATTRITION_MONTHS = 6;
    /** The trend's longest reach. */
    static final int MAX_TREND_MONTHS = 24;

    private final ReportService reports;
    private final JdbcTemplate jdbc;

    public ReportInsightsService(ReportService reports, JdbcTemplate jdbc) {
        this.reports = reports;
        this.jdbc = jdbc;
    }

    // ── BW-86: headcount change ──────────────────────────────────────────────

    /**
     * Headcount on {@code from} and on {@code to} (the headcount report's own
     * totals for those dates), the change between them, and who joined and
     * who left in between (after {@code from}, up to and including {@code to};
     * no joining date: the day the record was created, as the headcount report).
     */
    @Transactional(readOnly = true)
    public Map<String, Object> headcountChange(UUID companyId, LocalDate from, LocalDate to) {
        if (from == null || to == null) throw new BusinessRuleException("Choose both dates", "REPORT_DATES");
        if (from.isAfter(to)) throw new BusinessRuleException("The start date comes after the end date", "REPORT_DATES");
        long before = total(reports.headcountReport(companyId, from));
        long after = total(reports.headcountReport(companyId, to));
        UUID t = ReportService.tenant();
        Map<String, Object> moved = jdbc.queryForMap("""
                SELECT COUNT(*) FILTER (WHERE COALESCE(e.date_of_joining, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date) > ?
                                          AND COALESCE(e.date_of_joining, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date) <= ?) AS joined,
                       COUNT(*) FILTER (WHERE e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED')
                                          AND COALESCE(e.last_working_day, e.date_of_termination) > ?
                                          AND COALESCE(e.last_working_day, e.date_of_termination) <= ?) AS left_count
                  FROM hrms.employees e
                 WHERE e.tenant_id = ?
                   AND e.company_id = ?
                """, from, to, from, to, t, companyId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", from.toString());
        out.put("to", to.toString());
        out.put("headcountFrom", before);
        out.put("headcountTo", after);
        out.put("change", after - before);
        out.put("joined", num(moved.get("joined")));
        out.put("left", num(moved.get("left_count")));
        return out;
    }

    // ── BW-88: headcount trend ───────────────────────────────────────────────

    /**
     * Headcount at each month's end for the {@code months} months ending with
     * {@code to}'s month; that last month is counted on {@code to} itself
     * (today by default). Each point is the headcount report's total for that
     * date, so the newest point equals the Headcount tab's figure.
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> headcountTrend(UUID companyId, int months, LocalDate to, LocalDate today) {
        int n = Math.max(1, Math.min(MAX_TREND_MONTHS, months));
        LocalDate end = to == null || to.isAfter(today) ? today : to;
        YearMonth last = YearMonth.from(end);
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = n - 1; i >= 0; i--) {
            YearMonth ym = last.minusMonths(i);
            LocalDate asOf = i == 0 ? end : ym.atEndOfMonth();
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("month", ym.toString());
            p.put("asOf", asOf.toString());
            p.put("headcount", total(reports.headcountReport(companyId, asOf)));
            out.add(p);
        }
        return out;
    }

    // ── BW-88: fiscal year ───────────────────────────────────────────────────

    /** The company's fiscal year that contains {@code asOf} (its start month from the company record). */
    public Map<String, Object> fiscalYear(UUID companyId, LocalDate asOf) {
        // The company record holds the start month (blank or unknown = April, as everywhere else).
        String start = jdbc.query("SELECT fiscal_year_start FROM org.companies WHERE id = ? AND tenant_id = ?",
                rs -> rs.next() ? rs.getString(1) : null, companyId, ReportService.tenant());
        HeadcountWorkbook.FiscalYear fy = HeadcountWorkbook.fiscalYear(asOf, start);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("startMonth", fy.startMonth());
        out.put("from", fy.from().toString());
        out.put("to", fy.to().toString());
        out.put("label", fy.label());
        return out;
    }

    // ── BW-87: the tiles' small series ───────────────────────────────────────

    /**
     * One small series per report, each only when {@code can} says the caller
     * holds that report's permission:
     * <ul>
     *   <li>headcount: today's people per department (the headcount report);</li>
     *   <li>attrition: the last six months' rate (the attrition report);</li>
     *   <li>diversity: today's women / men / other (the diversity report);</li>
     *   <li>attendance: people who came in on each of the last seven days,
     *       counted as the attendance summary counts present days;</li>
     *   <li>lateMarks: late marks on each of the last fourteen days (the late
     *       marks report's rows, by day);</li>
     *   <li>leaveBalance: this year's entitlement, used, pending and available
     *       days in total (the leave balance report).</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public Map<String, Object> summary(UUID companyId, LocalDate today, Predicate<String> can) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("companyId", companyId);
        out.put("asOf", today.toString());
        if (can.test(HEADCOUNT)) out.put("headcount", headcountSeries(reports.headcountReport(companyId, today)));
        if (can.test(ATTRITION)) {
            LocalDate from = today.withDayOfMonth(1).minusMonths(ATTRITION_MONTHS - 1L);
            out.put("attrition", attritionSeries(reports.attritionReport(companyId, from, today)));
        }
        if (can.test(DIVERSITY)) out.put("diversity", diversitySeries(reports.diversityReport(companyId)));
        if (can.test(ATTENDANCE)) {
            LocalDate from = today.minusDays(ATTENDANCE_DAYS - 1L);
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("from", from.toString());
            a.put("to", today.toString());
            a.put("days", reports.attendanceDaily(companyId, from, today));
            out.put("attendance", a);
            LocalDate lateFrom = today.minusDays(LATE_DAYS - 1L);
            out.put("lateMarks", lateSeries(reports.lateMarksReport(companyId, lateFrom, today), lateFrom, today));
        }
        if (can.test(LEAVE)) out.put("leaveBalance", leaveSeries(reports.leaveBalanceReport(companyId, today.getYear()), today.getYear()));
        return out;
    }

    static Map<String, Object> headcountSeries(List<Map<String, Object>> rows) {
        List<Map<String, Object>> depts = new ArrayList<>();
        long total = 0;
        for (Map<String, Object> r : rows) {
            long n = num(r.get("total"));
            total += n;
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("departmentId", r.get("department_id"));
            d.put("name", r.get("department"));
            d.put("count", n);
            depts.add(d);
        }
        // Biggest first; people without a department last.
        depts.sort((a, b) -> a.get("name") == null ? 1 : b.get("name") == null ? -1 : Long.compare(num(b.get("count")), num(a.get("count"))));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", total);
        out.put("departments", depts);
        return out;
    }

    static Map<String, Object> attritionSeries(List<Map<String, Object>> rows) {
        List<Map<String, Object>> months = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("month", r.get("month"));
            m.put("exits", num(r.get("exits")));
            m.put("headcount", num(r.get("headcount")));
            m.put("pct", dbl(r.get("attrition_pct")));
            months.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("months", months);
        return out;
    }

    static Map<String, Object> diversitySeries(List<Map<String, Object>> rows) {
        long women = 0, men = 0, other = 0;
        for (Map<String, Object> r : rows) {
            long n = num(r.get("count"));
            String g = r.get("gender") == null ? "NOT_SPECIFIED" : String.valueOf(r.get("gender"));
            if ("FEMALE".equals(g)) women += n;
            else if ("MALE".equals(g)) men += n;
            else other += n;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("women", women);
        out.put("men", men);
        out.put("other", other);
        out.put("total", women + men + other);
        return out;
    }

    static Map<String, Object> lateSeries(List<Map<String, Object>> rows, LocalDate from, LocalDate to) {
        Map<LocalDate, Long> perDay = new TreeMap<>();
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) perDay.put(d, 0L);
        for (Map<String, Object> r : rows) {
            LocalDate day = date(r.get("attendance_date"));
            if (day != null) perDay.computeIfPresent(day, (k, v) -> v + 1);
        }
        List<Map<String, Object>> days = new ArrayList<>();
        perDay.forEach((day, n) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date", day.toString());
            m.put("count", n);
            days.add(m);
        });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", from.toString());
        out.put("to", to.toString());
        out.put("days", days);
        return out;
    }

    static Map<String, Object> leaveSeries(List<Map<String, Object>> rows, int year) {
        double entitlement = 0, used = 0, pending = 0, available = 0;
        for (Map<String, Object> r : rows) {
            entitlement += dbl(r.get("total_entitlement")) + dbl(r.get("carry_forward"));
            used += dbl(r.get("used"));
            pending += dbl(r.get("pending"));
            available += dbl(r.get("available"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("year", year);
        out.put("entitlement", round(entitlement));
        out.put("used", round(used));
        out.put("pending", round(pending));
        out.put("available", round(available));
        return out;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    static long total(List<Map<String, Object>> headcountRows) {
        return headcountRows.stream().mapToLong(r -> num(r.get("total"))).sum();
    }

    private static long num(Object v) {
        return v instanceof Number n ? n.longValue() : v == null ? 0 : Long.parseLong(v.toString());
    }

    private static double dbl(Object v) {
        return v instanceof Number n ? n.doubleValue() : v == null ? 0 : Double.parseDouble(v.toString());
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static LocalDate date(Object v) {
        if (v instanceof java.sql.Date d) return d.toLocalDate();
        if (v instanceof LocalDate d) return d;
        return v == null ? null : LocalDate.parse(v.toString().substring(0, 10));
    }
}
