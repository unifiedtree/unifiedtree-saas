package com.hrms.api.attendance;

import com.hrms.attendance.policy.AttendancePolicyService;
import com.hrms.attendance.policy.AttendancePolicyService.PolicyUpdate;
import com.hrms.attendance.policy.AttendancePolicyService.PolicyView;
import com.hrms.core.exception.BusinessRuleException;
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
 * A company's attendance timing policy (V143.10): grace, start time for people
 * without a shift, half-day rules, minimum hours, early leave and the late
 * allowance. Anyone signed in may read it (it's the rule their day is judged
 * by); changing it needs {@code attendance.policy.manage}.
 */
@RestController
@RequestMapping("/v1/attendance/policy")
@Tag(name = "Attendance policy", description = "Per-company attendance timing rules")
@SecurityRequirement(name = "bearerAuth")
public class AttendancePolicyController {

    private final AttendancePolicyService policies;
    private final EmployeeRepository employees;
    @Autowired(required = false)
    private AuditService audit;

    public AttendancePolicyController(AttendancePolicyService policies, EmployeeRepository employees) {
        this.policies = policies;
        this.employees = employees;
    }

    @Operation(summary = "A company's attendance timing policy (defaults are stored on first read)")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public PolicyView get(@RequestParam(required = false) UUID companyId, @AuthenticationPrincipal Jwt jwt) {
        return policies.getOrCreate(companyId != null ? companyId : callerCompany(jwt));
    }

    @Operation(summary = "Save a company's attendance timing policy")
    @PutMapping
    @PreAuthorize("hasAuthority('attendance.policy.manage')")
    public PolicyView update(@RequestParam(required = false) UUID companyId,
                             @RequestBody PolicyUpdate body,
                             @AuthenticationPrincipal Jwt jwt) {
        UUID company = companyId != null ? companyId : callerCompany(jwt);
        UUID userId = null;
        try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
        String name = null;
        try {
            name = employees.findById(AttendanceReviewService.callerEmployeeId(jwt)).map(AttendanceReviewService::name).orElse(null);
        } catch (Exception ignored) { /* no employee record */ }
        if (name == null) name = jwt.getClaimAsString("email");
        PolicyView saved = policies.update(company, body, userId, name);
        if (audit != null) {
            try {
                audit.record("attendance", "POLICY_UPDATED", "company", company,
                        "Attendance policy saved: grace %d min, start %s, allowance %d per %s then %s".formatted(
                                saved.graceMinutes(), saved.defaultStartTime(), saved.lateAllowanceCount(),
                                saved.lateAllowancePeriod().toLowerCase(), saved.afterAllowanceAction()));
            } catch (Exception ignored) { /* audit is best-effort */ }
        }
        return saved;
    }

    private UUID callerCompany(Jwt jwt) {
        return employees.findById(AttendanceReviewService.callerEmployeeId(jwt))
                .map(e -> e.getCompanyId())
                .orElseThrow(() -> new BusinessRuleException("Choose a company.", "COMPANY_REQUIRED"));
    }
}
