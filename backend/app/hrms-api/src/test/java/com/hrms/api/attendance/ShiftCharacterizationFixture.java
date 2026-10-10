package com.hrms.api.attendance;

import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * The data the shift characterization tests run on (shift-ot GAP-MAP §2.2 and §2.3): two tenants, three companies,
 * six shifts and thirteen people whose assignments cover every case the copies of "the shift in force on a date"
 * treat differently. Everything is created under random ids and deleted afterwards.
 *
 * <p>Dates: Monday 3 to Tuesday 11 August 2026. Every assignment that matters starts before 20 August, so the lookups
 * that use today's date give the same answers on any day after it.
 *
 * <ul>
 *   <li>E1 Plain: General, open-ended. Own weekly offs 6,7.</li>
 *   <li>E2 Change: General to 9 Aug, then Night (22:00 to 06:00) from 10 Aug, open-ended.</li>
 *   <li>E3 Overlap: General open-ended, and Flex open-ended from 5 Aug (two open rows).</li>
 *   <li>E4 Archived: General open-ended, and the archived shift from 4 Aug (two open rows).</li>
 *   <li>E5 None: no assignment at all.</li>
 *   <li>E6 Future: Night from 20 Aug only.</li>
 *   <li>E7 Company B: the company B shift; company B's weekly offs are Friday and Saturday.</li>
 *   <li>E8 Shift offs: Flex (weekly off Wednesday); own weekly offs blank.</li>
 *   <li>E9 Ended: General until 4 Aug, nothing after.</li>
 *   <li>E10 Tie: General and Night both from 1 Aug; Night created later.</li>
 *   <li>E11 Cross tenant: General; plus a row of the OTHER tenant (its shift too) from 5 Aug.</li>
 *   <li>E12 Foreign shift: General; plus a row of this tenant pointing at the other tenant's shift from 5 Aug.</li>
 *   <li>E13 Company C: no shift; company C has an empty weekly-off list.</li>
 * </ul>
 * Company A's weekly off is Sunday; it has a holiday on Friday 7 Aug and an inactive one on Thursday 6 Aug.
 * Company B has a holiday on Monday 10 Aug.
 */
public final class ShiftCharacterizationFixture {

    public static final LocalDate FROM = LocalDate.of(2026, 8, 3);
    public static final LocalDate TO = LocalDate.of(2026, 8, 11);

    public final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    public final JdbcTemplate jdbc = new JdbcTemplate(source);

    public final UUID tenant = UUID.randomUUID();
    public final UUID otherTenant = UUID.randomUUID();
    public final UUID companyA = UUID.randomUUID();
    public final UUID companyB = UUID.randomUUID();
    public final UUID companyC = UUID.randomUUID();
    public final UUID general = UUID.randomUUID();
    public final UUID night = UUID.randomUUID();
    public final UUID flex = UUID.randomUUID();
    public final UUID archived = UUID.randomUUID();
    public final UUID bShift = UUID.randomUUID();
    public final UUID xShift = UUID.randomUUID();

    /** Label → employee id, in E1..E13 order. */
    public final Map<String, UUID> people = new LinkedHashMap<>();
    /** Id → label, for every id the fixture made (so dumps never show a random id). */
    private final Map<UUID, String> labels = new LinkedHashMap<>();

    public void seed() {
        label(tenant, "TENANT");
        label(otherTenant, "OTHER_TENANT");
        label(companyA, "COMPANY_A");
        label(companyB, "COMPANY_B");
        label(companyC, "COMPANY_C");
        config(companyA, "{7}");
        config(companyB, "{5,6}");
        config(companyC, "{}");
        holiday(companyA, "2026-08-07", "QA Founders Day", true);
        holiday(companyA, "2026-08-06", "QA Cancelled Day", false);
        holiday(companyB, "2026-08-10", "QA B Day", true);

        shift(general, "GENERAL", tenant, companyA, "QA General", "FIXED", "09:00", "18:00", 10, 8.0, true, null, null, "6");
        shift(night, "NIGHT", tenant, companyA, "QA Night", "NIGHT", "22:00", "06:00", 15, 7.5, true, null, null, "6,7");
        shift(flex, "FLEX", tenant, companyA, "QA Flex", "FLEXIBLE", "08:00", "20:00", 20, 8.0, true, "10:00", "16:00", "3");
        shift(archived, "ARCHIVED", tenant, companyA, "QA Archived", "FIXED", "07:00", "15:00", 5, 8.0, false, null, null, "1");
        shift(bShift, "B_SHIFT", tenant, companyB, "QA B Shift", "FIXED", "10:00", "19:00", 0, 9.5, true, null, null, null);
        shift(xShift, "X_SHIFT", otherTenant, UUID.randomUUID(), "QA Other Tenant", "FIXED", "11:00", "20:00", 0, 8.0, true, null, null, "2");

        UUID e1 = person("E1", "Plain", companyA, "6,7");
        assign(e1, general, "2026-06-01", null);
        UUID e2 = person("E2", "Change", companyA, null);
        assign(e2, general, "2026-06-01", "2026-08-09");
        assign(e2, night, "2026-08-10", null);
        UUID e3 = person("E3", "Overlap", companyA, null);
        assign(e3, general, "2026-06-01", null);
        assign(e3, flex, "2026-08-05", null);
        UUID e4 = person("E4", "Archived", companyA, null);
        assign(e4, general, "2026-06-01", null);
        assign(e4, archived, "2026-08-04", null);
        person("E5", "None", companyA, null);
        UUID e6 = person("E6", "Future", companyA, null);
        assign(e6, night, "2026-08-20", null);
        UUID e7 = person("E7", "Bravo", companyB, null);
        assign(e7, bShift, "2026-06-01", null);
        UUID e8 = person("E8", "Shiftoffs", companyA, "");
        assign(e8, flex, "2026-06-01", null);
        UUID e9 = person("E9", "Ended", companyA, null);
        assign(e9, general, "2026-06-01", "2026-08-04");
        UUID e10 = person("E10", "Tie", companyA, null);
        assignAt(e10, tenant, general, "2026-08-01", null, "now() - interval '1 day'");
        assignAt(e10, tenant, night, "2026-08-01", null, "now()");
        UUID e11 = person("E11", "Crosstenant", companyA, null);
        assign(e11, general, "2026-06-01", null);
        assignAt(e11, otherTenant, xShift, "2026-08-05", null, "now()");
        UUID e12 = person("E12", "Foreignshift", companyA, null);
        assign(e12, general, "2026-06-01", null);
        assign(e12, xShift, "2026-08-05", null);
        person("E13", "Charlie", companyC, null);
    }

