package com.hrms.api.settings;

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
 * Celebrations settings (V143.89; {@link CelebrationSettingService}), per
 * company, in HR configuration.
 * <ul>
 *   <li>{@code GET /v1/settings/celebrations?companyId=}: whether colleagues see
 *       each other's birthdays. Readable by whoever can read HR configuration
 *       (the same permissions as {@code GET /v1/settings/hr-configuration}).</li>
 *   <li>{@code PUT} the same path: change it, with {@code settings.hrconfig.write}
 *       (the permission that edits HR configuration).</li>
 * </ul>
 * Both answer 503 FEATURE_NOT_READY while V143.89 isn't applied. No new permission.
 * Everyone else never reads this: the celebrations lists apply it on the server.
 */
@RestController
@RequestMapping("/v1/settings/celebrations")
@Tag(name = "Celebrations settings", description = "Whether colleagues see each other's birthdays")
@SecurityRequirement(name = "bearerAuth")
public class CelebrationSettingController {

    private static final Logger log = LoggerFactory.getLogger(CelebrationSettingController.class);

    private final CelebrationSettingService settings;
    private final EmployeeRepository employees;
    @Autowired(required = false)
    private AuditService audit;

    public CelebrationSettingController(CelebrationSettingService settings, EmployeeRepository employees) {
        this.settings = settings;
        this.employees = employees;
    }

    @Operation(summary = "Whether colleagues in a company see each other's birthdays")
    @GetMapping
    @PreAuthorize("hasAnyAuthority('settings.read','settings.hrconfig.write','hrms.employee.write','attendance.policy.manage')")
    public CelebrationSettingService.Setting setting(@RequestParam UUID companyId) {
        return settings.setting(companyId);
    }

    @Operation(summary = "Show or hide birthdays to colleagues in a company")
    @PutMapping
    @PreAuthorize("hasAuthority('settings.hrconfig.write')")
    public CelebrationSettingService.Setting save(@RequestParam UUID companyId,
                                                 @RequestBody CelebrationSettingService.SaveRequest body,
                                                 @AuthenticationPrincipal Jwt jwt) {
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        CelebrationSettingService.Setting saved = settings.save(companyId, body, userId, callerName(jwt));
        audit(companyId, saved.showBirthdays()
                ? "Colleagues see each other's birthdays on Celebrations."
                : "Birthdays are hidden from colleagues on Celebrations.");
        return saved;
    }

    private String callerName(Jwt jwt) {
        String name = null;
        try {
            String raw = jwt.getClaimAsString("employee_id");
            if (raw != null && !raw.isBlank()) {
                name = employees.findById(UUID.fromString(raw))
                        .map(e -> ((e.getFirstName() == null ? "" : e.getFirstName().trim()) + " "
                                + (e.getLastName() == null ? "" : e.getLastName().trim())).trim())
                        .orElse(null);
            }
        } catch (RuntimeException ignored) {
            // no employee record
        }
        return name == null || name.isBlank() ? jwt.getClaimAsString("email") : name;
    }

    private void audit(UUID companyId, String summary) {
        if (audit == null) return;
        try {
            audit.record("settings", "CELEBRATION_SETTING_CHANGED", "company", companyId, summary);
        } catch (RuntimeException e) {
            log.warn("Audit write failed for CELEBRATION_SETTING_CHANGED: {}", e.getMessage());
        }
    }
}
