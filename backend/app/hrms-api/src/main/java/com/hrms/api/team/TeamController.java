package com.hrms.api.team;

import com.hrms.api.approvals.ApprovalsInboxService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Size;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * My team (redesign BW-07, BW-08, BW-09, BW-11, BW-12): the team and how it is
 * chosen, its time off, the Approvals inbox, probation, and team messages.
 * Everything is scoped to the caller's team (TeamEmployeeScope); the inbox
 * uses each request kind's own list rules. /v1/team is behind the HRMS module
 * (TenantModuleGuard).
 */
@RestController
@RequestMapping("/v1/team")
@Tag(name = "My team", description = "The team, its time off, approvals, probation and messages")
@SecurityRequirement(name = "bearerAuth")
public class TeamController {

    private final TeamReadService read;
    private final ApprovalsInboxService inbox;
    private final TeamProbationService probation;
    private final TeamMessageService messages;

    public TeamController(TeamReadService read, ApprovalsInboxService inbox, TeamProbationService probation,
                          TeamMessageService messages) {
        this.read = read;
        this.inbox = inbox;
        this.probation = probation;
        this.messages = messages;
    }

    @Operation(summary = "The caller's team: how it is chosen, its departments and its members")
    @GetMapping("/summary")
    @PreAuthorize("hasAnyAuthority('attendance.team.read','hrms.leave.approve.l1')")
    public TeamReadService.TeamSummary summary(@AuthenticationPrincipal Jwt jwt) {
        return read.summary(jwt);
    }

    @Operation(summary = "The team's leave and work from home, approved and waiting, in a range of up to 62 days")
    @GetMapping("/time-off")
    @PreAuthorize("hasAnyAuthority('attendance.team.read','hrms.leave.approve.l1','wfh.approve')")
    public List<TeamReadService.TimeOffEntry> timeOff(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @AuthenticationPrincipal Jwt jwt, Authentication auth) {
        return read.timeOff(from, to, jwt, auth);
    }

    @Operation(summary = "The Approvals inbox: every request waiting for the caller, newest first, with counts per tab")
    @GetMapping("/approvals")
    @PreAuthorize("hasAnyAuthority('wfh.approve','attendance.regularization.approve','hrms.expense.claim.approve')"
            + " or @perm.check('hrms.leave.approve.l1')")
    public ApprovalsInboxService.Inbox approvals(@RequestParam(defaultValue = "all") String kind,
                                                 @RequestParam(defaultValue = "0") int page,
                                                 @RequestParam(defaultValue = "20") int size,
                                                 @AuthenticationPrincipal Jwt jwt, Authentication auth) {
        return inbox.inbox(kind, page, size, jwt, auth);
    }

    @Operation(summary = "Team members whose probation ends within the given days, and every overdue one")
    @GetMapping("/probation")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public List<TeamProbationService.TeamProbationRow> probation(@RequestParam(defaultValue = "30") int days,
                                                                 @AuthenticationPrincipal Jwt jwt) {
        return probation.list(days, jwt);
    }

    public record ConfirmProbationRequest(@DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate confirmationDate) {
    }

    public record ExtendProbationRequest(LocalDate newEndDate, @Size(max = 500) String note) {
    }

    @Operation(summary = "Confirm a team member's probation (HR and the employee are told)")
    @PostMapping("/probation/{employeeId}/confirm")
    @PreAuthorize("@perm.check('hrms.probation.team.decide')")
    public TeamProbationService.TeamProbationDecision confirm(@PathVariable UUID employeeId,
                                                              @RequestBody(required = false) ConfirmProbationRequest body,
                                                              @AuthenticationPrincipal Jwt jwt) {
        return probation.confirm(employeeId, body == null ? null : body.confirmationDate(), jwt);
    }

    @Operation(summary = "Extend a team member's probation to a later date (HR and the employee are told)")
    @PostMapping("/probation/{employeeId}/extend")
    @PreAuthorize("@perm.check('hrms.probation.team.decide')")
    public TeamProbationService.TeamProbationDecision extend(@PathVariable UUID employeeId,
                                                             @jakarta.validation.Valid @RequestBody ExtendProbationRequest body,
                                                             @AuthenticationPrincipal Jwt jwt) {
        return probation.extend(employeeId, body.newEndDate(), body.note(), jwt);
    }

    public record PostTeamMessageRequest(String body) {
    }

    @Operation(summary = "Post a short message to everyone in your team")
    @PostMapping("/messages")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("@perm.check('hrms.team.message')")
    public TeamMessageService.TeamMessage post(@RequestBody PostTeamMessageRequest body, @AuthenticationPrincipal Jwt jwt) {
        return messages.post(body == null ? null : body.body(), jwt);
    }

    @Operation(summary = "Team messages sent to me, newest first")
    @GetMapping("/messages/mine")
    @PreAuthorize("isAuthenticated()")
    public List<TeamMessageService.TeamMessage> mine(@RequestParam(defaultValue = "30") int days,
                                                     @AuthenticationPrincipal Jwt jwt) {
        return messages.mine(days, jwt);
    }

    @Operation(summary = "Team messages I sent, newest first")
    @GetMapping("/messages/sent")
    @PreAuthorize("isAuthenticated()")
    public List<TeamMessageService.TeamMessage> sent(@AuthenticationPrincipal Jwt jwt) {
        return messages.sent(jwt);
    }
}