    public void cleanup() {
        for (UUID t : List.of(tenant, otherTenant)) {
            jdbc.update("DELETE FROM attendance.overtime_decisions WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.records WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.employee_shift_assignments WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM attendance.shift_policies WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM hrms.employees WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM settings.holiday_calendar WHERE tenant_id = ?", t);
            jdbc.update("DELETE FROM settings.hr_configuration WHERE tenant_id = ?", t);
        }
    }

    // ── seeding ──────────────────────────────────────────────────────────────

    private void label(UUID id, String label) {
        labels.put(id, label);
    }

    private void config(UUID company, String weekendDays) {
        jdbc.update("INSERT INTO settings.hr_configuration(id, tenant_id, company_id, weekend_days) VALUES (?, ?, ?, CAST(? AS integer[]))",
                UUID.randomUUID(), tenant, company, weekendDays);
    }

    private void holiday(UUID company, String date, String name, boolean active) {
        jdbc.update("INSERT INTO settings.holiday_calendar(id, tenant_id, company_id, year, holiday_date, holiday_name, holiday_type, is_active) "
                + "VALUES (?, ?, ?, 2026, CAST(? AS date), ?, 'COMPANY', ?)", UUID.randomUUID(), tenant, company, date, name, active);
    }

    private void shift(UUID id, String label, UUID tenantId, UUID company, String name, String type, String start, String end,
                       int grace, double hours, boolean active, String coreStart, String coreEnd, String offs) {
        label(id, label);
        jdbc.update("INSERT INTO attendance.shift_policies(id, tenant_id, company_id, name, shift_type, start_time, end_time, "
                        + "grace_period_minutes, working_hours_per_day, is_active, core_start_time, core_end_time, weekly_off_days) "
                        + "VALUES (?, ?, ?, ?, ?, CAST(? AS time), CAST(? AS time), ?, ?, ?, CAST(? AS time), CAST(? AS time), ?)",
                id, tenantId, company, name, type, start, end, grace, hours, active, coreStart, coreEnd, offs);
    }

    private UUID person(String label, String firstName, UUID company, String weeklyOffs) {
        UUID id = UUID.randomUUID();
        label(id, label);
        people.put(label, id);
        jdbc.update("INSERT INTO hrms.employees(id, tenant_id, company_id, employee_code, first_name, last_name, employment_type, "
                        + "employment_status, date_of_joining, weekly_off_days) "
                        + "VALUES (?, ?, ?, ?, ?, 'Shiftqa', 'FULL_TIME', 'ACTIVE', '2026-06-01', ?)",
                id, tenant, company, "QAS-" + id.toString().substring(0, 8), firstName, weeklyOffs);
        return id;
    }

    private void assign(UUID employee, UUID shift, String from, String to) {
        assignAt(employee, tenant, shift, from, to, "now()");
    }

    private void assignAt(UUID employee, UUID tenantId, UUID shift, String from, String to, String createdAt) {
        jdbc.update("INSERT INTO attendance.employee_shift_assignments(id, tenant_id, employee_id, shift_policy_id, effective_from, "
                        + "effective_to, created_at) VALUES (?, ?, ?, ?, CAST(? AS date), CAST(? AS date), " + createdAt + ")",
                UUID.randomUUID(), tenantId, employee, shift, from, to);
    }

