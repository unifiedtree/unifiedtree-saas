package com.hrms.api.workforce;

import com.hrms.core.dto.PageResponse;
import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Approving timesheet weeks (V143.53 redesign, BW-36; {@link TimesheetService}).
 * A new controller on purpose: {@link TimeEntryController} keeps its
 * self-service guard. Every endpoint needs {@code hrms.timesheet.approve} (read
 * from the database, so a grant works without signing in again), and each week
 * must belong to someone in the caller's team scope: HR and admins see the
 * company, a department manager their team. Nobody decides their own week.
 */
@RestController
@RequestMapping("/v1/timesheets")
@Tag(name = "Timesheet approvals", description = "Approve or reject submitted timesheet weeks")
@SecurityRequirement(name = "bearerAuth")
public class TimesheetController {

    private static final Logger log = LoggerFactory.getLogger(TimesheetController.class);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final TimesheetService timesheets;
    private final EmployeeRepository employees;
    @Autowired(required = false)
    private NotificationDispatcher notifications;
    @Autowired(required = false)
    private AuditService audit;

    public TimesheetController(TimesheetService timesheets, EmployeeRepository employees) {
        this.timesheets = timesheets;
        this.employees = employees;
    }

    /** The shared contract's TimesheetDecisionRequest. */
    public record DecisionRequest(String status, String comment) {}

    @Operation(summary = "Timesheet weeks of your team (SUBMITTED by default; APPROVED, REJECTED or ALL)")
    @GetMapping("/approvals")
    @PreAuthorize("@perm.check('hrms.timesheet.approve')")
    public PageResponse<TimesheetService.Week> approvals(@RequestParam(required = false) String status,
                                                         @RequestParam(defaultValue = "0") int page,
                                                         @RequestParam(defaultValue = "20") int size,
                                                         @AuthenticationPrincipal Jwt jwt) {
        return timesheets.approvals(jwt, status, page, size);
    }

    @Operation(summary = "The time entries of one submitted week")
    @GetMapping("/weeks/{id}/entries")
    @PreAuthorize("@perm.check('hrms.timesheet.approve')")
    public List<Map<String, Object>> entries(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return timesheets.entriesOfWeek(jwt, id);
    }

    @Operation(summary = "Approve or reject a submitted week (the employee is told)")
    @PostMapping("/weeks/{id}/decision")
    @PreAuthorize("@perm.check('hrms.timesheet.approve')")
    public TimesheetService.Week decide(@PathVariable UUID id, @RequestBody DecisionRequest body,
                                        @AuthenticationPrincipal Jwt jwt) {
        String name = callerName(jwt);
        TimesheetService.Week week = timesheets.decide(jwt, id, body == null ? null : body.status(),
                body == null ? null : body.comment(), name);
        boolean approved = TimesheetService.APPROVED.equals(week.status());
        notifyEmployee(week, approved);
        if (audit != null) {
            try {
                audit.record("attendance", approved ? "TIMESHEET_APPROVED" : "TIMESHEET_REJECTED", "employee", week.employeeId(),
                        "Timesheet of " + week.employeeName() + " for the week of " + DAY.format(week.weekStart()) + " "
                                + (approved ? "approved" : "rejected") + (name != null ? " by " + name : "") + "."
                                + (week.note() != null ? " Note: " + week.note() : ""));
            } catch (RuntimeException e) {
                log.warn("Audit write failed for timesheet week {}: {}", week.id(), e.getMessage());
            }
        }
        return week;
    }

    /** TIMESHEET_DECIDED to the employee. After the commit; best effort. */
    private void notifyEmployee(TimesheetService.Week week, boolean approved) {
        if (notifications == null) return;
        try {
            Map<String, Object> data = new HashMap<>();
            data.put("type", "TIMESHEET_DECIDED");
            data.put("timesheetWeekId", week.id().toString());
            data.put("weekStart", week.weekStart().toString());
            String note = week.note() == null ? "" : week.note();
            notifications.dispatch(TenantContext.requireTenantId(), week.employeeId(), "attendance.timesheet_decided", Map.of(
                    "decision", approved ? "approved" : "rejected",
                    "weekStart", DAY.format(week.weekStart()),
                    "reason", note,
                    "reasonText", note.isBlank() ? "" : " Reason: " + note), data);
        } catch (RuntimeException e) {
            log.warn("Could not send TIMESHEET_DECIDED for week {}: {}", week.id(), e.getMessage());
        }
    }

    private String callerName(Jwt jwt) {
        try {
            UUID me = TimesheetService.callerEmployeeId(jwt);
            String name = employees.findById(me)
                    .map(e -> TimesheetService.joinName(e.getFirstName(), e.getLastName())).orElse(null);
            if (name != null && !name.isBlank()) return name;
        } catch (RuntimeException ignored) { /* no employee record */ }
        return jwt.getClaimAsString("email");
    }
}
