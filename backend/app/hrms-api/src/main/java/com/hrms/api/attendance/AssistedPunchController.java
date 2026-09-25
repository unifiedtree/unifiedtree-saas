package com.hrms.api.attendance;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Assisted face punch (V143.40), used by the mobile app's "Punch for team
 * member": a manager or HR scans the employee's face on their own phone.
 *
 * <pre>
 *   GET  /v1/attendance/assisted-punch/eligible?q=   people the caller may punch for
 *   POST /v1/attendance/assisted-punch               punch one of them in or out
 * </pre>
 *
 * The scope (team or anyone), the face match, the work area and the one-punch-
 * a-day rule are all checked on the server; see {@link AssistedPunchService}.
 */
@RestController
@RequestMapping("/v1/attendance/assisted-punch")
@Tag(name = "Attendance (assisted face punch)", description = "Punch an employee in or out with their face, on a manager's phone")
@SecurityRequirement(name = "bearerAuth")
public class AssistedPunchController {

    private static final String CAN_ASSIST =
            "hasAuthority('attendance.assisted_punch.team') or hasAuthority('attendance.assisted_punch.any')";

    private final AssistedPunchService service;

    public AssistedPunchController(AssistedPunchService service) {
        this.service = service;
    }

    @Operation(summary = "People the caller may punch for, with face enrolment and today's punch")
    @GetMapping("/eligible")
    @PreAuthorize(CAN_ASSIST)
    public ResponseEntity<AssistedPunchService.EligibleList> eligible(
            @RequestParam(required = false) String q,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(service.eligible(jwt, q));
    }

    @Operation(summary = "Punch an employee in or out with their face, from the caller's phone")
    @PostMapping
    @PreAuthorize(CAN_ASSIST)
    public ResponseEntity<AssistedPunchService.PunchResponse> punch(
            @RequestBody AssistedPunchService.PunchRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(service.punch(jwt, request));
    }
}