    /** A finished day: check-in and check-out are India wall-clock times; the stored overtime is given as it is. */
    public UUID record(String person, String date, String in, String outDate, String out, double hours, int overtimeMinutes) {
        UUID id = UUID.randomUUID();
        UUID employee = people.get(person);
        UUID company = jdbc.queryForObject("SELECT company_id FROM hrms.employees WHERE id = ?", UUID.class, employee);
        jdbc.update("INSERT INTO attendance.records(id, tenant_id, employee_id, company_id, attendance_date, check_in_at, check_out_at, "
                        + "work_hours, overtime_minutes) VALUES (?, ?, ?, ?, CAST(? AS date), "
                        + "(CAST(? AS date) + CAST(? AS time)) AT TIME ZONE 'Asia/Kolkata', "
                        + "(CAST(? AS date) + CAST(? AS time)) AT TIME ZONE 'Asia/Kolkata', ?, ?)",
                id, tenant, employee, company, date, date, in, outDate, out, hours, overtimeMinutes);
        label(id, "R_" + person + "_" + date);
        return id;
    }

    // ── reading ──────────────────────────────────────────────────────────────

    public UUID id(String person) {
        return people.get(person);
    }

    /** The people with these labels, in that order. */
    public List<UUID> ids(String... persons) {
        List<UUID> out = new ArrayList<>();
        for (String p : persons) out.add(people.get(p));
        return out;
    }

    /** Everyone except {@code except}, in E1..E13 order. */
    public List<UUID> everyoneBut(String... except) {
        Set<String> skip = Set.of(except);
        List<UUID> out = new ArrayList<>();
        people.forEach((label, id) -> { if (!skip.contains(label)) out.add(id); });
        return out;
    }

    public Employee employee(String person) {
        Employee e = new Employee();
        e.setId(people.get(person));
        e.setFirstName(person);
        e.setCompanyId(jdbc.queryForObject("SELECT company_id FROM hrms.employees WHERE id = ?", UUID.class, e.getId()));
        return e;
    }

    public List<LocalDate> days() {
        List<LocalDate> out = new ArrayList<>();
        for (LocalDate d = FROM; !d.isAfter(TO); d = d.plusDays(1)) out.add(d);
        return out;
    }

    private static final Pattern UUID_TEXT = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    /** {@code text} with every id the fixture made replaced by its label (an unknown id reads "?id"). */
    public String labelled(String text) {
        Matcher m = UUID_TEXT.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String label = labels.get(UUID.fromString(m.group()));
            m.appendReplacement(sb, Matcher.quoteReplacement(label != null ? label : "?id"));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** A value as the dumps show it: sets sorted, timestamps as instants, a JDBC row as key=value(type) in its order. */
    public static String show(Object v) {
        if (v == null) return "null";
        if (v instanceof java.sql.Timestamp t) return "ts:" + t.toInstant();
        if (v instanceof java.sql.Time t) return t + "(Time)";
        if (v instanceof java.sql.Date d) return d + "(Date)";
        if (v instanceof Set<?> s) {
            List<String> parts = new ArrayList<>();
            for (Object o : s) parts.add(show(o));
            return new TreeSet<>(parts).toString();
        }
        if (v instanceof Map<?, ?> m) {
            List<String> parts = new ArrayList<>();
            m.forEach((k, val) -> parts.add(k + "=" + show(val) + typeOf(val)));
            return "{" + String.join(", ", parts) + "}";
        }
        if (v instanceof Collection<?> c) {
            List<String> parts = new ArrayList<>();
            for (Object o : c) parts.add(show(o));
            return parts.toString();
        }
        return String.valueOf(v);
    }

    private static String typeOf(Object v) {
        if (v == null || v instanceof java.sql.Timestamp || v instanceof java.sql.Time || v instanceof java.sql.Date
                || v instanceof Map || v instanceof Collection) return "";
        return "(" + v.getClass().getSimpleName() + ")";
    }

    /**
     * Compares {@code actual} with the golden file {@code name} (under src/test/resources/shift-characterization),
     * written from the code as it was before the shift resolver. With SHIFT_GOLDEN_WRITE set to a directory, the file
     * is written there instead (done once, on the old code). The actual text always lands in target/ for diffing.
     */
    public static void assertGolden(String name, String actual) throws IOException {
        String write = System.getenv("SHIFT_GOLDEN_WRITE");
        if (write != null && !write.isBlank()) {
            Path dir = Path.of(write);
            Files.createDirectories(dir);
            Files.writeString(dir.resolve(name), actual, StandardCharsets.UTF_8);
            return;
        }
        Path target = Path.of("target", "shift-characterization");
        Files.createDirectories(target);
        Files.writeString(target.resolve(name), actual, StandardCharsets.UTF_8);
        try (InputStream in = ShiftCharacterizationFixture.class.getResourceAsStream("/shift-characterization/" + name)) {
            assertNotNull(in, "golden file " + name);
            String golden = new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
            assertEquals(golden, actual, "answers differ from the golden file " + name + " (actual: target/shift-characterization)");
        }
    }
}
