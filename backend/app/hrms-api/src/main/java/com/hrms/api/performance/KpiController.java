package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * KPI administration — list, create, update, progress bumps, soft-delete.
 * Wave 4 (2026-08-11).
 *
 * <ul>
 *   <li>Read  → {@code hrms.performance.read}</li>
 *   <li>Manage (create / update / delete) → {@code hrms.kpi.manage}</li>
 *   <li>Progress bump → {@code hrms.performance.write} (matches goal-progress
 *       from the existing PerformanceController)</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/performance/kpis")
public class KpiController {

    private final KpiService service;

    public KpiController(KpiService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public KpiService.PageDto<KpiService.KpiRowDto> list(
            @RequestParam(required = false) UUID ownerId,
            @RequestParam(required = false) UUID managerId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        return service.list(TenantContext.getTenantId(), ownerId, managerId,
                status, search, page, size);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public KpiService.KpiRowDto get(@PathVariable UUID id) {
        return service.get(TenantContext.getTenantId(), id);
    }

    @GetMapping("/{id}/history")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public List<KpiService.ProgressUpdateDto> history(@PathVariable UUID id) {
        return service.progressHistory(TenantContext.getTenantId(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.kpi.manage')")
    public KpiService.KpiRowDto create(@Valid @RequestBody KpiService.CreateKpiRequest req,
                                      @AuthenticationPrincipal Jwt jwt) {
        return service.create(TenantContext.getTenantId(), req, actorId(jwt));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.kpi.manage')")
    public KpiService.KpiRowDto update(@PathVariable UUID id,
                                      @Valid @RequestBody KpiService.UpdateKpiRequest req,
                                      @AuthenticationPrincipal Jwt jwt) {
        return service.update(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @PutMapping("/{id}/progress")
    @PreAuthorize("hasAuthority('hrms.performance.write')")
    public KpiService.KpiRowDto updateProgress(
            @PathVariable UUID id,
            @Valid @RequestBody KpiService.ProgressUpdateRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return service.updateProgress(TenantContext.getTenantId(), id, req, actorId(jwt));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.kpi.manage')")
    public void delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        service.softDelete(TenantContext.getTenantId(), id, actorId(jwt));
    }

    private static UUID actorId(Jwt jwt) {
        if (jwt == null) return null;
        try { return UUID.fromString(jwt.getSubject()); } catch (Exception e) { return null; }
    }
}
