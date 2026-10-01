package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.audit.AuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Where people may punch from (V143.53 redesign; {@link PunchRulesService}).
 * <ul>
 *   <li>{@code GET/PUT /v1/attendance/web-punch-setting?companyId=} — the
 *       company switch "Allow web check-in" (BW-24). Anyone signed in may read
 *       it ("Your day" needs it); changing it needs
 *       {@code settings.hrconfig.write} or {@code attendance.policy.manage},
 *       the two HR Configuration permissions.</li>
 *   <li>{@code GET/PUT /v1/attendance/punch-rules/{employeeId}} — "Anywhere (no
 *       geofence)" for one person (BW-28), with
 *       {@code attendance.workforce.admin}, the permission that already assigns
 *       shifts and records attendance for others. Nobody changes their own.</li>
 * </ul>
 * All four answer 503 FEATURE_NOT_READY while V143.53 isn't applied.
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance punch rules", description = "Web check-in switch and per-person punch rules")
@SecurityRequirement(name = "bearerAuth")
public class PunchRulesController {

    private static final Logger log = LoggerFactory.getLogger(PunchRulesController.class);

    private final PunchRulesService rules;
    private final EmployeeRepository employees;
    @Autowired(required = false)
    private AuditService audit;

    public PunchRulesController(PunchRulesService rules, EmployeeRepository employees) {
        this.rules = rules;
        this.employees = employees;
    }

    public record SaveWebPunchSetting(Boolean allowWebPunch) {}

    public record SavePunchRule(Boolean allowAnywhere) {}

    @Operation(summary = "Whether the company allows web check-in (off by default)")
    @GetMapping("/web-punch-setting")
    @PreAuthorize("isAuthenticated()")
    public PunchRulesService.WebPunchSetting webPunchSetting(@RequestParam UUID companyId) {
        return rules.setting(companyId);
    }

    @Operation(summary = "Turn web check-in on or off for a company")
    @PutMapping("/web-punch-setting")
    @PreAuthorize("hasAnyAuthority('settings.hrconfig.write','attendance.policy.manage')")
    public PunchRulesService.WebPunchSetting saveWebPunchSetting(@RequestParam UUID companyId,
                                                                 @RequestBody SaveWebPunchSetting body) {
        if (body == null || body.allowWebPunch() == null) {
            throw new BusinessRuleException("Say whether web check-in is allowed.", "WEB_PUNCH_SETTING_REQUIRED");
        }
        PunchRulesService.WebPunchSetting saved = rules.save(companyId, body.allowWebPunch());
        audit("WEB_PUNCH_SETTING_CHANGED", "company", companyId,
                "Web check-in turned " + (saved.allowWebPunch() ? "on" : "off") + " for the company.");
        return saved;
    }

    @Operation(summary = "One person's punch rules (Anywhere: no geofence)")
    @GetMapping("/punch-rules/{employeeId}")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public PunchRulesService.PunchRule punchRule(@PathVariable UUID employeeId) {
        return rules.rule(employeeId);
    }

    @Operation(summary = "Let one person check in from anywhere (no geofence), or not")
    @PutMapping("/punch-rules/{employeeId}")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public PunchRulesService.PunchRule savePunchRule(@PathVariable UUID employeeId,
                                                     @RequestBody SavePunchRule body,
                                                     @AuthenticationPrincipal Jwt jwt) {
        if (body == null || body.allowAnywhere() == null) {
            throw new BusinessRuleException("Say whether this person may check in from anywhere.", "PUNCH_RULE_REQUIRED");
        }
        UUID self = callerEmployeeId(jwt);
        if (employeeId.equals(self)) {
            throw new AccessDeniedException("You can't change your own punch rules.");
        }
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        String name = self == null ? null : employees.findById(self).map(AttendanceReviewService::name).orElse(null);
        if (name == null || name.isBlank()) name = jwt.getClaimAsString("email");
        PunchRulesService.PunchRule saved = rules.saveRule(employeeId, body.allowAnywhere(), userId, name);
        String who = employees.findById(employeeId).map(AttendanceReviewService::name).orElse("An employee");
        audit("PUNCH_RULE_CHANGED", "employee", employeeId, who + (saved.allowAnywhere()
                ? " may now check in from anywhere (no geofence)." : " must check in inside their work area again."));
        return saved;
    }

    private static UUID callerEmployeeId(Jwt jwt) {
        try {
            return AttendanceReviewService.callerEmployeeId(jwt);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private void audit(String action, String entityType, UUID entityId, String summary) {
        if (audit == null) return;
        try {
            audit.record("attendance", action, entityType, entityId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for {}: {}", action, e.getMessage());
        }
    }
}
