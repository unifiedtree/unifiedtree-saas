package com.hrms.api.attendance;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

/**
 * "Send a reminder" to people in your team who haven't checked in today
 * (redesign BW-10), and who was reminded on a day. attendance.team.read, the
 * caller's team only, at most once per person, day and reason.
 */
@RestController
@RequestMapping("/v1/attendance/reminders")
@Tag(name = "Attendance reminders", description = "Remind people in your team to check in")
@SecurityRequirement(name = "bearerAuth")
public class AttendanceReminderController {

    private final AttendanceReminderService reminders;

    public AttendanceReminderController(AttendanceReminderService reminders) {
        this.reminders = reminders;
    }

    @Operation(summary = "Remind people in your team to check in today; one result per person")
    @PostMapping
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public List<AttendanceReminderService.ReminderResult> send(@RequestBody AttendanceReminderService.SendRemindersRequest body,
                                                               @AuthenticationPrincipal Jwt jwt) {
        return reminders.send(body, jwt);
    }

    @Operation(summary = "Who in your team was reminded on a day")
    @GetMapping
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public List<AttendanceReminderService.SentReminder> sent(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @AuthenticationPrincipal Jwt jwt) {
        return reminders.sent(date, jwt);
    }
}
