package com.hrms.api.attendance;

import com.hrms.attendance.policy.EffectiveDay;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
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
 * Attendance review (V143.10). The list of days that need a look, changing a
 * day's status with a reason, the history of those changes, one person's
 * effective day, and HR decisions on face punches. Department managers are
 * limited to their team (same team as the My team page); nobody changes their
 * own day. See {@link AttendanceReviewService}.
 */
@RestController
@RequestMapping("/v1/attendance/review")
@Tag(name = "Attendance review", description = "Exceptions, status overrides and face punch review")
@SecurityRequirement(name = "bearerAuth")
public class AttendanceReviewController {

    private final AttendanceReviewService review;

    public AttendanceReviewController(AttendanceReviewService review) {
        this.review = review;
    }

    /** {@code status}: PRESENT, LATE, HALF_DAY, ABSENT, EXCUSE or CLEAR. */
    public record StatusChangeRequest(UUID employeeId, LocalDate date, String status, String reason) {}

    public record FaceDecisionRequest(String decision, String note) {}

    @Operation(summary = "Days that need a look: late, half day, absent, early leave, no check-out, outside the zone")
    @GetMapping("/exceptions")
    @PreAuthorize("hasAuthority('attendance.status.review')")
    public List<AttendanceReviewService.ExceptionItem> exceptions(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @AuthenticationPrincipal Jwt jwt) {
        return review.exceptions(jwt, from, to);
    }

    @Operation(summary = "Change a day's status (set, excuse or clear) with a reason; the employee is notified")
    @PostMapping("/status")
    @PreAuthorize("hasAuthority('attendance.status.override')")
    public EffectiveDay changeStatus(@RequestBody StatusChangeRequest body, @AuthenticationPrincipal Jwt jwt) {
        return review.changeStatus(jwt, body.employeeId(), body.date(), body.status(), body.reason());
    }

    @Operation(summary = "Manual status changes on one person's days (self or your team)")
    @GetMapping("/history")
    @PreAuthorize("hasAnyAuthority('attendance.checkin.self', 'attendance.team.read', 'attendance.status.review')")
    public List<AttendanceReviewService.StatusChange> history(
            @RequestParam UUID employeeId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @AuthenticationPrincipal Jwt jwt) {
        return review.history(jwt, employeeId, from, to);
    }

    @Operation(summary = "One person's effective day: status after the company policy and any manual change")
    @GetMapping("/day")
    @PreAuthorize("hasAnyAuthority('attendance.checkin.self', 'attendance.team.read', 'attendance.status.review')")
    public EffectiveDay day(@RequestParam UUID employeeId,
                            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                            @AuthenticationPrincipal Jwt jwt) {
        return review.day(jwt, employeeId, date);
    }

    @Operation(summary = "Face punches with names and HR decisions (your team)")
    @GetMapping("/face-events")
    @PreAuthorize("hasAnyAuthority('attendance.face.admin.read', 'attendance.status.review')")
    public List<AttendanceReviewService.FaceEvent> faceEvents(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @AuthenticationPrincipal Jwt jwt) {
        return review.faceEvents(jwt, from, to);
    }

    @Operation(summary = "Record HR's check on a face punch: CONFIRMED (it's them) or REJECTED (not them — the punch no longer counts)")
    @PostMapping("/face-events/{eventId}/decision")
    @PreAuthorize("hasAuthority('attendance.status.override')")
    public AttendanceReviewService.FaceDecisionResult decideFace(@PathVariable UUID eventId,
                                                                 @RequestBody FaceDecisionRequest body,
                                                                 @AuthenticationPrincipal Jwt jwt) {
        return review.decideFace(jwt, eventId, body.decision(), body.note());
    }
}
