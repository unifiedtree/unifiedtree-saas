package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.ess.EssSourceRunner.Collected;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

/**
 * Home's "Around you" (BW-121): what happens around the caller from today to
 * {@code days} ahead (both included): colleagues' birthdays, work anniversaries
 * and retirements in their company, holidays, company notices, payday, and for
 * team approvers their team's probation ends. Sorted by date.
 *
 * <p>Each source is read only with its own rule and module, on its own
 * ({@link EssSourceRunner}); a failing one is named in {@code unavailable}.
 * Team messages (BW-12) join the list on the page once they exist.
 */
@Service
public class AroundMeService {

    public static final int DEFAULT_DAYS = 14;
    public static final int MAX_DAYS = 60;
    /** Enough for any Home card; the list is chronological, so the soonest are kept. */
    public static final int MAX_ITEMS = 50;

    /** On the same day: payday, then holidays, notices, probation ends, birthdays, anniversaries. */
    static final List<String> KIND_ORDER = List.of("PAYDAY", "HOLIDAY", "NOTICE", "PROBATION_END", "RETIREMENT", "BIRTHDAY", "WORK_ANNIVERSARY");

    private final List<AroundSource> sources;
    private final EssSourceRunner runner;
    private final EmployeeRepository employees;

    public AroundMeService(List<AroundSource> sources, EssSourceRunner runner, EmployeeRepository employees) {
        this.sources = List.copyOf(sources);
        this.runner = runner;
        this.employees = employees;
    }

    /** The window: today to {@code days} ahead, days clamped to 1..60 (14 when not given). */
    static LocalDate[] window(LocalDate today, Integer days) {
        int d = days == null ? DEFAULT_DAYS : Math.max(1, Math.min(days, MAX_DAYS));
        return new LocalDate[] {today, today.plusDays(d)};
    }

    public AroundItem.Response aroundMe(EssCaller caller, Integer days) {
        LocalDate[] w = window(caller.today(), days);
        Employee me = caller.hasEmployee() ? employees.findById(caller.employeeId()).orElse(null) : null;
        if (me == null) return new AroundItem.Response(w[0], w[1], List.of(), List.of(), List.of());
        Collected<AroundItem> got = runner.collect(caller, sources, true, s -> s.load(caller, me, w[0], w[1]));
        List<AroundItem> items = got.items().stream().sorted(ORDER).limit(MAX_ITEMS).toList();
        return new AroundItem.Response(w[0], w[1], items, got.included(), got.unavailable());
    }

    static final Comparator<AroundItem> ORDER = Comparator
            .comparing(AroundItem::date, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(i -> rank(i.kind()))
            .thenComparing(i -> i.title() == null ? "" : i.title(), String.CASE_INSENSITIVE_ORDER);

    private static int rank(String kind) {
        int r = KIND_ORDER.indexOf(kind);
        return r < 0 ? KIND_ORDER.size() : r;
    }
}
