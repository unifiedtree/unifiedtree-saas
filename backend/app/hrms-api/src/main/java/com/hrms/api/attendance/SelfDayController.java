package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * "Your day" on Home (V143.53 redesign; {@link SelfDayService}): the person's
 * own day, breaks and undo check-out. Everything is the caller's own, taken
 * from the token; the permission is the self punch's
 * ({@code attendance.checkin.self}).
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance: your day", description = "Your day, breaks and undo check-out")
@SecurityRequirement(name = "bearerAuth")
public class SelfDayController {

    private final SelfDayService self;

    public SelfDayController(SelfDayService self) {
        this.self = self;
    }

    @Operation(summary = "Your day: today's record, status, shift, worked time, breaks and what you can do from the web")
    @GetMapping("/my-day")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public SelfDayService.MyDay myDay(@AuthenticationPrincipal Jwt jwt) {
        return self.myDay(AttendanceReviewService.callerEmployeeId(jwt), Instant.now());
    }

    @Operation(summary = "Start a break (pauses the Your day timer only; worked hours and pay don't change)")
    @PostMapping("/breaks/start")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public SelfDayService.Breaks startBreak(@AuthenticationPrincipal Jwt jwt) {
        return self.startBreak(AttendanceReviewService.callerEmployeeId(jwt), Instant.now());
    }

    @Operation(summary = "End the break you are on")
    @PostMapping("/breaks/end")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public SelfDayService.Breaks endBreak(@AuthenticationPrincipal Jwt jwt) {
        return self.endBreak(AttendanceReviewService.callerEmployeeId(jwt), Instant.now());
    }

    @Operation(summary = "Take back your own check-out, within 10 minutes (where web check-in is on)")
    @PostMapping("/checkout/undo")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public AttendanceDto undoCheckOut(@AuthenticationPrincipal Jwt jwt) {
        return self.undoCheckOut(AttendanceReviewService.callerEmployeeId(jwt), Instant.now());
    }
}
