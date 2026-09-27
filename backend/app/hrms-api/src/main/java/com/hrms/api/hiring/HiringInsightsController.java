package com.hrms.api.hiring;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/** The Hiring page's summary, funnel and "your interviews" numbers (redesign BW-65, BW-66, BW-68). */
@RestController
@RequestMapping("/v1/hiring")
@Tag(name = "Hiring", description = "Job requisitions and candidate pipeline")
@SecurityRequirement(name = "bearerAuth")
public class HiringInsightsController {

    private final HiringInsightsService insights;

    public HiringInsightsController(HiringInsightsService insights) {
        this.insights = insights;
    }

    @Operation(summary = "Requisitions by status, positions to fill, candidates this quarter and the stages of candidates on open roles")
    @GetMapping("/summary")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public HiringInsightsService.Summary summary(@RequestParam(required = false) UUID companyId) {
        return insights.summary(companyId, today());
    }

    @Operation(summary = "How far the candidates added in a period got, conversion between stages and time to hire (from the stage history; this quarter by default)")
    @GetMapping("/funnel")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public HiringInsightsService.Funnel funnel(
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate today = today();
        LocalDate start = from != null ? from : HiringInsightsService.quarterStart(today);
        LocalDate end = to != null ? to : HiringInsightsService.quarterStart(today).plusMonths(3).minusDays(1);
        return insights.funnel(companyId, start, end);
    }

    @Operation(summary = "The signed-in interviewer's quarter: interviews taken, scorecards submitted and due, interviews to come")
    @GetMapping("/interviews/mine/summary")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.interview.self','hrms.hiring.read')")
    public HiringInsightsService.MyInterviews myInterviews(@AuthenticationPrincipal Jwt jwt) {
        return insights.myInterviews(employeeId(jwt), today());
    }

    private static LocalDate today() {
        return LocalDate.now(HiringInsightsService.IST);
    }

    /** The caller's employee record; null for an account without one (their numbers are then all zero). */
    private static UUID employeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try {
            return UUID.fromString(claim);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
