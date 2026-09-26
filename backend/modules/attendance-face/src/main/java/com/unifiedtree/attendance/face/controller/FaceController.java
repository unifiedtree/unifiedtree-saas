package com.unifiedtree.attendance.face.controller;

import com.unifiedtree.attendance.face.dto.FaceDtos.AdminEnrollmentSummary;
import com.unifiedtree.attendance.face.dto.FaceDtos.AdminVerificationEvent;
import com.unifiedtree.attendance.face.dto.FaceDtos.CheckinFaceResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentCompleteResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentSampleRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentSampleResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStartRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStartResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.EnrollmentStatusResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.PersonEnrollmentStatusResponse;
import com.unifiedtree.attendance.face.dto.FaceDtos.VerifyRequest;
import com.unifiedtree.attendance.face.dto.FaceDtos.VerifyResponse;
import com.unifiedtree.attendance.face.service.FaceService;
import jakarta.validation.Valid;
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

import java.util.List;
import java.util.UUID;

/**
 * Canonical face REST surface. Routes:
 *
 * <pre>
 *   GET  /v1/attendance/face/enrollment-status
 *   POST /v1/attendance/face/enroll/start
 *   POST /v1/attendance/face/enroll/sample
 *   POST /v1/attendance/face/enroll/complete
 *   POST /v1/attendance/face/verify
 *   POST /v1/attendance/checkin/face
 *
 *   GET  /v1/attendance/face/admin/employees       (manager)
 *   GET  /v1/attendance/face/admin/events          (manager)
 *   POST /v1/attendance/face/admin/{employeeId}/reset
 *
 *   GET  /v1/attendance/face/admin/employees/{employeeId}/enrollment-status
 *   POST /v1/attendance/face/admin/employees/{employeeId}/enroll/start
 *   POST /v1/attendance/face/admin/employees/{employeeId}/enroll/sample
 *   POST /v1/attendance/face/admin/employees/{employeeId}/enroll/complete
 * </pre>
 *
 * Tenant + employee identity ALWAYS come from the JWT. The body's
 * employeeId is never trusted. The {@code admin/employees/{employeeId}/…}
 * routes are HR enrolling someone else from the web: their {employeeId} is
 * the HR employee record id, mapped server-side to that person's login.
 */
@RestController
public class FaceController {

    private final FaceService face;

    public FaceController(FaceService face) { this.face = face; }

    // -------- Employee self-service --------------------------------------

    @GetMapping("/v1/attendance/face/enrollment-status")
    @PreAuthorize("hasAuthority('attendance.face.enroll.self') or hasAuthority('attendance.face.verify.self')")
    public EnrollmentStatusResponse status(@AuthenticationPrincipal Jwt jwt) {
        return face.getStatus(tenantId(jwt), userId(jwt));
    }

    @PostMapping("/v1/attendance/face/enroll/start")
    @PreAuthorize("hasAuthority('attendance.face.enroll.self')")
    public EnrollmentStartResponse startEnroll(@Valid @RequestBody EnrollmentStartRequest req,
                                               @AuthenticationPrincipal Jwt jwt) {
        return face.startEnrollment(tenantId(jwt), userId(jwt), req);
    }

    @PostMapping("/v1/attendance/face/enroll/sample")
    @PreAuthorize("hasAuthority('attendance.face.enroll.self')")
    public EnrollmentSampleResponse submitSample(@Valid @RequestBody EnrollmentSampleRequest req,
                                                 @AuthenticationPrincipal Jwt jwt) {
        return face.submitSample(tenantId(jwt), userId(jwt), req);
    }

    @PostMapping("/v1/attendance/face/enroll/complete")
    @PreAuthorize("hasAuthority('attendance.face.enroll.self')")
    public EnrollmentCompleteResponse completeEnroll(@AuthenticationPrincipal Jwt jwt) {
        return face.completeEnrollment(tenantId(jwt), userId(jwt), userId(jwt));
    }

    @PostMapping("/v1/attendance/face/verify")
    @PreAuthorize("hasAuthority('attendance.face.verify.self')")
    public VerifyResponse verify(@Valid @RequestBody VerifyRequest req,
                                 @AuthenticationPrincipal Jwt jwt) {
        return face.verify(tenantId(jwt), userId(jwt), req, "MANUAL_TEST");
    }

