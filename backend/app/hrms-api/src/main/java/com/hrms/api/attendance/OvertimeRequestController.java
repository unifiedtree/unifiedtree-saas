package com.hrms.api.attendance;

import com.hrms.api.attendance.OvertimeRequestService.OvertimeRequestResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Overtime requests (DECISIONS 22, V143.66): an employee asks for overtime on a day they choose; their approver
 * approves or rejects it. See {@link OvertimeRequestService}.
 * <ul>
 *   <li>{@code POST /v1/attendance/overtime/requests} {@code {date, minutes, reason}}, {@code GET …/requests/my},
 *       {@code POST …/requests/{id}/cancel}: {@code attendance.checkin.self}, the caller's own.</li>
 *   <li>{@code GET …/requests?from&to}: {@code attendance.team.read}, the caller's team.</li>
 *   <li>{@code POST …/requests/{id}/approve} and {@code /reject} {@code {note}}: {@code attendance.overtime.approve},
 *       the caller's team, never their own.</li>
 * </ul>
 * Every call answers 503 FEATURE_NOT_READY while the table is missing.
 */
@RestController
@RequestMapping("/v1/attendance/overtime/requests")
@Tag(name = "Overtime requests", description = "Overtime an employee asks for, and its decision")
@SecurityRequirement(name = "bearerAuth")
public class OvertimeRequestController {

    public record CreateOvertimeRequest(LocalDate date, Integer minutes, @Size(max = 500) String reason) {}

    public record DecisionNote(@Size(max = 1000) String note) {}

    private final OvertimeRequestService requests;

    public OvertimeRequestController(OvertimeRequestService requests) {
        this.requests = requests;
    }

    @Operation(summary = "Ask for overtime on a day")
    @PostMapping
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<OvertimeRequestResponse> create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateOvertimeRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(requests.create(OvertimeRequestService.callerId(jwt), body.date(), body.minutes(), body.reason()));
    }

    @Operation(summary = "My overtime requests, newest first")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public List<OvertimeRequestResponse> mine(@AuthenticationPrincipal Jwt jwt) {
        return requests.mine(OvertimeRequestService.callerId(jwt));
    }

    @Operation(summary = "Withdraw my overtime request while it waits (it becomes CANCELLED)")
    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public OvertimeRequestResponse withdraw(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return requests.withdraw(id, OvertimeRequestService.callerId(jwt));
    }

    @Operation(summary = "My team's overtime requests for days in a period")
    @GetMapping
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public List<OvertimeRequestResponse> team(@AuthenticationPrincipal Jwt jwt, @RequestParam LocalDate from, @RequestParam LocalDate to) {
        return requests.team(jwt, from, to);
    }

    @Operation(summary = "Approve an overtime request (records it; it isn't paid)")
    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('attendance.overtime.approve')")
    public OvertimeRequestResponse approve(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody(required = false) DecisionNote body) {
        return requests.decide(jwt, id, true, body == null ? null : body.note());
    }

    @Operation(summary = "Reject an overtime request (a note is required)")
    @PostMapping("/{id}/reject")
    @PreAuthorize("hasAuthority('attendance.overtime.approve')")
    public OvertimeRequestResponse reject(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody(required = false) DecisionNote body) {
        return requests.decide(jwt, id, false, body == null ? null : body.note());
    }
}
