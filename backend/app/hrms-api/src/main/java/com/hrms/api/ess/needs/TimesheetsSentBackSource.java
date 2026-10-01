package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.workforce.TimesheetService;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

/**
 * Timesheet weeks of mine that were sent back (REJECTED) and not sent again:
 * submitting a week again turns the same week back to SUBMITTED, so a REJECTED
 * week is one still waiting for me. Read through {@link TimesheetService#myWeeks}
 * (the list behind {@code GET /v1/ess/timesheets/weeks}, {@code attendance.checkin.self};
 * the /v1/ess paths sit in the hrms module), over the last {@value #WEEKS} weeks.
 */
@Component
class TimesheetsSentBackSource implements NeedsYouSource {

    static final int WEEKS = 12;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private final TimesheetService timesheets;

    TimesheetsSentBackSource(TimesheetService timesheets) {
        this.timesheets = timesheets;
    }

    @Override public String key() { return "TIMESHEET_SENT_BACK"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("attendance.checkin.self"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        LocalDate today = caller.today();
        return timesheets.myWeeks(caller.employeeId(), today.minusWeeks(WEEKS), today).stream()
                .filter(w -> "REJECTED".equals(w.status()))
                .map(w -> {
                    String note = w.note() == null || w.note().isBlank() ? null : "“" + w.note().trim() + "”";
                    String by = w.decidedByName() == null || w.decidedByName().isBlank() ? null : "Sent back by " + w.decidedByName().trim();
                    return new NeedsYouItem("TIMESHEET_SENT_BACK", "Fix your timesheet for the week of " + DAY.format(w.weekStart()),
                            note != null ? (by == null ? note : by + " · " + note) : by,
                            w.weekStart(), null, NeedsYouItem.GOLD, w.id(), 1, "/hrms/attendance?tab=timesheet");
                })
                .toList();
    }
}