    @PostMapping("/v1/attendance/checkin/face")
    @PreAuthorize("hasAuthority('attendance.face.verify.self')")
    public CheckinFaceResponse checkinFace(@Valid @RequestBody VerifyRequest req,
                                           @AuthenticationPrincipal Jwt jwt) {
        return face.checkinWithFace(tenantId(jwt), userId(jwt), req);
    }

    // -------- Admin / manager --------------------------------------------

    @GetMapping("/v1/attendance/face/admin/employees")
    @PreAuthorize("hasAuthority('attendance.face.admin.read')")
    public List<AdminEnrollmentSummary> adminList(@RequestParam(required = false) String status,
                                                  @AuthenticationPrincipal Jwt jwt) {
        return face.adminList(tenantId(jwt), status);
    }

    @GetMapping("/v1/attendance/face/admin/events")
    @PreAuthorize("hasAuthority('attendance.face.admin.read')")
    public List<AdminVerificationEvent> adminEvents(@RequestParam(required = false) UUID employeeId,
                                                    @RequestParam(defaultValue = "100") int limit,
                                                    @AuthenticationPrincipal Jwt jwt) {
        return face.adminEvents(tenantId(jwt), employeeId, limit);
    }

    @PostMapping("/v1/attendance/face/admin/{employeeId}/reset")
    @PreAuthorize("hasAuthority('attendance.face.admin.reset')")
    public ResponseEntity<Void> adminReset(@PathVariable UUID employeeId,
                                           @RequestParam(required = false) String reason,
                                           @AuthenticationPrincipal Jwt jwt) {
        face.adminReset(tenantId(jwt), employeeId, userId(jwt), reason);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    // -------- HR / admin: someone else's face, by HR employee record ------
    // Enrolling for someone else is the reset permission's job ("Reset /
    // re-enroll an employee face"), held by HR managers, admins and owners.

    @GetMapping("/v1/attendance/face/admin/employees/{employeeId}/enrollment-status")
    @PreAuthorize("hasAuthority('attendance.face.admin.read') or hasAuthority('attendance.face.admin.reset')")
    public PersonEnrollmentStatusResponse personStatus(@PathVariable UUID employeeId,
                                                       @AuthenticationPrincipal Jwt jwt) {
        return face.personStatus(tenantId(jwt), employeeId, userId(jwt));
    }

    @PostMapping("/v1/attendance/face/admin/employees/{employeeId}/enroll/start")
    @PreAuthorize("hasAuthority('attendance.face.admin.reset')")
    public EnrollmentStartResponse adminStartEnroll(@PathVariable UUID employeeId,
                                                    @Valid @RequestBody EnrollmentStartRequest req,
                                                    @AuthenticationPrincipal Jwt jwt) {
        UUID tenant = tenantId(jwt);
        return face.adminStartEnrollment(tenant, face.requireLoginFor(tenant, employeeId), req);
    }

    @PostMapping("/v1/attendance/face/admin/employees/{employeeId}/enroll/sample")
    @PreAuthorize("hasAuthority('attendance.face.admin.reset')")
    public EnrollmentSampleResponse adminSubmitSample(@PathVariable UUID employeeId,
                                                      @Valid @RequestBody EnrollmentSampleRequest req,
                                                      @AuthenticationPrincipal Jwt jwt) {
        UUID tenant = tenantId(jwt);
        return face.submitSample(tenant, face.requireLoginFor(tenant, employeeId), req);
    }

    @PostMapping("/v1/attendance/face/admin/employees/{employeeId}/enroll/complete")
    @PreAuthorize("hasAuthority('attendance.face.admin.reset')")
    public EnrollmentCompleteResponse adminCompleteEnroll(@PathVariable UUID employeeId,
                                                          @AuthenticationPrincipal Jwt jwt) {
        UUID tenant = tenantId(jwt);
        return face.completeEnrollment(tenant, face.requireLoginFor(tenant, employeeId), userId(jwt));
    }

    private static UUID tenantId(Jwt jwt) {
        Object claim = jwt.getClaim("tenant_id");
        if (claim == null) {
            throw new IllegalStateException("JWT missing tenant_id");
        }
        return UUID.fromString(claim.toString());
    }
    private static UUID userId(Jwt jwt) { return UUID.fromString(jwt.getSubject()); }
}
