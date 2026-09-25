package com.hrms.api.hiring;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The pipeline board across roles, interview scheduling and scorecards (V143.20).
 *
 * <ul>
 *   <li>{@code hrms.hiring.read}: the board, every interview and every scorecard.</li>
 *   <li>{@code hrms.hiring.interview.write}: schedule, reschedule and cancel.</li>
 *   <li>{@code hrms.hiring.interview.self}: the interviews you are on, and your own scorecard.</li>
 * </ul>
 */
@RestController
@RequestMapping("/v1/hiring")
@Tag(name = "Hiring interviews", description = "Interview scheduling and scorecards")
@SecurityRequirement(name = "bearerAuth")
public class InterviewController {

    private final InterviewService interviews;

    public InterviewController(InterviewService interviews) {
        this.interviews = interviews;
    }

    public record ScheduleRequest(String title, LocalDateTime scheduledAt, Integer durationMinutes, String mode,
                                  String location, List<UUID> interviewerIds, List<String> criteria, String notes) {
        InterviewRules.Schedule toRules() {
            return new InterviewRules.Schedule(title, scheduledAt, durationMinutes, mode, location, interviewerIds, criteria, notes);
        }
    }

    public record CancelRequest(String reason) {}

    @Operation(summary = "Candidates across the pipeline (optionally one role, one stage, one company), with interview and scorecard summaries")
    @GetMapping("/candidates")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public List<InterviewService.CandidateCard> candidates(@RequestParam(required = false) UUID requisitionId,
                                                           @RequestParam(required = false) String stage,
                                                           @RequestParam(required = false) UUID companyId) {
        return interviews.candidates(requisitionId, stage, companyId);
    }

    @Operation(summary = "Every interview of a candidate, with all scorecards")
    @GetMapping("/candidates/{candidateId}/interviews")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public List<InterviewService.Interview> candidateInterviews(@PathVariable UUID candidateId) {
        return interviews.forCandidate(candidateId);
    }

    @Operation(summary = "Schedule an interview for a candidate in Screening or Interview; the interviewers are notified")
    @PostMapping("/candidates/{candidateId}/interviews")
    @PreAuthorize("hasAuthority('hrms.hiring.interview.write')")
    public ResponseEntity<InterviewService.Interview> schedule(@PathVariable UUID candidateId, @RequestBody ScheduleRequest body,
                                                               @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED).body(interviews.schedule(candidateId, body == null ? null : body.toRules(), userId(jwt)));
    }

    @Operation(summary = "Upcoming interviews (scheduled and not finished yet), soonest first")
    @GetMapping("/interviews")
    @PreAuthorize("hasAuthority('hrms.hiring.read')")
    public List<InterviewService.Interview> upcoming(@RequestParam(required = false) UUID companyId) {
        return interviews.upcoming(companyId);
    }

    @Operation(summary = "The interviews the signed-in employee is on (upcoming and the last 60 days), with their own scorecard")
    @GetMapping("/interviews/mine")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.interview.self','hrms.hiring.read')")
    public List<InterviewService.Interview> mine(@AuthenticationPrincipal Jwt jwt) {
        return interviews.mine(employeeId(jwt));
    }

    @Operation(summary = "One interview: hiring roles see every scorecard, an interviewer only their own")
    @GetMapping("/interviews/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.interview.self','hrms.hiring.read')")
    public InterviewService.Interview get(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return interviews.get(id, employeeId(jwt), hiringRole(jwt));
    }

    @Operation(summary = "Reschedule or change an interview; new, removed and (when the time or place changed) remaining interviewers are notified")
    @PutMapping("/interviews/{id}")
    @PreAuthorize("hasAuthority('hrms.hiring.interview.write')")
    public InterviewService.Interview reschedule(@PathVariable UUID id, @RequestBody ScheduleRequest body, @AuthenticationPrincipal Jwt jwt) {
        return interviews.reschedule(id, body == null ? null : body.toRules(), userId(jwt));
    }

    @Operation(summary = "Cancel an interview that has no feedback yet; the interviewers are notified")
    @PostMapping("/interviews/{id}/cancel")
    @PreAuthorize("hasAuthority('hrms.hiring.interview.write')")
    public InterviewService.Interview cancel(@PathVariable UUID id, @RequestBody(required = false) CancelRequest body,
                                             @AuthenticationPrincipal Jwt jwt) {
        return interviews.cancel(id, body == null ? null : body.reason(), userId(jwt));
    }

    @Operation(summary = "Submit or correct your own scorecard (assigned interviewers only, once the interview has started)")
    @PutMapping("/interviews/{id}/scorecard")
    @PreAuthorize("hasAnyAuthority('hrms.hiring.interview.self','hrms.hiring.read')")
    public InterviewService.Interview scorecard(@PathVariable UUID id, @RequestBody InterviewService.ScorecardRequest body,
                                                @AuthenticationPrincipal Jwt jwt) {
        return interviews.submitScorecard(id, employeeId(jwt), body, hiringRole(jwt));
    }

    private static boolean hiringRole(Jwt jwt) {
        List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains("hrms.hiring.read");
    }

    /** The caller's employee record, or null for an account without one (it then has no interviews of its own). */
    private static UUID employeeId(Jwt jwt) {
        String id = jwt.getClaimAsString("employee_id");
        return id == null || id.isBlank() ? null : UUID.fromString(id);
    }

    private static UUID userId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (RuntimeException e) {
            return null;
        }
    }
}
