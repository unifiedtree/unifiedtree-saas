package com.hrms.api.attendance;

import com.hrms.attendance.dto.FaceCheckInRequest;
import com.hrms.attendance.dto.FaceCheckInResponse;
import com.hrms.attendance.dto.GeoFenceZoneRequest;
import com.hrms.attendance.dto.GeoFenceZoneResponse;
import com.hrms.attendance.dto.GeoValidateRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.dto.LiveLocationResponse;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.core.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Geofence + face-recognition attendance endpoints excluded from canonical Phase 1.
 * Target market (services/SaaS SMBs) doesn't require location/biometric verification.
 * Legacy implementation preserved here for re-enable when a customer with
 * factory/field-sales requirements arrives.
 *
 * Loaded only when the "canonical" Spring profile is NOT active.
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance (Legacy Extras)", description = "Geofence and face-recognition endpoints — legacy profile only")
@SecurityRequirement(name = "bearerAuth")
@Profile("!canonical")
public class LegacyAttendanceExtrasController {

    private final AttendanceService attendanceService;
    private final GeoValidationService geoValidationService;
    private final AttendanceContextResolver contextResolver;
    private final EmployeeRepository employeeRepository;

    public LegacyAttendanceExtrasController(AttendanceService attendanceService,
                                            GeoValidationService geoValidationService,
                                            AttendanceContextResolver contextResolver,
                                            EmployeeRepository employeeRepository) {
        this.attendanceService = attendanceService;
        this.geoValidationService = geoValidationService;
        this.contextResolver = contextResolver;
        this.employeeRepository = employeeRepository;
    }

    @Operation(summary = "Check if employee is within office geofence")
    @PostMapping("/geo-fence/check")
    @PreAuthorize("hasAnyRole('EMPLOYEE','DEPT_MANAGER','HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<GeoValidateResponse> geoFenceCheck(
            @RequestBody GeoValidateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        AttendanceContextResolver.Context ctx = contextResolver.resolve(employeeId);
        return ResponseEntity.ok(geoValidationService.validate(
                new GeoValidateRequest(employeeId, request.latitude(), request.longitude()),
                ctx.branchId(), ctx.branchLat(), ctx.branchLon(), ctx.geoFenceRadius()));
    }

    @Operation(summary = "Validate GPS before opening camera (legacy - prefer /geo-fence/check)")
    @PostMapping("/geo-validate")
    @PreAuthorize("hasAnyRole('EMPLOYEE','DEPT_MANAGER','HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<GeoValidateResponse> geoValidate(
            @Valid @RequestBody GeoValidateRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        AttendanceContextResolver.Context ctx = contextResolver.resolve(employeeId);
        return ResponseEntity.ok(geoValidationService.validate(
                new GeoValidateRequest(employeeId, request.latitude(), request.longitude()),
                ctx.branchId(), ctx.branchLat(), ctx.branchLon(), ctx.geoFenceRadius()));
    }

    @Operation(summary = "Face check-in via multipart upload (legacy)")
    @PostMapping(value = "/face-checkin", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('EMPLOYEE','DEPT_MANAGER','HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<FaceCheckInResponse> faceCheckIn(
            @RequestPart("metadata") @Valid FaceCheckInRequest request,
            @RequestPart("faceFrame") MultipartFile faceFrame,
            @AuthenticationPrincipal Jwt jwt) throws IOException {
        UUID tenantId = UUID.fromString(jwt.getClaimAsString("tenant_id"));
        return ResponseEntity.ok(attendanceService.processFaceCheckIn(request, faceFrame.getBytes(), tenantId));
    }

    @Operation(summary = "Currently checked-in staff locations for geofence map")
    @GetMapping("/geofence/live-locations")
    @PreAuthorize("hasAnyRole('DEPT_MANAGER','HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<List<LiveLocationResponse>> liveLocations(
            @RequestParam(required = false) UUID departmentId,
            @AuthenticationPrincipal Jwt jwt) {
        List<Employee> employees = scopedEmployees(jwt, departmentId);
        Map<UUID, Employee> employeeMap = employees.stream()
                .collect(Collectors.toMap(Employee::getId, e -> e));
        return ResponseEntity.ok(attendanceService.getActiveSessions(
                        employees.stream().map(Employee::getId).toList(), LocalDate.now())
                .stream()
                .map(record -> {
                    Employee emp = employeeMap.get(record.getEmployeeId());
                    return new LiveLocationResponse(
                            record.getEmployeeId(),
                            emp != null ? (emp.getFirstName() + " " + emp.getLastName()).trim() : null,
                            emp != null ? emp.getJobTitle() : null,
                            emp != null ? emp.getProfilePhotoUrl() : null,
                            record.getCheckInLatitude(),
                            record.getCheckInLongitude(),
                            record.getLocationName(),
                            record.getCheckInZoneName(),
                            record.getCheckInAt(),
                            true);
                })
                .toList());
    }

    @Operation(summary = "List geofence zones for current company")
    @GetMapping("/geofence/zones")
    @PreAuthorize("hasAnyRole('DEPT_MANAGER','HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<List<GeoFenceZoneResponse>> zones(@AuthenticationPrincipal Jwt jwt) {
        UUID companyId = contextResolver.resolve(extractEmployeeId(jwt)).companyId();
        return ResponseEntity.ok(attendanceService.listGeoFenceZones(companyId));
    }

    @Operation(summary = "Create geofence zone")
    @PostMapping("/geofence/zones")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<GeoFenceZoneResponse> createZone(
            @Valid @RequestBody GeoFenceZoneRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = contextResolver.resolve(extractEmployeeId(jwt)).companyId();
        return ResponseEntity.ok(attendanceService.saveGeoFenceZone(
                null, TenantContext.getTenantId(), companyId, request));
    }

    @Operation(summary = "Update geofence zone")
    @PutMapping("/geofence/zones/{zoneId}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<GeoFenceZoneResponse> updateZone(
            @PathVariable UUID zoneId,
            @Valid @RequestBody GeoFenceZoneRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID companyId = contextResolver.resolve(extractEmployeeId(jwt)).companyId();
        return ResponseEntity.ok(attendanceService.saveGeoFenceZone(
                zoneId, TenantContext.getTenantId(), companyId, request));
    }

    @Operation(summary = "Deactivate geofence zone")
    @DeleteMapping("/geofence/zones/{zoneId}")
    @PreAuthorize("hasAnyRole('HR_MANAGER','COMPANY_ADMIN')")
    public ResponseEntity<Void> deleteZone(@PathVariable UUID zoneId) {
        attendanceService.deleteGeoFenceZone(zoneId);
        return ResponseEntity.noContent().build();
    }

    private List<Employee> scopedEmployees(Jwt jwt, UUID departmentId) {
        UUID currentEmployeeId = extractEmployeeId(jwt);
        Employee current = employeeRepository.findById(currentEmployeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + currentEmployeeId));
        List<Employee> employees = isAdmin(jwt)
                ? employeeRepository.findActiveByCompany(current.getCompanyId())
                : employeeRepository.findByManagerId(currentEmployeeId);
        if (departmentId != null) {
            employees = employees.stream()
                    .filter(e -> departmentId.equals(e.getDepartmentId()))
                    .toList();
        }
        return employees;
    }

    private boolean isAdmin(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles != null && roles.stream()
                .anyMatch(r -> r.equals("HR_MANAGER") || r.equals("COMPANY_ADMIN") || r.equals("SUPER_ADMIN"));
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        return employeeId != null ? UUID.fromString(employeeId) : UUID.fromString(jwt.getSubject());
    }
}
