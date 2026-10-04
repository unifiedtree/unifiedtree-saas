package com.hrms.api.attendance;

import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.audit.AuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Punch-in alerts settings (V143.72; {@link PunchAlertSettingsService}), per
 * company, in HR configuration next to the other attendance rules.
 * <ul>
 *   <li>{@code GET /v1/attendance/punch-alert-setting?companyId=}: who gets the
 *       alerts. Readable by whoever can see HR configuration's attendance rules:
 *       {@code settings.hrconfig.write}, {@code attendance.policy.manage} or
 *       {@code settings.read}.</li>
 *   <li>{@code PUT} the same path: change it, with {@code settings.hrconfig.write}
 *       or {@code attendance.policy.manage}, the permissions that edit attendance
 *       settings (as the web check-in switch).</li>
 *   <li>{@code GET .../options?companyId=}: the roles and people that can be
 *       picked, for the people who can change it.</li>
 * </ul>
 * GET and PUT answer 503 FEATURE_NOT_READY while V143.72 isn't applied. No new permission.
 */
@RestController
@RequestMapping("/v1/attendance/punch-alert-setting")
@Tag(name = "Attendance punch-in alerts", description = "Who is told when someone punches in")
@SecurityRequirement(name = "bearerAuth")
public class PunchAlertSettingsController {

    private static final Logger log = LoggerFactory.getLogger(PunchAlertSettingsController.class);

    private final PunchAlertSettingsService settings;
    private final EmployeeRepository employees;
    @Autowired(required = false)
    private AuditService audit;

    public PunchAlertSettingsController(PunchAlertSettingsService settings, EmployeeRepository employees) {
        this.settings = settings;
        this.employees = employees;
    }

    @Operation(summary = "Who gets punch-in alerts in a company")
    @GetMapping
    @PreAuthorize("hasAnyAuthority('settings.hrconfig.write','attendance.policy.manage','settings.read')")
    public PunchAlertSettingsService.Setting setting(@RequestParam UUID companyId) {
        return settings.setting(companyId);
    }

    @Operation(summary = "Change who gets punch-in alerts in a company")
    @PutMapping
    @PreAuthorize("hasAnyAuthority('settings.hrconfig.write','attendance.policy.manage')")
    public PunchAlertSettingsService.Setting save(@RequestParam UUID companyId,
                                                  @RequestBody PunchAlertSettingsService.SaveRequest body,
                                                  @AuthenticationPrincipal Jwt jwt) {
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        PunchAlertSettingsService.Setting saved = settings.save(companyId, body, userId, callerName(jwt));
        audit(companyId, "Punch-in alerts now go to " + describe(saved) + ".");
        return saved;
    }

    @Operation(summary = "The roles and people that can be picked for punch-in alerts")
    @GetMapping("/options")
    @PreAuthorize("hasAnyAuthority('settings.hrconfig.write','attendance.policy.manage')")
    public PunchAlertSettingsService.Options options(@RequestParam UUID companyId) {
        return settings.options(companyId);
    }

    /** "the reporting manager, 2 people and 1 role, for late or outside-office punch-ins only". */
    static String describe(PunchAlertSettingsService.Setting s) {
        java.util.List<String> who = new java.util.ArrayList<>();
        if (s.notifyManager()) who.add("the reporting manager");
        if (!s.people().isEmpty()) who.add(s.people().size() + (s.people().size() == 1 ? " person" : " people"));
        if (!s.roles().isEmpty()) who.add(s.roles().size() + (s.roles().size() == 1 ? " role" : " roles"));
        String list = who.isEmpty() ? "nobody" : who.size() == 1 ? who.get(0)
                : String.join(", ", who.subList(0, who.size() - 1)) + " and " + who.get(who.size() - 1);
        return list + (PunchAlertSettingsService.LATE_OR_OUTSIDE.equals(s.alertOn())
                ? ", for late or outside-office punch-ins only" : ", for every punch-in");
    }

    private String callerName(Jwt jwt) {
        String name = null;
        try {
            UUID self = AttendanceReviewService.callerEmployeeId(jwt);
            if (self != null) name = employees.findById(self).map(AttendanceReviewService::name).orElse(null);
        } catch (RuntimeException ignored) {
            // no employee record
        }
        return name == null || name.isBlank() ? jwt.getClaimAsString("email") : name;
    }

    private void audit(UUID companyId, String summary) {
        if (audit == null) return;
        try {
            audit.record("attendance", "PUNCH_ALERT_SETTING_CHANGED", "company", companyId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for PUNCH_ALERT_SETTING_CHANGED: {}", e.getMessage());
        }
    }
}
