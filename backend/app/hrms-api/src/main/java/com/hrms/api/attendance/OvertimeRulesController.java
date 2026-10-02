package com.hrms.api.attendance;

import com.hrms.api.attendance.OvertimeRules.Rules;
import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.audit.AuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
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
 * Company overtime rules (BW-29 / DECISIONS 22, contract C0 {@code useOvertimeRules} /
 * {@code useSaveOvertimeRules}): the minimum overtime (a threshold, 60 minutes by
 * default) and a monthly approval cap. See {@link OvertimeRules}.
 *
 * <ul>
 *   <li>{@code GET /v1/attendance/overtime-rules?companyId=} → the rules (the default minimum when never set).
 *       Read with {@code attendance.team.read} (the Overtime tab's card), or
 *       {@code attendance.policy.manage} (the people who edit them).</li>
 *   <li>{@code PUT /v1/attendance/overtime-rules?companyId=} {@code {minimumMinutes, monthlyCapMinutes}}
 *       → the saved rules. {@code attendance.policy.manage}. A null minimum goes back to the default; a null cap is no cap.</li>
 * </ul>
 * Both answer 503 FEATURE_NOT_READY while V143.54 is not applied.
 */
@RestController
@RequestMapping("/v1/attendance/overtime-rules")
@Tag(name = "Overtime rules", description = "Per-company overtime counting rules")
@SecurityRequirement(name = "bearerAuth")
public class OvertimeRulesController {

    /** The response: exactly the contract's OvertimeRules. */
    public record OvertimeRulesResponse(UUID companyId, int minimumMinutes, boolean minimumIsDefault,
                                        int defaultMinimumMinutes, Integer monthlyCapMinutes,
                                        String updatedByName, java.time.Instant updatedAt) {
        static OvertimeRulesResponse of(Rules r) {
            return new OvertimeRulesResponse(r.companyId(), r.minimumMinutes(), r.minimumIsDefault(),
                    OvertimeRules.DEFAULT_MINIMUM, r.monthlyCapMinutes(), r.updatedByName(), r.updatedAt());
        }
    }

    /** The PUT body: whole minutes, 0 or more. A null minimum is the default (60); a null cap is no cap. */
    public record SaveOvertimeRulesRequest(Integer minimumMinutes, Integer monthlyCapMinutes) {}

    private final OvertimeRules rules;
    private final EmployeeRepository employees;
    @Autowired(required = false)
    private AuditService audit;

    public OvertimeRulesController(OvertimeRules rules, EmployeeRepository employees) {
        this.rules = rules;
        this.employees = employees;
    }

    @Operation(summary = "A company's overtime rules (the default minimum when none is set)")
    @GetMapping
    @PreAuthorize("hasAnyAuthority('attendance.team.read', 'attendance.policy.manage')")
    public OvertimeRulesResponse get(@RequestParam("companyId") UUID companyId) {
        return OvertimeRulesResponse.of(rules.get(companyId));
    }

    @Operation(summary = "Save a company's overtime rules (a null minimum is the default, a null cap is no cap)")
    @PutMapping
    @PreAuthorize("hasAuthority('attendance.policy.manage')")
    public OvertimeRulesResponse save(@RequestParam("companyId") UUID companyId,
                                      @RequestBody SaveOvertimeRulesRequest body,
                                      @AuthenticationPrincipal Jwt jwt) {
        SaveOvertimeRulesRequest in = body == null ? new SaveOvertimeRulesRequest(null, null) : body;
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        String name = null;
        try {
            name = employees.findById(AttendanceReviewService.callerEmployeeId(jwt)).map(AttendanceReviewService::name).orElse(null);
        } catch (Exception ignored) { /* no employee record */ }
        if (name == null) name = jwt.getClaimAsString("email");
        Rules saved = rules.save(companyId, in.minimumMinutes(), in.monthlyCapMinutes(), userId, name);
        if (audit != null) {
            try {
                audit.record("attendance", "OVERTIME_RULES_UPDATED", "company", companyId,
                        "Overtime rules saved: minimum %s, monthly cap %s".formatted(
                                saved.minimumMinutes() + " min" + (saved.minimumIsDefault() ? " (default)" : ""),
                                saved.monthlyCapMinutes() == null ? "none" : saved.monthlyCapMinutes() + " min"));
            } catch (Exception ignored) { /* audit is best-effort */ }
        }
        return OvertimeRulesResponse.of(saved);
    }
}
