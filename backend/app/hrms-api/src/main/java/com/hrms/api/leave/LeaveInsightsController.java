package com.hrms.api.leave;

import com.unifiedtree.rbac.company.CompanyAccessService;
import com.hrms.core.dto.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Reads for the redesigned Leave pages (HRMS redesign, 27 Sep 2026): the
 * Approvals tab's stats (BW-37), the calendar's date-range feed (BW-39),
 * "All balances" and "Leave used this year" (BW-44), and the apply planner's
 * colleagues off (BW-47). See {@link LeaveInsightsService} for the scopes.
 *
 * <p>Level: the {@code hrms.leave.approve.l2} authority means the whole
 * workspace, exactly as the existing approval lists decide it.
 */
@RestController
@RequestMapping("/v1/leave")
@Tag(name = "Leave", description = "Leave applications, approvals, balances, and policies")
@SecurityRequirement(name = "bearerAuth")
public class LeaveInsightsController {

    /** Company access: an optional companyId left out means the caller's current company, not every company (COMPANY_ACCESS.md). */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private CompanyAccessService companyAccess;

    static final String LEVEL_TWO = "hrms.leave.approve.l2";
    static final String LEVEL_ONE = "hrms.leave.approve.l1";

    private final LeaveInsightsService insights;

    public LeaveInsightsController(LeaveInsightsService insights) {
        this.insights = insights;
    }

    @Operation(summary = "Approval stats: waiting, new in 24 h, approved this month with a monthly series, on leave today and the next working day, average decision time")
    @GetMapping("/approvals/stats")
    @PreAuthorize("@perm.check('hrms.leave.approve.l1')")
    public ResponseEntity<LeaveInsightsService.ApprovalStats> stats(@RequestParam(defaultValue = "7") int months,
                                                                     @AuthenticationPrincipal Jwt jwt,
                                                                     Authentication auth) {
        return ResponseEntity.ok(insights.approvalStats(employeeId(jwt), holds(auth, LEVEL_TWO), months,
                LocalDate.now(LeaveInsightsService.IST)));
    }

    @Operation(summary = "Leave between two dates (at most 62 days): the workspace for HR, the team for approvers, else your own")
    @GetMapping("/calendar")
    @PreAuthorize("hasAnyAuthority('hrms.leave.approve.l1','leave.balance.read')")
    public ResponseEntity<LeaveInsightsService.CalendarFeed> calendar(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) List<String> statuses,
            @AuthenticationPrincipal Jwt jwt,
            Authentication auth) {
        return ResponseEntity.ok(insights.calendar(employeeId(jwt), scopeOf(auth), from, to, statuses));
    }

    @Operation(summary = "Colleagues off: first names of people in your department on approved leave, per working day (at most 62 days)")
    @GetMapping("/team-off")
    @PreAuthorize("hasAuthority('leave.balance.read')")
    public ResponseEntity<LeaveInsightsService.ColleaguesOff> colleaguesOff(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(insights.colleaguesOff(employeeId(jwt), from, to));
    }

    @Operation(summary = "Everyone's leave balances for a year, a page of people at a time (everyone still working here)")
    @GetMapping("/balances")
    @PreAuthorize("hasAnyAuthority('hrms.leave.employee.read','hrms.report.leave')")
    public ResponseEntity<PageResponse<LeaveInsightsService.PersonBalances>> balances(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) Integer year,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        companyId = CompanyAccessService.listCompanyId(companyAccess, companyId);
        return ResponseEntity.ok(insights.balances(companyId, yearOrNow(year), q, page, size));
    }

    @Operation(summary = "Leave used this year per leave type: days used, waiting and granted, across everyone still working here")
    @GetMapping("/usage")
    @PreAuthorize("hasAnyAuthority('hrms.leave.employee.read','hrms.report.leave')")
    public ResponseEntity<LeaveInsightsService.Usage> usage(@RequestParam(required = false) UUID companyId,
                                                            @RequestParam(required = false) Integer year) {
        companyId = CompanyAccessService.listCompanyId(companyAccess, companyId);
        return ResponseEntity.ok(insights.usage(companyId, yearOrNow(year)));
    }

    /** The leave year is the India calendar year. */
    private static int yearOrNow(Integer year) {
        return year != null ? year : LocalDate.now(LeaveInsightsService.IST).getYear();
    }

    static LeaveInsightsService.Scope scopeOf(Authentication auth) {
        if (holds(auth, LEVEL_TWO)) return LeaveInsightsService.Scope.TENANT;
        if (holds(auth, LEVEL_ONE)) return LeaveInsightsService.Scope.TEAM;
        return LeaveInsightsService.Scope.SELF;
    }

    static boolean holds(Authentication auth, String authority) {
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    static UUID employeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
