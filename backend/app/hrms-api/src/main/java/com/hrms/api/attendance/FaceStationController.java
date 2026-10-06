package com.hrms.api.attendance;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Face station (V143.95): a shared face-punch device at one branch.
 *
 * <pre>
 *   Setting up (admin / HR: attendance.policy.manage AND attendance.assisted_punch.any)
 *   GET    /v1/attendance/stations                          the company's stations
 *   POST   /v1/attendance/stations                          { name, branchId }
 *   POST   /v1/attendance/stations/{id}/revoke              switch it off (its devices stop at once)
 *   DELETE /v1/attendance/stations/{id}                     only one that never punched anyone
 *   POST   /v1/attendance/stations/{id}/device-session      a station token for the device the admin is on
 *
 *   At the station (a station token; StationScopeFilter keeps that token to these paths)
 *   GET    /v1/attendance/station/me                        the station's name and branch
 *   GET    /v1/attendance/station/people?q=                 search its branch (2+ letters, at most 8)
 *   POST   /v1/attendance/station/punch                     punch in or out with the face
 *   POST   /v1/attendance/station/renew                     a fresh token (the device renews daily)
 * </pre>
 * The service checks everything again (the token type, the station still on,
 * the branch); see {@link FaceStationService}.
 */
@RestController
@Tag(name = "Attendance (face station)", description = "A shared face-punch device at a branch")
@SecurityRequirement(name = "bearerAuth")
public class FaceStationController {

    private static final String CAN_MANAGE =
            "hasAuthority('attendance.policy.manage') and hasAuthority('attendance.assisted_punch.any')";
    private static final String IS_STATION = "hasAuthority('attendance.station.punch')";

    private final FaceStationService service;

    public FaceStationController(FaceStationService service) {
        this.service = service;
    }

    // ── setting up ───────────────────────────────────────────────────────────

    @Operation(summary = "The company's face stations")
    @GetMapping("/v1/attendance/stations")
    @PreAuthorize(CAN_MANAGE)
    public List<FaceStations.Station> list(@AuthenticationPrincipal Jwt jwt) {
        return service.list(jwt);
    }

    @Operation(summary = "Set up a face station at a branch")
    @PostMapping("/v1/attendance/stations")
    @PreAuthorize(CAN_MANAGE)
    public FaceStations.Station create(@RequestBody FaceStationService.CreateRequest body, @AuthenticationPrincipal Jwt jwt) {
        return service.create(jwt, body);
    }

    @Operation(summary = "Switch a face station off: its devices stop working at once")
    @PostMapping("/v1/attendance/stations/{id}/revoke")
    @PreAuthorize(CAN_MANAGE)
    public FaceStations.Station revoke(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return service.revoke(jwt, id);
    }

    @Operation(summary = "Delete a face station that never punched anyone")
    @DeleteMapping("/v1/attendance/stations/{id}")
    @PreAuthorize(CAN_MANAGE)
    public ResponseEntity<Void> delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        service.delete(jwt, id);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Start a face station on this device: a station sign-in for it")
    @PostMapping("/v1/attendance/stations/{id}/device-session")
    @PreAuthorize(CAN_MANAGE)
    public FaceStationService.DeviceSession deviceSession(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        return service.startOnDevice(jwt, id);
    }

    // ── at the station ───────────────────────────────────────────────────────

    @Operation(summary = "The station's own name and branch")
    @GetMapping("/v1/attendance/station/me")
    @PreAuthorize(IS_STATION)
    public FaceStationService.StationInfo me(@AuthenticationPrincipal Jwt jwt) {
        return service.me(jwt);
    }

    @Operation(summary = "Find someone of the station's branch by name or code (2+ letters, at most 8)")
    @GetMapping("/v1/attendance/station/people")
    @PreAuthorize(IS_STATION)
    public FaceStationService.PeopleList people(@RequestParam(required = false) String q, @AuthenticationPrincipal Jwt jwt) {
        return service.people(jwt, q);
    }

    @Operation(summary = "Punch in or out at the station with the face")
    @PostMapping("/v1/attendance/station/punch")
    @PreAuthorize(IS_STATION)
    public FaceStationService.PunchResult punch(@RequestBody FaceStationService.PunchRequest body, @AuthenticationPrincipal Jwt jwt) {
        return service.punch(jwt, body);
    }

    @Operation(summary = "A fresh sign-in for a running station")
    @PostMapping("/v1/attendance/station/renew")
    @PreAuthorize(IS_STATION)
    public FaceStationService.DeviceSession renew(@AuthenticationPrincipal Jwt jwt) {
        return service.renew(jwt);
    }
}
