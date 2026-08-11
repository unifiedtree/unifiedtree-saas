package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * 360° appraisal cycle admin — initiate fan-out, view progress, remind
 * reviewers, close the cycle. Wave 3 (2026-08-11).
 *
 * <p>Sits alongside the existing {@code PerformanceController} (which owns
 * cycle CRUD + individual review authoring) and adds the multi-reviewer
 * orchestration layer.
 *
 * <ul>
 *   <li>Initiate / close → {@code hrms.appraisal.initiate}</li>
 *   <li>Progress read     → {@code hrms.performance.read}</li>
 *   <li>Remind            → {@code hrms.performance.write} (anyone who can
 *       author a review can also nudge one)</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/performance")
public class AppraisalCycleController {

    private final AppraisalCycleService service;

    public AppraisalCycleController(AppraisalCycleService service) {
        this.service = service;
    }

    @PostMapping("/cycles/{id}/initiate")
    @PreAuthorize("hasAuthority('hrms.appraisal.initiate')")
    public AppraisalCycleService.InitiateResultDto initiate(
            @PathVariable UUID id,
            @Valid @RequestBody AppraisalCycleService.InitiateRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.initiate(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @GetMapping("/cycles/{id}/progress")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public AppraisalCycleService.CycleProgressDto progress(@PathVariable UUID id) {
        return service.progress(TenantContext.getTenantId(), id);
    }

    @PostMapping("/cycles/{id}/close")
    @PreAuthorize("hasAuthority('hrms.appraisal.initiate')")
    public AppraisalCycleService.CloseResultDto close(@PathVariable UUID id,
                                                     @AuthenticationPrincipal Jwt jwt) {
        return service.close(TenantContext.getTenantId(), id, actorId(jwt));
    }

    @PostMapping("/reviews/{id}/remind")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public AppraisalCycleService.RemindResultDto remind(@PathVariable UUID id,
                                                        @AuthenticationPrincipal Jwt jwt) {
        return service.remind(TenantContext.getTenantId(), id, actorId(jwt));
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
