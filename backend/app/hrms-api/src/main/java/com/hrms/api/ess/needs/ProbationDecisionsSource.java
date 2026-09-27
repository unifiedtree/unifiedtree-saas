package com.hrms.api.ess.needs;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.ess.EssCaller;
import com.hrms.api.probation.ProbationService;
import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * For a manager who may confirm or extend their team's probation
 * ({@code hrms.probation.team.decide}, DECISIONS 15; granted only to owners and
 * super admins until an admin gives it to managers): people in their team (the
 * My team rule, {@link TeamEmployeeScope#teamOf}) still on probation whose end
 * date is within the workspace's probation reminder window (Probation settings,
 * the same window the probation reminders use), or already past. Read from the
 * employee records; hrms module.
 */
@Component
class ProbationDecisionsSource implements NeedsYouSource {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE, d MMM", Locale.ENGLISH);

    private final TeamEmployeeScope teamScope;
    private final EmployeeRepository employees;
    private final ProbationService probation;

    ProbationDecisionsSource(TeamEmployeeScope teamScope, EmployeeRepository employees, ProbationService probation) {
        this.teamScope = teamScope;
        this.employees = employees;
        this.probation = probation;
    }

    @Override public String key() { return "PROBATION_DECISION"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.probation.team.decide"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        Employee me = employees.findById(caller.employeeId()).orElse(null);
        if (me == null) return List.of();
        int window = probation.getConfig(caller.tenantId()).reminderDaysBefore();
        LocalDate last = caller.today().plusDays(Math.max(0, window));
        return teamScope.teamOf(me).stream()
                .filter(e -> e.getEmploymentStatus() == EmploymentStatus.PROBATION && e.getProbationEndDate() != null)
                .filter(e -> !e.getProbationEndDate().isAfter(last))
                .sorted(Comparator.comparing(Employee::getProbationEndDate))
                .map(e -> {
                    LocalDate end = e.getProbationEndDate();
                    boolean overdue = end.isBefore(caller.today());
                    String name = ((e.getFirstName() == null ? "" : e.getFirstName().trim()) + " "
                            + (e.getLastName() == null ? "" : e.getLastName().trim())).trim();
                    if (name.isEmpty()) name = e.getEmployeeCode();
                    String job = e.getJobTitle() == null || e.getJobTitle().isBlank() ? null : e.getJobTitle().trim();
                    String when = (overdue ? "Ended " : "Ends ") + DAY.format(end);
                    return new NeedsYouItem("PROBATION_DECISION", "Decide on " + name + "’s probation",
                            job == null ? when : job + " · " + when, end, end,
                            overdue ? NeedsYouItem.BAD : NeedsYouItem.GOLD, e.getId(), 1, "/team");
                })
                .toList();
    }
}
