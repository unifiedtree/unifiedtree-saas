package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSource;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.ess.EssSourceRunner.Collected;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Celebrations (the app's and the website's "Celebrations" card and page):
 * colleagues' birthdays and work anniversaries from a few days back to
 * {@code days} ahead, and the people who joined in the last
 * {@value #JOINED_DAYS} days ("Welcome aboard").
 *
 * <p>The same people and the same rules as Home's "Around you"
 * ({@link AroundMeService}): the caller's own company, active employees only,
 * anyone signed in with an employee record, behind the hrms module, each kind
 * read on its own so one failing kind is named in {@code unavailable}. Around
 * you only looks ahead and has no new joiners, which is why this is its own
 * read rather than more kinds on that list (old clients would show the new
 * kind as an unknown event).
 *
 * <p>Birthdays carry no year and no age, as on Around you. Reaching back a
 * week, never further, keeps that true: a list that reached a year back would
 * tell who was born when.
 */
@Service
public class CelebrationsService {

    /** How far back birthdays and anniversaries reach (shown faded: "missed it?"). */
    public static final int PAST_DAYS = 7;
    public static final int DEFAULT_DAYS = 30;
    public static final int MAX_DAYS = 60;
    /** Welcome aboard: people who joined in this many days up to today. */
    public static final int JOINED_DAYS = 30;
    /** Enough for any company's month; the list is chronological. */
    public static final int MAX_ITEMS = 300;

    static final List<String> KIND_ORDER = List.of("BIRTHDAY", "WORK_ANNIVERSARY", "NEW_JOINER");

    /**
     * One person to celebrate.
     *
     * @param kind           BIRTHDAY, WORK_ANNIVERSARY or NEW_JOINER
     * @param date           the day it falls on this time; for a new joiner, the joining date
     * @param name           their name (employee code when they have none)
     * @param years          work anniversaries only: which one; null otherwise (never an age)
     */
    public record Celebration(String kind, LocalDate date, UUID employeeId, String name, String departmentName, Integer years) {}

    /**
     * @param from       first day of the birthday and anniversary window (a week before today)
     * @param to         last day of that window
     * @param joinedFrom first joining date counted as new ({@value #JOINED_DAYS} days before today)
     */
    public record Response(LocalDate today, LocalDate from, LocalDate to, LocalDate joinedFrom,
                           List<Celebration> items, List<String> included, List<String> unavailable) {}

    /** One kind of celebration, read on its own by {@link EssSourceRunner}. */
    interface Source extends EssSource {
        List<Celebration> load(EssCaller caller, Employee me, LocalDate from, LocalDate to, LocalDate joinedFrom);
    }

    private final List<Source> sources;
    private final EssSourceRunner runner;
    private final EmployeeRepository employees;

    // Two constructors (the second is for tests), so Spring must be told which
    // one to use, or the app fails to start.
    @Autowired
    public CelebrationsService(JdbcTemplate jdbc, EssSourceRunner runner, EmployeeRepository employees) {
        this(List.of(new Birthdays(jdbc), new Anniversaries(jdbc), new Joiners(jdbc)), runner, employees);
    }

    CelebrationsService(List<Source> sources, EssSourceRunner runner, EmployeeRepository employees) {
        this.sources = List.copyOf(sources);
        this.runner = runner;
        this.employees = employees;
    }

    public Response celebrations(EssCaller caller, Integer days) {
        LocalDate today = caller.today();
        int d = days == null ? DEFAULT_DAYS : Math.max(1, Math.min(days, MAX_DAYS));
        LocalDate from = today.minusDays(PAST_DAYS), to = today.plusDays(d), joinedFrom = today.minusDays(JOINED_DAYS);
        Employee me = caller.hasEmployee() ? employees.findById(caller.employeeId()).orElse(null) : null;
        if (me == null) return new Response(today, from, to, joinedFrom, List.of(), List.of(), List.of());
        Collected<Celebration> got = runner.collect(caller, sources, true, s -> s.load(caller, me, from, to, joinedFrom));
        List<Celebration> items = got.items().stream().sorted(ORDER).limit(MAX_ITEMS).toList();
        return new Response(today, from, to, joinedFrom, items, got.included(), got.unavailable());
    }

    static final Comparator<Celebration> ORDER = Comparator
            .comparing(Celebration::date, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(c -> KIND_ORDER.indexOf(c.kind()))
            .thenComparing(c -> c.name() == null ? "" : c.name(), String.CASE_INSENSITIVE_ORDER);

    // ── the three kinds ──────────────────────────────────────────────────────

    /** Birthdays: Around you's rule (BirthdaysSource), over the wider window. */
    static final class Birthdays implements Source {
        private final JdbcTemplate jdbc;
        Birthdays(JdbcTemplate jdbc) { this.jdbc = jdbc; }
        @Override public String key() { return "BIRTHDAY"; }
        @Override public String module() { return "hrms"; }
        @Override public boolean allowed(EssCaller caller) { return true; }
        @Override
        public List<Celebration> load(EssCaller caller, Employee me, LocalDate from, LocalDate to, LocalDate joinedFrom) {
            return YearlyDates.within(YearlyDates.people(jdbc, "date_of_birth", caller.tenantId(), me.getCompanyId()), from, to)
                    .stream()
                    .map(o -> new Celebration("BIRTHDAY", o.on(), o.person().id(), o.person().name(), o.person().department(), null))
                    .toList();
        }
    }

    /** Work anniversaries: Around you's rule (WorkAnniversariesSource): never the joining year itself. */
    static final class Anniversaries implements Source {
        private final JdbcTemplate jdbc;
        Anniversaries(JdbcTemplate jdbc) { this.jdbc = jdbc; }
        @Override public String key() { return "WORK_ANNIVERSARY"; }
        @Override public String module() { return "hrms"; }
        @Override public boolean allowed(EssCaller caller) { return true; }
        @Override
        public List<Celebration> load(EssCaller caller, Employee me, LocalDate from, LocalDate to, LocalDate joinedFrom) {
            return YearlyDates.within(YearlyDates.people(jdbc, "date_of_joining", caller.tenantId(), me.getCompanyId()), from, to)
                    .stream()
                    .map(o -> new Celebration("WORK_ANNIVERSARY", o.on(), o.person().id(), o.person().name(), o.person().department(), o.years()))
                    .toList();
        }
    }

    /** Welcome aboard: active people of the company who joined between {@code joinedFrom} and today. */
    static final class Joiners implements Source {
        private final JdbcTemplate jdbc;
        Joiners(JdbcTemplate jdbc) { this.jdbc = jdbc; }
        @Override public String key() { return "NEW_JOINER"; }
        @Override public String module() { return "hrms"; }
        @Override public boolean allowed(EssCaller caller) { return true; }
        @Override
        public List<Celebration> load(EssCaller caller, Employee me, LocalDate from, LocalDate to, LocalDate joinedFrom) {
            return jdbc.query("""
                    SELECT e.id, e.first_name, e.last_name, e.employee_code, e.date_of_joining AS joined, d.name AS dept
                      FROM hrms.employees e
                      LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                     WHERE e.tenant_id = ? AND e.company_id = ? AND e.is_active
                       AND e.date_of_joining BETWEEN ? AND ?
                    """, (rs, i) -> {
                        String first = rs.getString("first_name");
                        String last = rs.getString("last_name");
                        String name = ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
                        return new Celebration("NEW_JOINER", rs.getObject("joined", LocalDate.class), rs.getObject("id", UUID.class),
                                name.isEmpty() ? rs.getString("employee_code") : name, rs.getString("dept"), null);
                    }, caller.tenantId(), me.getCompanyId(), joinedFrom, caller.today());
        }
    }
}
