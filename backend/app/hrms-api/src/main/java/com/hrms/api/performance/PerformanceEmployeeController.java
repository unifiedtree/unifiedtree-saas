package com.hrms.api.performance;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Performance directory — "list everyone in the org with their latest review
 * rating". Powers the Performance module's landing directory. Wave 1
 * (2026-08-11).
 *
 * <p>Sits alongside {@link PerformanceController} but uses raw JDBC for the
 * cross-schema DISTINCT ON + LEFT JOIN, so it's split into its own controller
 * to keep the JPA-styled PerformanceController focused on state-change flows
 * (create cycle, submit review, edit goal, etc.).
 *
 * <p>Auth: {@code hrms.performance.read} — anyone who can view performance
 * data can view the roster, limited by {@link PerformanceTeamScope}: a
 * department manager sees their team only (2026-09-25).
 */
@RestController
@RequestMapping("/v1/performance/employees")
public class PerformanceEmployeeController {

    private final PerformanceEmployeeService service;
    private final PerformanceTeamScope teamScope;

    public PerformanceEmployeeController(PerformanceEmployeeService service, PerformanceTeamScope teamScope) {
        this.service = service;
        this.teamScope = teamScope;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public PerformanceEmployeeService.PageDto<PerformanceEmployeeService.EmployeePerformanceRowDto> list(
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {
        // Department managers see their team only (2026-09-25); admin / HR see everyone.
        return service.list(TenantContext.getTenantId(), departmentId, search, page, size, teamScope.visibleEmployeeIds());
    }

    /**
     * One person's performance page: reviews, goals and KPIs, and ratings over
     * time. Same permission and scope as the directory: HR / admin see anyone,
     * a department manager only their team (403 otherwise).
     */
    @GetMapping("/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.performance.read')")
    public PerformanceEmployeeService.EmployeeProfileDto profile(@PathVariable UUID employeeId) {
        return service.profile(TenantContext.getTenantId(), employeeId, teamScope.visibleEmployeeIds());
    }
}
