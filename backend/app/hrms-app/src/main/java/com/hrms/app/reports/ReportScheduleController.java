package com.hrms.app.reports;

import com.hrms.core.exception.BusinessRuleException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Weekly / monthly report emails. Everything here needs
 * hrms.report.schedule.manage, plus (checked in the service) the permission of
 * the report being scheduled; recipients must be able to open it too.
 */
@RestController
@RequestMapping("/v1/reports/schedules")
@Tag(name = "Report schedules", description = "Weekly and monthly report emails")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasAuthority('hrms.report.schedule.manage')")
public class ReportScheduleController {

    private final ReportScheduleService schedules;

    public ReportScheduleController(ReportScheduleService schedules) {
        this.schedules = schedules;
    }

    @GetMapping
    @Operation(summary = "Every report email in this workspace")
    public List<Map<String, Object>> list() {
        return schedules.list();
    }

    @GetMapping("/recipients")
    @Operation(summary = "Workspace members who may receive a report (they can open it themselves)")
    public List<ReportScheduleService.Recipient> recipients(@RequestParam String report) {
        ReportKind kind = ReportKind.fromKey(report).filter(ReportKind::schedulable)
                .orElseThrow(() -> new BusinessRuleException("Unknown report", "REPORT_UNKNOWN"));
        return schedules.eligibleRecipients(kind);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Set up a report email")
    public Map<String, Object> create(@RequestBody ReportScheduleService.Request body, Authentication auth) {
        return schedules.create(body, ReportExportController.held(auth));
    }

    @PutMapping("/{id}")
    @Operation(summary = "Change a report email (report, company, timing, recipients, on/off)")
    public Map<String, Object> update(@PathVariable UUID id, @RequestBody ReportScheduleService.Request body, Authentication auth) {
        return schedules.update(id, body, ReportExportController.held(auth));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a report email")
    public void delete(@PathVariable UUID id, Authentication auth) {
        schedules.delete(id, ReportExportController.held(auth));
    }

    @PostMapping("/{id}/send-now")
    @Operation(summary = "Send a report email now, to the people on it who can still open the report")
    public ReportScheduleService.SendResult sendNow(@PathVariable UUID id, Authentication auth) {
        return schedules.sendNow(id, ReportExportController.held(auth));
    }
}
