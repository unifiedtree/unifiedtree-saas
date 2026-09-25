package com.hrms.api.learning;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Skill self-assessment (V143.21).
 *
 * <ul>
 *   <li>Employee: {@code hrms.learning.skill.assess.self}: list your proposals,
 *       propose a level, withdraw a waiting proposal. The employee always comes
 *       from the token, never the request.</li>
 *   <li>Approver: {@code hrms.learning.skill.approve}: the queue and the decision.
 *       Managers see their team only; {@code hrms.learning.write} holders (HR)
 *       see everyone. Checked in {@link SkillAssessmentService}.</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/learning/skill-assessments")
public class SkillAssessmentController {

    private final SkillAssessmentService service;

    public SkillAssessmentController(SkillAssessmentService service) {
        this.service = service;
    }

    @GetMapping("/me")
    @PreAuthorize("hasAuthority('hrms.learning.skill.assess.self')")
    public List<SkillAssessmentService.AssessmentDto> mine(@AuthenticationPrincipal Jwt jwt) {
        return service.mine(TenantContext.getTenantId(), employeeId(jwt));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.learning.skill.assess.self')")
    public SkillAssessmentService.AssessmentDto propose(@Valid @RequestBody SkillAssessmentService.ProposeRequest req,
                                                       @AuthenticationPrincipal Jwt jwt) {
        return service.propose(TenantContext.getTenantId(), employeeId(jwt), req, userId(jwt));
    }

    @PostMapping("/{id}/withdraw")
    @PreAuthorize("hasAuthority('hrms.learning.skill.assess.self')")
    public SkillAssessmentService.AssessmentDto withdraw(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return service.withdraw(TenantContext.getTenantId(), id, employeeId(jwt), userId(jwt));
    }

    /** {@code view=PENDING} (default): waiting for a decision; {@code view=DECIDED}: recent decisions. */
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.learning.skill.approve')")
    public List<SkillAssessmentService.AssessmentDto> queue(@RequestParam(defaultValue = "PENDING") String view,
                                                           Authentication auth) {
        return service.queue(TenantContext.getTenantId(), view, auth);
    }

    @PostMapping("/{id}/decide")
    @PreAuthorize("hasAuthority('hrms.learning.skill.approve')")
    public SkillAssessmentService.AssessmentDto decide(@PathVariable UUID id,
                                                      @Valid @RequestBody SkillAssessmentService.DecideRequest req,
                                                      Authentication auth) {
        Jwt jwt = auth != null && auth.getPrincipal() instanceof Jwt j ? j : null;
        return service.decide(TenantContext.getTenantId(), id, req, auth, userId(jwt));
    }

    private static UUID employeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try { return UUID.fromString(claim.trim()); } catch (IllegalArgumentException e) { return null; }
    }

    private static UUID userId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
