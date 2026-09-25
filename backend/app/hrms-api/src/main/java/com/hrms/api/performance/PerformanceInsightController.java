package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Performance reads for reviewers and employees (2026-09-25).
 *
 * <ul>
 *   <li>{@code GET /v1/performance/reviews/{id}/goals}: the reviewee's goals and
 *       KPIs for the review's cycle. Anyone who writes reviews
 *       ({@code hrms.performance.review.self}) or reads performance
 *       ({@code hrms.performance.read}) may call it; the service then allows
 *       only the assigned reviewer, the reviewee, or someone whose performance
 *       scope covers the reviewee.</li>
 *   <li>{@code GET /v1/performance/goals/my/{id}/history}: the progress history
 *       of one of your own goals or KPIs.</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/performance")
public class PerformanceInsightController {

    private final PerformanceInsightService service;

    public PerformanceInsightController(PerformanceInsightService service) {
        this.service = service;
    }

    @GetMapping("/reviews/{id}/goals")
    @PreAuthorize("hasAnyAuthority('hrms.performance.review.self','hrms.performance.read')")
    public PerformanceInsightService.ReviewGoalsDto reviewGoals(@PathVariable UUID id) {
        return service.reviewGoals(TenantContext.getTenantId(), id);
    }

    @GetMapping("/goals/my/{id}/history")
    @PreAuthorize("hasAuthority('hrms.performance.review.self')")
    public List<KpiService.ProgressUpdateDto> myGoalHistory(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return service.myGoalHistory(TenantContext.getTenantId(), id, employeeId(jwt));
    }

    /** The employee_id claim only; a login without an employee record owns no goals. */
    static UUID employeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try { return UUID.fromString(claim.trim()); } catch (IllegalArgumentException e) { return null; }
    }
}
