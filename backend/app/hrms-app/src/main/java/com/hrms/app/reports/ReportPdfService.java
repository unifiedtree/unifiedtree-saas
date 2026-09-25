package com.hrms.app.reports;

import com.hrms.app.reports.ReportHtml.Bar;
import com.hrms.app.reports.ReportHtml.Kpi;
import com.hrms.app.reports.ReportHtml.Legend;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Server-side PDFs of the six reports and the Workforce Analytics snapshot:
 * the same numbers, KPIs, charts and tables as the report pages, rendered on
 * the server so a download is a real file (and a scheduled email can carry it).
 *
 * <p>Reads through {@link ReportService}, so the queries (and tenant RLS) are
 * exactly the ones the screens use. Permission checks stay on the callers:
 * each download route carries its report's own permission, and Workforce
 * Analytics includes only the sections {@code held} allows.
 */
@Service
public class ReportPdfService {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH);
    private static final String[] MON = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

    private final ReportService reports;
    private final JdbcTemplate jdbc;

    public ReportPdfService(ReportService reports, JdbcTemplate jdbc) {
        this.reports = reports;
        this.jdbc = jdbc;
    }

    /** The filters a report takes; unused ones are null. */
    public record Params(UUID companyId, LocalDate from, LocalDate to, LocalDate asOf, Integer year) {}

    /** A rendered report: the bytes, a file name, how many table rows it holds, and the company it is for. */
    public record Rendered(byte[] bytes, String fileName, int rowCount, String companyName) {}

    /**
     * @param held        the caller's permissions (Workforce Analytics shows only the sections they allow)
     * @param generatedBy the line under the title, e.g. "Downloaded by Asha Rao"
     */
    @Transactional(readOnly = true)
    public Rendered render(ReportKind kind, Params p, Set<String> held, String generatedBy) {
        String company = companyName(p.companyId());
        String stamp = "Generated " + STAMP.format(ZonedDateTime.now(IST)).replace("AM", "am").replace("PM", "pm") + " IST"
                + (generatedBy == null || generatedBy.isBlank() ? "" : " · " + generatedBy);
        String footer = company + " · " + kind.label();
        return switch (kind) {
            case HEADCOUNT -> headcount(p, company, stamp, footer);
            case ATTRITION -> attrition(p, company, stamp, footer);
            case ATTENDANCE_SUMMARY -> attendance(p, company, stamp, footer);
            case LEAVE_BALANCE -> leave(p, company, stamp, footer);
            case LATE_MARKS -> lateMarks(p, company, stamp, footer);
            case DIVERSITY -> diversity(p, company, stamp, footer);
            case WORKFORCE_ANALYTICS -> analytics(p, company, stamp, footer, held);
            default -> throw new IllegalArgumentException(kind.label() + " has no PDF");
        };
    }

    // ── Headcount ────────────────────────────────────────────────────────────

    private Rendered headcount(Params p, String company, String stamp, String footer) {
        LocalDate asOf = p.asOf();
        List<Dept> depts = depts(reports.headcountReport(p.companyId(), asOf));
        Dept t = Dept.sumOf(depts);
        long named = depts.stream().filter(d -> !d.none()).count();
        ReportHtml h = new ReportHtml("Headcount report", company + " · as of " + day(asOf), stamp, footer, false)
                .kpis(List.of(
                        new Kpi("Total headcount", num(t.total()), named + (named == 1 ? " department" : " departments")),
                        new Kpi("Active", num(t.active()), pctOf(t.active(), t.total()) + "% of headcount"),
                        new Kpi("On notice", num(t.notice()), pctOf(t.notice(), t.total()) + "% of headcount"),
                        new Kpi("On probation", num(t.probation()), pctOf(t.probation(), t.total()) + "% of headcount")));
        h.bars("Headcount by department", null, HEAD_LEGEND, depts.stream()
                .map(d -> new Bar(d.name(), List.of((double) d.active(), (double) d.notice(), (double) d.probation()), num(d.total()), d.none())).toList());
        h.table("Departments", List.of("Department", "Total", "Active", "On notice", "Probation", "Share %"),
                depts.stream().map(d -> List.<Object>of(d.name(), num(d.total()), num(d.active()), num(d.notice()), num(d.probation()), pctOf(d.total(), t.total()))).toList(),
                List.of("Total", num(t.total()), num(t.active()), num(t.notice()), num(t.probation()), 100), Set.of(1, 2, 3, 4, 5));
        h.note("Status on " + day(asOf) + ": someone still to leave counts as on notice. People who have left by that date are not counted.");
        return new Rendered(h.pdf(), "headcount-" + slug(company) + "-" + asOf + ".pdf", depts.size(), company);
    }

    private static final List<Legend> HEAD_LEGEND = List.of(new Legend("Active", ReportHtml.GREEN), new Legend("On notice", ReportHtml.MINT), new Legend("Probation", ReportHtml.PALE));

    record Dept(UUID id, String name, boolean none, long total, long active, long notice, long probation) {
        static Dept sumOf(List<Dept> all) {
            return new Dept(null, "Total", false, all.stream().mapToLong(Dept::total).sum(), all.stream().mapToLong(Dept::active).sum(),
                    all.stream().mapToLong(Dept::notice).sum(), all.stream().mapToLong(Dept::probation).sum());
        }
    }

    static List<Dept> depts(List<Map<String, Object>> rows) {
        List<Dept> out = new ArrayList<>(rows.stream().map(r -> new Dept(
                (UUID) r.get("department_id"), r.get("department") == null ? "No department" : String.valueOf(r.get("department")),
                r.get("department") == null, lng(r.get("total")), lng(r.get("active")), lng(r.get("on_notice")), lng(r.get("probation")))).toList());
        out.sort(Comparator.comparing(Dept::none).thenComparing(Comparator.comparingLong(Dept::total).reversed()));
        return out;
    }

    // ── Attrition ────────────────────────────────────────────────────────────

    private Rendered attrition(Params p, String company, String stamp, String footer) {
        List<Map<String, Object>> rows = reports.attritionReport(p.companyId(), p.from(), p.to());
        long exits = rows.stream().mapToLong(r -> lng(r.get("exits"))).sum();
        long term = rows.stream().mapToLong(r -> lng(r.get("terminations"))).sum();
        double avg = rows.isEmpty() ? 0 : rows.stream().mapToDouble(r -> dbl(r.get("attrition_pct"))).average().orElse(0);
        Map<String, Object> peak = rows.stream().max(Comparator.comparingDouble(r -> dbl(r.get("attrition_pct")))).orElse(null);
        String range = rows.isEmpty() ? day(p.from()) + " – " + day(p.to()) : month(rows.get(0).get("month")) + " – " + month(rows.get(rows.size() - 1).get("month"));
        boolean peakHasExits = peak != null && lng(peak.get("exits")) > 0;
        ReportHtml h = new ReportHtml("Attrition report", company + " · " + range, stamp, footer, false)
                .kpis(List.of(
                        new Kpi("Exits in range", num(exits), range),
                        new Kpi("Average monthly attrition", one(avg) + "%", rows.size() + (rows.size() == 1 ? " month" : " months")),
                        new Kpi("Highest month", peakHasExits ? one(dbl(peak.get("attrition_pct"))) + "%" : "—",
                                peakHasExits ? month(peak.get("month")) + " · " + lng(peak.get("exits")) + " exits" : "No exits in range"),
                        new Kpi("Terminations", num(term), exits > 0 ? Math.round(term * 100.0 / exits) + "% of exits" : "No exits in range")));
        h.bars("Monthly attrition", range, List.of(new Legend("Attrition %", ReportHtml.GREEN)), rows.stream()
                .map(r -> new Bar(month(r.get("month")), List.of(dbl(r.get("attrition_pct"))), one(dbl(r.get("attrition_pct"))) + "%", false)).toList());
        h.table("Months", List.of("Month", "Exits", "Resigned", "Terminated", "Other", "Headcount", "Attrition %"),
                rows.stream().map(r -> List.<Object>of(month(r.get("month")), num(lng(r.get("exits"))), num(lng(r.get("resignations"))), num(lng(r.get("terminations"))),
                        num(lng(r.get("other_exits"))), num(lng(r.get("headcount"))), one(dbl(r.get("attrition_pct"))))).toList(),
                List.of("Total", num(exits), num(rows.stream().mapToLong(r -> lng(r.get("resignations"))).sum()), num(term),
                        num(rows.stream().mapToLong(r -> lng(r.get("other_exits"))).sum()), "", one(avg) + " avg"),
                Set.of(1, 2, 3, 4, 5, 6));
        h.note("Exits are dated by the person's last working day. Attrition is exits over the month's average headcount.");
        return new Rendered(h.pdf(), "attrition-" + slug(company) + "-" + p.from() + "_" + p.to() + ".pdf", rows.size(), company);
    }

    // ── Attendance summary ───────────────────────────────────────────────────

    private Rendered attendance(Params p, String company, String stamp, String footer) {
        List<Map<String, Object>> rows = reports.attendanceSummaryReport(p.companyId(), p.from(), p.to());
        long present = rows.stream().mapToLong(r -> lng(r.get("present_days"))).sum();
        long late = rows.stream().mapToLong(r -> lng(r.get("late_days"))).sum();
        long ot = rows.stream().mapToLong(r -> lng(r.get("total_overtime_mins"))).sum();
        String range = day(p.from()) + " – " + day(p.to());
        ReportHtml h = new ReportHtml("Attendance summary", company + " · " + range, stamp, footer, true)
                .kpis(List.of(
                        new Kpi("People", num(rows.size()), num(present) + " days present in all"),
                        new Kpi("Average present days", rows.isEmpty() ? "—" : one((double) present / rows.size()), range),
                        new Kpi("Late days", num(late), present > 0 ? Math.round(late * 100.0 / present) + "% of present days" : "No days present"),
                        new Kpi("Overtime recorded", hm(ot), "Approval-only, not paid")));
        Map<String, long[]> byDept = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            long[] d = byDept.computeIfAbsent(dept(r.get("department")), k -> new long[2]);
            long pr = lng(r.get("present_days")), lt = lng(r.get("late_days"));
            d[0] += Math.max(0, pr - lt);
            d[1] += lt;
        }
        h.bars("Present days by department", null, List.of(new Legend("On time", ReportHtml.GREEN), new Legend("Late", ReportHtml.MINT)),
                byDept.entrySet().stream().sorted((a, b) -> Long.compare(b.getValue()[0] + b.getValue()[1], a.getValue()[0] + a.getValue()[1]))
                        .map(e -> new Bar(e.getKey(), List.of((double) e.getValue()[0], (double) e.getValue()[1]), num(e.getValue()[0] + e.getValue()[1]), "No department".equals(e.getKey()))).toList());
        h.table("People", List.of("Code", "Name", "Department", "Present days", "Late days", "Avg hours", "Overtime (recorded)"),
                rows.stream().map(r -> List.<Object>of(str(r.get("employee_code")), str(r.get("employee_name")), dept(r.get("department")), num(lng(r.get("present_days"))),
                        num(lng(r.get("late_days"))), r.get("avg_hours") == null ? "" : two(dbl(r.get("avg_hours"))), hm(lng(r.get("total_overtime_mins"))))).toList(),
                null, Set.of(3, 4, 5, 6));
        h.note("Active people only. Overtime is what was recorded; it is approval-only and not paid through payroll.");
        return new Rendered(h.pdf(), "attendance-summary-" + slug(company) + "-" + p.from() + "_" + p.to() + ".pdf", rows.size(), company);
    }

    // ── Leave balance ────────────────────────────────────────────────────────

    private Rendered leave(Params p, String company, String stamp, String footer) {
        int year = p.year() == null ? LocalDate.now(IST).getYear() : p.year();
        List<Map<String, Object>> rows = reports.leaveBalanceReport(p.companyId(), year);
        double ent = sum(rows, "total_entitlement"), cf = sum(rows, "carry_forward"), used = sum(rows, "used"), pending = sum(rows, "pending"), avail = sum(rows, "available");
        long people = rows.stream().map(r -> r.get("employee_code")).distinct().count();
        Map<String, double[]> byType = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            double[] t = byType.computeIfAbsent(typeLabel(str(r.get("leave_type"))), k -> new double[3]);
            t[0] += dbl(r.get("used"));
            t[1] += dbl(r.get("pending"));
            t[2] += Math.max(0, dbl(r.get("available")));
        }
        ReportHtml h = new ReportHtml("Leave balance report", company + " · leave year " + year, stamp, footer, true)
                .kpis(List.of(
                        new Kpi("People", num(people), byType.size() + (byType.size() == 1 ? " leave type" : " leave types")),
                        new Kpi("Days available", d1(avail), "of " + d1(ent + cf) + " entitled + carried"),
                        new Kpi("Days used", d1(used), "In " + year),
                        new Kpi("Pending approval", d1(pending), "Requested, not yet decided")));
        h.bars("Leave by type", String.valueOf(year), List.of(new Legend("Used", ReportHtml.GREEN), new Legend("Pending", ReportHtml.MINT), new Legend("Available", ReportHtml.PALE)),
                byType.entrySet().stream().map(e -> new Bar(e.getKey(), List.of(e.getValue()[0], e.getValue()[1], e.getValue()[2]), d1(e.getValue()[0] + e.getValue()[1] + e.getValue()[2]), false)).toList());
        h.table("Balances", List.of("Code", "Name", "Department", "Leave type", "Entitled", "Carried forward", "Used", "Pending", "Available"),
                rows.stream().map(r -> List.<Object>of(str(r.get("employee_code")), str(r.get("employee_name")), dept(r.get("department")), typeLabel(str(r.get("leave_type"))),
                        d1(dbl(r.get("total_entitlement"))), d1(dbl(r.get("carry_forward"))), d1(dbl(r.get("used"))), d1(dbl(r.get("pending"))), d1(dbl(r.get("available"))))).toList(),
                List.of("Total", "", "", "", d1(ent), d1(cf), d1(used), d1(pending), d1(avail)), Set.of(4, 5, 6, 7, 8));
        return new Rendered(h.pdf(), "leave-balance-" + slug(company) + "-" + year + ".pdf", rows.size(), company);
    }

    // ── Late marks ───────────────────────────────────────────────────────────

    private Rendered lateMarks(Params p, String company, String stamp, String footer) {
        List<Map<String, Object>> rows = new ArrayList<>(reports.lateMarksReport(p.companyId(), p.from(), p.to()));
        rows.sort(Comparator.comparing((Map<String, Object> r) -> str(r.get("attendance_date"))).reversed()
                .thenComparing(Comparator.comparingLong((Map<String, Object> r) -> lng(r.get("late_by_minutes"))).reversed()));
        long total = rows.stream().mapToLong(r -> lng(r.get("late_by_minutes"))).sum();
        Map<String, long[]> people = new LinkedHashMap<>();
        Map<String, String> names = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String code = str(r.get("employee_code"));
            long[] x = people.computeIfAbsent(code, k -> new long[2]);
            x[0]++;
            x[1] += lng(r.get("late_by_minutes"));
            names.putIfAbsent(code, str(r.get("employee_name")));
        }
        Map.Entry<String, long[]> most = people.entrySet().stream()
                .max(Comparator.comparingLong((Map.Entry<String, long[]> e) -> e.getValue()[0]).thenComparingLong(e -> e.getValue()[1])).orElse(null);
        Map<String, Long> perDay = new java.util.TreeMap<>();
        for (Map<String, Object> r : rows) perDay.merge(str(r.get("attendance_date")), 1L, Long::sum);
        String range = day(p.from()) + " – " + day(p.to());
        ReportHtml h = new ReportHtml("Late marks report", company + " · " + range, stamp, footer, false)
                .kpis(List.of(
                        new Kpi("Late marks", num(rows.size()), range),
                        new Kpi("People late", num(people.size()), people.isEmpty() ? "—" : one((double) rows.size() / people.size()) + " marks each on average"),
                        new Kpi("Average lateness", rows.isEmpty() ? "—" : mins(Math.round((double) total / rows.size())), mins(total) + " in all"),
                        new Kpi("Most often late", most == null ? "—" : names.get(most.getKey()),
                                most == null ? "" : most.getValue()[0] + (most.getValue()[0] == 1 ? " time" : " times") + " · " + mins(most.getValue()[1]))));
        h.bars("Late marks per day", null, List.of(new Legend("Late marks", ReportHtml.GREEN)), perDay.entrySet().stream()
                .map(e -> new Bar(dayShort(e.getKey()), List.of((double) e.getValue()), num(e.getValue()), false)).toList());
        h.table("Late arrivals", List.of("Date", "Code", "Name", "Department", "Check-in (IST)", "Late by (min)"),
                rows.stream().map(r -> List.<Object>of(dayOf(r.get("attendance_date")), str(r.get("employee_code")), str(r.get("employee_name")), dept(r.get("department")),
                        clock(r.get("check_in_at")), num(lng(r.get("late_by_minutes"))))).toList(),
                null, Set.of(5));
        h.note("A check-in is late after its shift's start plus that shift's grace.");
        return new Rendered(h.pdf(), "late-marks-" + slug(company) + "-" + p.from() + "_" + p.to() + ".pdf", rows.size(), company);
    }

    // ── Diversity ────────────────────────────────────────────────────────────

    private static final List<String[]> GENDERS = List.of(
            new String[]{"FEMALE", "Women", ReportHtml.GREEN}, new String[]{"MALE", "Men", ReportHtml.MINT},
            new String[]{"OTHER", "Other", "#6ee7b7"}, new String[]{"PREFER_NOT_TO_SAY", "Prefer not to say", ReportHtml.PALE},
            new String[]{"NOT_SPECIFIED", "Not specified", "#d1fae5"});

    private Rendered diversity(Params p, String company, String stamp, String footer) {
        Gender g = gender(reports.diversityReport(p.companyId()));
        long people = g.totals().values().stream().mapToLong(Long::longValue).sum();
        long women = g.totals().getOrDefault("FEMALE", 0L), men = g.totals().getOrDefault("MALE", 0L), unspecified = g.totals().getOrDefault("NOT_SPECIFIED", 0L);
        List<String[]> series = GENDERS.stream().filter(x -> g.totals().getOrDefault(x[0], 0L) > 0).toList();
        String today = day(LocalDate.now(IST));
        ReportHtml h = new ReportHtml("Diversity report", company + " · " + today, stamp, footer, series.size() > 3)
                .kpis(List.of(
                        new Kpi("People counted", num(people), "Active, probation and notice"),
                        new Kpi("Women", pctOf(women, people) + "%", num(women) + " people"),
                        new Kpi("Men", pctOf(men, people) + "%", num(men) + " people"),
                        new Kpi("Gender recorded", pctOf(people - unspecified, people) + "%", unspecified > 0 ? num(unspecified) + " without a gender on file" : "Everyone has one on file")));
        h.bars("Gender split", today, List.of(new Legend("People", ReportHtml.GREEN)), series.stream()
                .map(x -> new Bar(x[1], List.of((double) g.totals().getOrDefault(x[0], 0L)), num(g.totals().getOrDefault(x[0], 0L)) + " · " + pctOf(g.totals().getOrDefault(x[0], 0L), people) + "%", false)).toList());
        List<String> head = new ArrayList<>(List.of("Department"));
        series.forEach(x -> head.add(x[1]));
        head.add("Total");
        head.add("Women %");
        List<List<Object>> rows = new ArrayList<>();
        for (Map.Entry<String, Map<String, Long>> d : g.byDept().entrySet()) {
            long tot = d.getValue().values().stream().mapToLong(Long::longValue).sum();
            List<Object> row = new ArrayList<>(List.of(d.getKey()));
            series.forEach(x -> row.add(num(d.getValue().getOrDefault(x[0], 0L))));
            row.add(num(tot));
            row.add(pctOf(d.getValue().getOrDefault("FEMALE", 0L), tot));
            rows.add(row);
        }
        List<Object> foot = new ArrayList<>(List.of("Total"));
        series.forEach(x -> foot.add(num(g.totals().getOrDefault(x[0], 0L))));
        foot.add(num(people));
        foot.add(pctOf(women, people));
        Set<Integer> numeric = new java.util.HashSet<>();
        for (int i = 1; i < head.size(); i++) numeric.add(i);
        h.table("By department", head, rows, foot, numeric);
        h.note("Everyone currently employed: active, on probation and on notice. People without a recorded gender are counted as not specified.");
        return new Rendered(h.pdf(), "diversity-" + slug(company) + "-" + LocalDate.now(IST) + ".pdf", rows.size(), company);
    }

    record Gender(Map<String, Long> totals, Map<String, Map<String, Long>> byDept) {}

    static Gender gender(List<Map<String, Object>> rows) {
        Map<String, Long> totals = new LinkedHashMap<>();
        Map<String, Map<String, Long>> byDept = new LinkedHashMap<>();
        List<Map<String, Object>> sorted = new ArrayList<>(rows);
        sorted.sort(Comparator.comparing((Map<String, Object> r) -> r.get("department") == null).thenComparing(r -> str(r.get("department"))));
        for (Map<String, Object> r : sorted) {
            String gender = r.get("gender") == null ? "NOT_SPECIFIED" : String.valueOf(r.get("gender"));
            long n = lng(r.get("count"));
            totals.merge(gender, n, Long::sum);
            byDept.computeIfAbsent(dept(r.get("department")), k -> new LinkedHashMap<>()).merge(gender, n, Long::sum);
        }
        return new Gender(totals, byDept);
    }

    // ── Workforce Analytics snapshot ─────────────────────────────────────────

    private Rendered analytics(Params p, String company, String stamp, String footer, Set<String> held) {
        boolean canHead = held.contains("hrms.report.headcount"), canDiv = held.contains("hrms.report.diversity"), canAttr = held.contains("hrms.report.attrition");
        LocalDate asOf = p.asOf() == null ? LocalDate.now(IST) : p.asOf();
        List<Dept> depts = canHead ? depts(reports.headcountReport(p.companyId(), asOf)) : List.of();
        Dept t = Dept.sumOf(depts);
        List<Map<String, Object>> months = canAttr ? reports.attritionReport(p.companyId(), p.from(), p.to()) : List.of();
        Gender g = canDiv ? gender(reports.diversityReport(p.companyId())) : null;
        String range = day(p.from()) + " – " + day(p.to());

        List<Kpi> kpis = new ArrayList<>();
        if (canHead) {
            kpis.add(new Kpi("Total headcount", num(t.total()), num(t.active()) + " active"));
            kpis.add(new Kpi("On notice / probation", num(t.notice() + t.probation()), t.notice() + " notice · " + t.probation() + " probation"));
        }
        if (canAttr && !months.isEmpty()) {
            Map<String, Object> last = months.get(months.size() - 1);
            kpis.add(new Kpi("Attrition (latest month)", one(dbl(last.get("attrition_pct"))) + "%", lng(last.get("exits")) + " exits · " + month(last.get("month"))));
        }
        if (g != null) {
            long people = g.totals().values().stream().mapToLong(Long::longValue).sum();
            kpis.add(new Kpi("People by gender", num(people), g.totals().getOrDefault("FEMALE", 0L) + " women · " + g.totals().getOrDefault("MALE", 0L) + " men"));
        }
        ReportHtml h = new ReportHtml("Workforce Analytics", company + " · " + range + " · data as of " + day(asOf), stamp, footer, false).kpis(kpis);
        if (canHead) {
            h.bars("Headcount by department", "as of " + day(asOf), HEAD_LEGEND, depts.stream()
                    .map(d -> new Bar(d.name(), List.of((double) d.active(), (double) d.notice(), (double) d.probation()), num(d.total()), d.none())).toList());
        }
        if (g != null) {
            long people = g.totals().values().stream().mapToLong(Long::longValue).sum();
            long other = people - g.totals().getOrDefault("FEMALE", 0L) - g.totals().getOrDefault("MALE", 0L);
            h.bars("Gender diversity", null, List.of(new Legend("People", ReportHtml.GREEN)), List.of(
                    new Bar("Women", List.of((double) g.totals().getOrDefault("FEMALE", 0L)), num(g.totals().getOrDefault("FEMALE", 0L)) + " · " + pctOf(g.totals().getOrDefault("FEMALE", 0L), people) + "%", false),
                    new Bar("Men", List.of((double) g.totals().getOrDefault("MALE", 0L)), num(g.totals().getOrDefault("MALE", 0L)) + " · " + pctOf(g.totals().getOrDefault("MALE", 0L), people) + "%", false),
                    new Bar("Other or not specified", List.of((double) other), num(other) + " · " + pctOf(other, people) + "%", false)));
        }
        if (canAttr) {
            h.bars("Monthly attrition", range, List.of(new Legend("Attrition %", ReportHtml.GREEN)), months.stream()
                    .map(r -> new Bar(month(r.get("month")), List.of(dbl(r.get("attrition_pct"))), one(dbl(r.get("attrition_pct"))) + "% · " + lng(r.get("exits")), false)).toList());
        }
        if (canHead) {
            List<String> head = new ArrayList<>(List.of("Department", "Total", "Active", "On notice", "Probation"));
            if (g != null) head.add("Women %");
            head.add("Share %");
            List<List<Object>> rows = new ArrayList<>();
            for (Dept d : depts) {
                List<Object> row = new ArrayList<>(List.of(d.name(), num(d.total()), num(d.active()), num(d.notice()), num(d.probation())));
                if (g != null) {
                    Map<String, Long> gd = g.byDept().get(d.name());
                    long tot = gd == null ? 0 : gd.values().stream().mapToLong(Long::longValue).sum();
                    row.add(tot == 0 ? "" : pctOf(gd.getOrDefault("FEMALE", 0L), tot));
                }
                row.add(pctOf(d.total(), t.total()));
                rows.add(row);
            }
            List<Object> foot = new ArrayList<>(List.of("Total", num(t.total()), num(t.active()), num(t.notice()), num(t.probation())));
            if (g != null) {
                long people = g.totals().values().stream().mapToLong(Long::longValue).sum();
                foot.add(pctOf(g.totals().getOrDefault("FEMALE", 0L), people));
            }
            foot.add(100);
            Set<Integer> numeric = new java.util.HashSet<>();
            for (int i = 1; i < head.size(); i++) numeric.add(i);
            h.table("Departments", head, rows, foot, numeric);
        }
        return new Rendered(h.pdf(), "workforce-analytics-" + slug(company) + "-" + p.from() + "_" + p.to() + ".pdf", depts.size() + months.size(), company);
    }

    // ── lookups ──────────────────────────────────────────────────────────────

    String companyName(UUID companyId) {
        if (companyId == null) return "";
        List<String> names = jdbc.queryForList("SELECT name FROM org.companies WHERE id = ?", String.class, companyId);
        if (names.isEmpty()) throw new com.hrms.core.exception.ResourceNotFoundException("Company not found");
        return names.get(0);
    }

    // ── formatting (package-private for tests) ───────────────────────────────

    static String day(LocalDate d) { return d == null ? "" : DAY.format(d); }
    static String dayOf(Object v) { return v == null ? "" : day(LocalDate.parse(String.valueOf(v).substring(0, 10))); }
    static String dayShort(String iso) { LocalDate d = LocalDate.parse(iso.substring(0, 10)); return d.getDayOfMonth() + " " + MON[d.getMonthValue() - 1]; }
    /** "2026-09" to "Sep 2026". */
    static String month(Object ym) {
        String s = String.valueOf(ym);
        if (s.length() < 7) return s;
        return MON[Integer.parseInt(s.substring(5, 7)) - 1] + " " + s.substring(0, 4);
    }
    static String clock(Object at) {
        if (at == null) return "";
        OffsetDateTime t;
        if (at instanceof java.sql.Timestamp ts) t = ts.toInstant().atOffset(java.time.ZoneOffset.UTC);
        else if (at instanceof OffsetDateTime o) t = o;
        else {
            try { t = OffsetDateTime.parse(String.valueOf(at)); } catch (RuntimeException e) { return String.valueOf(at); }
        }
        return DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).format(t.atZoneSameInstant(IST)).replace("AM", "am").replace("PM", "pm");
    }
    /** Indian digit grouping: 1,23,456. */
    static String num(long n) {
        String s = Long.toString(Math.abs(n));
        if (s.length() > 3) {
            String last3 = s.substring(s.length() - 3);
            String rest = s.substring(0, s.length() - 3);
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < rest.length(); i++) {
                if (i > 0 && (rest.length() - i) % 2 == 0) b.append(',');
                b.append(rest.charAt(i));
            }
            s = b + "," + last3;
        }
        return n < 0 ? "-" + s : s;
    }
    static String one(double v) { return String.format(Locale.ROOT, "%.1f", v); }
    static String two(double v) { return String.format(Locale.ROOT, "%.2f", v); }
    static String d1(double v) { return v == Math.rint(v) ? num((long) v) : one(v); }
    static String hm(long mins) { return mins <= 0 ? "—" : (mins / 60) + "h " + String.format(Locale.ROOT, "%02d", mins % 60) + "m"; }
    static String mins(long m) { return m >= 60 ? (m / 60) + "h" + (m % 60 > 0 ? " " + (m % 60) + "m" : "") : m + "m"; }
    static long pctOf(long a, long b) { return b == 0 ? 0 : Math.round(a * 100.0 / b); }
    static String slug(String s) {
        String out = s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        return out.isEmpty() ? "company" : out;
    }
    static String typeLabel(String t) {
        if (t == null) return "";
        if (!t.matches("^[A-Z0-9_]+$")) return t;
        String w = t.replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(w.charAt(0)) + w.substring(1);
    }
    private static String dept(Object v) { return v == null ? "No department" : String.valueOf(v); }
    private static String str(Object v) { return v == null ? "" : String.valueOf(v); }
    private static long lng(Object v) { return v instanceof Number n ? n.longValue() : v == null ? 0 : Long.parseLong(String.valueOf(v)); }
    private static double dbl(Object v) { return v instanceof Number n ? n.doubleValue() : v == null ? 0 : Double.parseDouble(String.valueOf(v)); }
    private static double sum(List<Map<String, Object>> rows, String k) { return rows.stream().mapToDouble(r -> dbl(r.get(k))).sum(); }
}
