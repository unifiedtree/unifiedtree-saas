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
import com.hrms.tenant.entity.Department;
import com.hrms.tenant.repository.DepartmentRepository;
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
 * Geofence + face-recognition attendance endpoints.
 *
 * <p>Originally excluded from canonical Phase 1 (services/SaaS SMBs), these
 * handlers are now re-enabled on canonical-prod so the Attendance App's
 * Geofencing Map (Screen 9) and Find Others (Screen 10) work end-to-end.
 *
 * <p>Profile semantics — loads when EITHER:
 * <ul>
 *   <li>the "canonical" profile is NOT active (original legacy/dev behavior), OR</li>
 *   <li>the "canonical-prod" profile IS active (production Railway deploy).</li>
 * </ul>
 *
 * <p>Note: if {@code canonical-jdbc-api} profile is ever activated alongside
 * {@code canonical-prod}, {@link com.unifiedtree.attendance.api.CanonicalAttendanceController}
 * will also try to register {@code POST /v1/attendance/geo-fence/check} and
 * Spring will fail at startup with a duplicate-mapping error. The current
 * production profile set ({@code canonical,canonical-prod}) does NOT activate
 * canonical-jdbc-api, so there is no conflict today.
 */
@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance (Geofence + Face)", description = "Geofence zones, live locations, face-recognition check-in")
@SecurityRequirement(name = "bearerAuth")
@Profile({"!canonical", "canonical-prod"})
public class LegacyAttendanceExtrasController {

    private final AttendanceService attendanceService;
    private final GeoValidationService geoValidationService;
    private final AttendanceContextResolver contextResolver;
    private final EmployeeRepository employeeRepository;
    private final DepartmentRepository departmentRepository;

    public LegacyAttendanceExtrasController(AttendanceService attendanceService,
                                            GeoValidationService geoValidationService,
                                            AttendanceContextResolver contextResolver,
                                            EmployeeRepository employeeRepository,
                                            DepartmentRepository departmentRepository) {
        this.attendanceService = attendanceService;
        this.geoValidationService = geoValidationService;
        this.contextResolver = contextResolver;
        this.employeeRepository = employeeRepository;
        this.departmentRepository = departmentRepository;
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

        // Pre-load department names for the caller's company in one query so the
        // Find Others panel can show "Engineering" / "Sales" labels without
        // forcing the client to do a second round-trip. Falls back gracefully
        // when an employee has no departmentId.
        UUID companyId = contextResolver.resolve(extractEmployeeId(jwt)).companyId();
        Map<UUID, String> deptNames = departmentRepository.findByCompanyId(companyId).stream()
                .collect(Collectors.toMap(Department::getId, Department::getName, (a, b) -> a));

        return ResponseEntity.ok(attendanceService.getActiveSessions(
                        employees.stream().map(Employee::getId).toList(), LocalDate.now())
                .stream()
                .map(record -> {
                    Employee emp = employeeMap.get(record.getEmployeeId());
                    UUID deptId = emp != null ? emp.getDepartmentId() : null;
                    return new LiveLocationResponse(
                            record.getEmployeeId(),
                            emp != null ? emp.getEmployeeCode() : null,
                            emp != null ? (emp.getFirstName() + " " + emp.getLastName()).trim() : null,
                            emp != null ? emp.getJobTitle() : null,
                            emp != null ? emp.getProfilePhotoUrl() : null,
                            record.getCheckInLatitude(),
                            record.getCheckInLongitude(),
                            record.getLocationName(),
                            record.getCheckInZoneName(),
                            deptId,
                            deptId != null ? deptNames.get(deptId) : null,
                            emp != null ? emp.getBranchId() : null,
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
