package com.hrms.api.probation;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Probation config + dashboard + manual scan (Prompt 11). The employee
 * Confirm/Extend actions reuse hrms.employee.write; the upcoming list reuses
 * hrms.employee.read; config/reminders use the new probation perms.
 */
@RestController
@RequestMapping("/v1/probation")
public class ProbationController {

    private final ProbationService service;

    public ProbationController(ProbationService service) {
        this.service = service;
    }

    @GetMapping("/config")
    @PreAuthorize("hasAuthority('hrms.probation.config.read')")
    public ProbationService.ProbationConfigDto getConfig() {
        return service.getConfig(TenantContext.getTenantId());
    }

    @PutMapping("/config")
    @PreAuthorize("hasAuthority('hrms.probation.config.update')")
    public ProbationService.ProbationConfigDto updateConfig(@RequestBody ProbationService.ProbationConfigDto req) {
        return service.updateConfig(TenantContext.getTenantId(), req);
    }

    @GetMapping("/upcoming")
    @PreAuthorize("hasAuthority('hrms.employee.read')")
    public List<ProbationService.UpcomingProbationDto> upcoming(@RequestParam(defaultValue = "30") int days) {
        return service.listUpcoming(TenantContext.getTenantId(), days);
    }

    @GetMapping("/reminders")
    @PreAuthorize("hasAuthority('hrms.probation.reminders.read')")
    public List<ProbationService.ReminderDto> reminders() {
        return service.listReminders(TenantContext.getTenantId());
    }

    @PostMapping("/scan-now")
    @PreAuthorize("hasAuthority('hrms.probation.config.update')")
    public ProbationService.ScanResult scanNow() {
        return service.scanNow(TenantContext.getTenantId());
    }

    @PostMapping("/employees/{id}/extend")
    @PreAuthorize("hasAuthority('hrms.employee.write')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void extend(@PathVariable UUID id,
                       @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate newEndDate) {
        service.extendProbation(TenantContext.getTenantId(), id, newEndDate);
    }
}
