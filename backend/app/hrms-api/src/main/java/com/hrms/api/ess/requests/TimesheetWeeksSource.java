package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.Rows;
import com.hrms.api.workforce.TimesheetService;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * My submitted timesheet weeks: the list behind {@code GET /v1/ess/timesheets/weeks}
 * ({@link TimesheetService#myWeeks}, {@code attendance.checkin.self}; the /v1/ess
 * paths sit in the hrms module), over the last {@value #WEEKS} weeks. A waiting week
 * is with the person its notification goes to (the same notification path as a fix).
 */
@Component
class TimesheetWeeksSource implements MyRequestSource {

    static final int WEEKS = 26;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private final TimesheetService timesheets;
    private final NotifiedApprover notified;

    TimesheetWeeksSource(TimesheetService timesheets, NotifiedApprover notified) {
        this.timesheets = timesheets;
        this.notified = notified;
    }

    @Override public String key() { return "TIMESHEET"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("attendance.checkin.self"); }

    @Override
    public List<MyRequest> load(EssCaller caller, int limit) {
        LocalDate today = caller.today();
        List<TimesheetService.Week> weeks = timesheets.myWeeks(caller.employeeId(), today.minusWeeks(WEEKS), today).stream()
                .sorted(Comparator.comparing((TimesheetService.Week w) -> !"SUBMITTED".equals(w.status()))
                        .thenComparing(TimesheetService.Week::submittedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(limit)
                .toList();
        String waitingFor = weeks.stream().anyMatch(w -> "SUBMITTED".equals(w.status())) ? notified.nameFor(caller.employeeId()) : null;
        return weeks.stream().map(w -> toRequest(w, waitingFor)).toList();
    }

    static MyRequest toRequest(TimesheetService.Week w, String waitingFor) {
        String status = w.status() == null ? "" : w.status();
        Steps steps = new Steps().done("Sent", null, w.submittedAt());
        String state, label, waiting = null, decidedBy = null;
        switch (status) {
            case "SUBMITTED" -> {
                steps.current("Approval", waitingFor);
                state = "WAITING";
                label = "Waiting";
                waiting = waitingFor;
            }
            case "APPROVED" -> {
                steps.done("Approval", w.decidedByName(), w.decidedAt());
                state = "APPROVED";
                label = "Approved";
                decidedBy = w.decidedByName();
            }
            case "REJECTED" -> {
                steps.done("Approval", w.decidedByName(), w.decidedAt());
                state = "REJECTED";
                label = "Sent back";
                decidedBy = w.decidedByName();
            }
            default -> {
                steps.current("Approval", null);
                state = "WAITING";
                label = Rows.pretty(status);
            }
        }
        LocalDate start = w.weekStart();
        return new MyRequest("TIMESHEET", w.id(), "Timesheet · week of " + DAY.format(start), start, start.plusDays(6),
                null, null, null, status, state, label, steps.progress(!"WAITING".equals(state)), steps.list(),
                waiting, decidedBy, w.submittedAt(), Rows.latest(w.submittedAt(), w.decidedAt()), "/hrms/attendance?tab=timesheet");
    }
}
