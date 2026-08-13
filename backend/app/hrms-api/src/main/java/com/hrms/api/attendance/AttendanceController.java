package com.hrms.api.attendance;

import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.AttendanceHomeResponse;
import com.hrms.attendance.dto.AttendanceLogResponse;
import com.hrms.attendance.dto.CheckInRequest;
import com.hrms.attendance.dto.CheckOutSummaryResponse;
import com.hrms.attendance.dto.CorrectionDecisionRequest;
import com.hrms.attendance.dto.CorrectionRequestRequest;
import com.hrms.attendance.dto.CorrectionRequestResponse;
import com.hrms.attendance.dto.DayRecordResponse;
import com.hrms.attendance.dto.GeoValidateRequest;
import com.hrms.attendance.dto.GeoValidateResponse;
import com.hrms.attendance.dto.ManualAttendanceRequest;
import com.hrms.attendance.dto.MonthlyStatsResponse;
import com.hrms.attendance.dto.AttendanceSummaryCounts;
import com.hrms.attendance.dto.AttendanceRecordResponse;
import com.hrms.attendance.dto.CheckOutRequest;
import com.hrms.attendance.dto.StaffStatusResponse;
import com.hrms.attendance.dto.TeamDashboardResponse;
import com.hrms.attendance.dto.WeeklySummaryResponse;
import com.hrms.attendance.entity.AttendanceEventLog;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.service.AttendanceService;
import com.hrms.attendance.service.GeoValidationService;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/v1/attendance")
@Tag(name = "Attendance", description = "Check-in, check-out, and attendance records")
@SecurityRequirement(name = "bearerAuth")
// @Validated at the class level activates method-parameter validation so the
// @Min/@Max on the monthly-stats/history query params actually fire (Spring MVC
// only inspects them when the enclosing bean is a validation target).
@Validated
public class AttendanceController {

    private final AttendanceService attendanceService;
    private final GeoValidationService geoValidationService;
    private final AttendanceContextResolver contextResolver;
    private final EmployeeRepository employeeRepository;
    private final WorkforceDepartmentRepository departmentRepository;

    /**
     * When true, the geofence check on /checkin is enforced: punches outside the
     * configured radius are rejected. Default false in dev. Override with
     * env var {@code HRMS_GEOFENCE_ENFORCE=true} in production.
     */
    @org.springframework.beans.factory.annotation.Value("${hrms.attendance.geofence-enforce:false}")
    private boolean geofenceEnforce;

    public AttendanceController(AttendanceService attendanceService,
                                GeoValidationService geoValidationService,
                                AttendanceContextResolver contextResolver,
                                EmployeeRepository employeeRepository,
                                WorkforceDepartmentRepository departmentRepository) {
        this.attendanceService = attendanceService;
        this.geoValidationService = geoValidationService;
        this.contextResolver = contextResolver;
        this.employeeRepository = employeeRepository;
        this.departmentRepository = departmentRepository;
    }

    @Operation(summary = "Check in — JSON body with optional face image (base64)")
    @PostMapping("/checkin")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<AttendanceDto> checkIn(
            @Valid @RequestBody CheckInRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        AttendanceContextResolver.Context ctx = contextResolver.resolve(employeeId);
        GeoValidateResponse geoValidation = geoValidationService.validate(
                new GeoValidateRequest(employeeId, request.latitude(), request.longitude()),
                ctx.branchId(),
                ctx.branchLat(),
                ctx.branchLon(),
                ctx.geoFenceRadius());

        // Approved-WFH override: an employee with an APPROVED WFH request that
        // covers today's IST date is allowed to punch from any location. The
        // face-recognition + FACE_MISMATCH checks in checkInJson still fire —
        // WFH is a location override, not an identity-verification bypass.
        boolean wfhDay = attendanceService.isApprovedWfhDay(
                employeeId, LocalDate.now(ZoneId.of("Asia/Kolkata")));

        if (!geoValidation.withinFence() && geofenceEnforce && !wfhDay) {
            throw new BusinessRuleException(
                    geoValidation.message() != null ? geoValidation.message() : "Outside allowed attendance zone.",
                    "OUTSIDE_GEOFENCE");
        }

        AttendanceDto dto = attendanceService.checkInJson(
                employeeId,
                ctx.companyId(),
                ctx.branchId(),
                ctx.departmentId(),
                request.latitude(),
                request.longitude(),
                request.faceImageBase64(),
                request.checkInMethod(),
                com.hrms.core.tenant.TenantContext.getTenantId(),
                request.locationName() != null ? request.locationName() : ctx.branchName(),
                request.zoneName(),
                request.deviceId(),
                request.clientEventId(),
                wfhDay);
        return ResponseEntity.ok(dto);
    }

    @Operation(summary = "Check out — returns updated attendance record")
    @PostMapping("/checkout")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<AttendanceDto> checkOut(
            @RequestBody(required = false) CheckOutRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = request != null && request.employeeId() != null
                ? request.employeeId()
                : extractEmployeeId(jwt);
        return ResponseEntity.ok(attendanceService.checkOut(
                employeeId,
                request != null ? request.latitude() : null,
                request != null ? request.longitude() : null,
                request != null ? request.checkOutMethod() : null,
                request != null ? request.locationName() : null,
                request != null ? request.zoneName() : null,
                request != null ? request.deviceId() : null));
    }

    @Operation(summary = "Get checkout confirmation summary for the active session")
    @GetMapping("/checkout-summary")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<CheckOutSummaryResponse> checkoutSummary(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(attendanceService.getCheckOutSummary(extractEmployeeId(jwt)));
    }

    @Operation(summary = "Get today's attendance record for the logged-in employee")
    @GetMapping("/today")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<AttendanceDto> today(@AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        return attendanceService.getTodayRecord(employeeId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.noContent().build());
    }

    @Operation(summary = "Monthly attendance statistics (present/absent/score)")
    @GetMapping("/monthly-stats")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<MonthlyStatsResponse> monthlyStats(
            @RequestParam(required = false) @Min(2000) @Max(2100) Integer year,
            @RequestParam(required = false) @Min(1) @Max(12) Integer month,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        int y = year  != null ? year  : LocalDate.now().getYear();
        int m = month != null ? month : LocalDate.now().getMonthValue();
        return ResponseEntity.ok(attendanceService.getMonthlyStats(employeeId, y, m));
    }

    @Operation(summary = "Per-day attendance status for a given month")
    @GetMapping("/history")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<List<DayRecordResponse>> history(
            @RequestParam(required = false) @Min(2000) @Max(2100) Integer year,
            @RequestParam(required = false) @Min(1) @Max(12) Integer month,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        int y = year  != null ? year  : LocalDate.now().getYear();
        int m = month != null ? month : LocalDate.now().getMonthValue();
        return ResponseEntity.ok(attendanceService.getMonthHistory(employeeId, y, m));
    }

    @Operation(summary = "Weekly summary — hours, overtime, avg arrival, bar chart data")
    @GetMapping("/weekly-summary")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<WeeklySummaryResponse> weeklySummary(
            @RequestParam(required = false) LocalDate weekStart,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        return ResponseEntity.ok(attendanceService.getWeeklySummary(employeeId, weekStart));
    }

    @Operation(summary = "Mobile home payload for punch screen")
    @GetMapping("/app/home")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<AttendanceHomeResponse> appHome(@AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        Employee employee = employeeRepository.findById(employeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + employeeId));
        AttendanceContextResolver.Context ctx = contextResolver.resolve(employeeId);
        AttendanceDto todayRecord = attendanceService.getTodayRecord(employeeId).orElse(null);
        LocalDate now = LocalDate.now();

        int teamPresent = 0;
        if (isManagerOrAdmin(jwt)) {
            List<Employee> scoped = scopedEmployees(jwt, null);
            teamPresent = attendanceService.getRecordsForEmployeesOnDate(
                            scoped.stream().map(Employee::getId).toList(), now)
                    .size();
        }

        AttendanceService.ShiftProfile shift = attendanceService.getShiftProfile(employeeId, now);
        AttendanceHomeResponse response = new AttendanceHomeResponse(
                fullName(employee),
                employee.getJobTitle(),
                todayRecord != null && todayRecord.checkInTime() != null && todayRecord.checkOutTime() == null,
                todayRecord,
                attendanceService.getMonthlyStats(employeeId, now.getYear(), now.getMonthValue()),
                ctx.branchName(),
                true,
                0,
                teamPresent,
                shift != null ? shift.scheduledStart() : null,
                shift != null ? shift.graceMinutes() : null);
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "Manager/Admin attendance dashboard for a date")
    @GetMapping("/dashboard")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<TeamDashboardResponse> dashboard(
            @RequestParam(required = false) LocalDate date,
            @RequestParam(required = false) UUID departmentId,
            @AuthenticationPrincipal Jwt jwt) {
        LocalDate selectedDate = date != null ? date : LocalDate.now();
        List<Employee> employees = scopedEmployees(jwt, departmentId);
        List<UUID> employeeIds = employees.stream().map(Employee::getId).toList();
        List<AttendanceRecord> records = attendanceService.getRecordsForEmployeesOnDate(
                employeeIds, selectedDate);
        Map<UUID, AttendanceRecord> byEmployee = records.stream()
                .collect(Collectors.toMap(AttendanceRecord::getEmployeeId, Function.identity(), (a, b) -> a));
        Map<UUID, String> departmentNames = departmentNames(employees);
        // One bulk lookup for shift end_time; used by both the per-row
        // earlyCheckout flag and the aggregate countSummary tile.
        Map<UUID, LocalTime> shiftEndByEmployee =
                attendanceService.getShiftEndTimesForEmployees(employeeIds, selectedDate);

        List<StaffStatusResponse> staff = employees.stream()
                .map(employee -> toStaffStatus(
                        employee, byEmployee.get(employee.getId()), departmentNames, shiftEndByEmployee))
                .sorted(Comparator.comparing(StaffStatusResponse::fullName))
                .toList();

        return ResponseEntity.ok(new TeamDashboardResponse(
                selectedDate, countSummary(employees, records, shiftEndByEmployee), staff));
    }

    @Operation(summary = "Manager/Admin chronological attendance activity log")
    @GetMapping("/logs")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<List<AttendanceLogResponse>> logs(
            @RequestParam(required = false) LocalDate date,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) String search,
            @AuthenticationPrincipal Jwt jwt) {
        LocalDate selectedDate = date != null ? date : LocalDate.now();
        List<Employee> employees = scopedEmployees(jwt, departmentId);
        Map<UUID, Employee> employeeMap = employees.stream()
                .collect(Collectors.toMap(Employee::getId, Function.identity()));
        Map<UUID, String> departmentNames = departmentNames(employees);
        String query = search == null ? "" : search.trim().toLowerCase();

        List<AttendanceEventLog> events = attendanceService.getEventLogsForEmployees(
                employees.stream().map(Employee::getId).toList(), selectedDate);
        return ResponseEntity.ok(events.stream()
                .filter(event -> query.isBlank() || matchesEmployeeSearch(employeeMap.get(event.getEmployeeId()), query))
                .map(event -> toLogResponse(event, employeeMap.get(event.getEmployeeId()), departmentNames))
                .toList());
    }

    @Operation(summary = "Manager/Admin manual attendance entry or override")
    @PostMapping("/manual-entry")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<AttendanceDto> manualEntry(
            @Valid @RequestBody ManualAttendanceRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        AttendanceContextResolver.Context target = contextResolver.resolve(request.employeeId());
        AttendanceDto dto = attendanceService.manualEntry(
                request,
                extractEmployeeId(jwt),
                com.hrms.core.tenant.TenantContext.getTenantId(),
                target.companyId(),
                target.departmentId(),
                target.branchId());
        return ResponseEntity.ok(dto);
    }

    @Operation(summary = "Employee attendance correction request")
    @PostMapping("/corrections")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<CorrectionRequestResponse> createCorrection(
            @Valid @RequestBody CorrectionRequestRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        AttendanceContextResolver.Context ctx = contextResolver.resolve(employeeId);
        return ResponseEntity.ok(attendanceService.createCorrectionRequest(
                employeeId, ctx.companyId(), ctx.departmentId(), request));
    }

    @Operation(summary = "My attendance correction requests")
    @GetMapping("/corrections/my")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<PageResponse<CorrectionRequestResponse>> myCorrections(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(attendanceService.getMyCorrectionRequests(extractEmployeeId(jwt), pageable));
    }

    @Operation(summary = "Manager/Admin attendance correction approvals")
    @GetMapping("/corrections/approvals")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<PageResponse<CorrectionRequestResponse>> correctionApprovals(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID departmentId,
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        // Tolerate an unknown/blank status param (e.g. an "All" tab label)
        // instead of 500-ing on ApprovalStatus.valueOf — default to PENDING.
        ApprovalStatus approvalStatus = ApprovalStatus.PENDING;
        if (status != null && !status.isBlank()) {
            try {
                approvalStatus = ApprovalStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException ignored) {
                approvalStatus = ApprovalStatus.PENDING;
            }
        }
        List<Employee> employees = scopedEmployees(jwt, departmentId);
        List<UUID> employeeIds = employees.stream().map(Employee::getId).toList();
        PageResponse<CorrectionRequestResponse> page =
                attendanceService.getCorrectionRequestsForEmployees(employeeIds, approvalStatus, pageable);

        Map<UUID, Employee> employeeMap = employees.stream()
                .collect(Collectors.toMap(Employee::getId, Function.identity(), (a, b) -> a));
        Map<UUID, String> departmentNames = departmentNames(employees);
        List<CorrectionRequestResponse> enriched = page.content().stream()
                .map(c -> enrichCorrection(c, employeeMap.get(c.employeeId()), departmentNames))
                .toList();
        return ResponseEntity.ok(new PageResponse<>(
                enriched, page.page(), page.size(), page.totalElements(), page.totalPages(), page.last()));
    }

    @Operation(summary = "Approve or reject an attendance correction")
    @PostMapping("/corrections/{correctionId}/decision")
    @PreAuthorize("hasAuthority('attendance.regularization.approve')")
    public ResponseEntity<CorrectionRequestResponse> decideCorrection(
            @PathVariable UUID correctionId,
            @Valid @RequestBody CorrectionDecisionRequest decision,
            @AuthenticationPrincipal Jwt jwt) {
        CorrectionRequestResponse decided =
                attendanceService.decideCorrection(correctionId, extractEmployeeId(jwt), decision);
        Employee employee = employeeRepository.findById(decided.employeeId()).orElse(null);
        Map<UUID, String> departmentNames = employee != null
                ? departmentNames(List.of(employee))
                : Map.of();
        return ResponseEntity.ok(enrichCorrection(decided, employee, departmentNames));
    }

    @Operation(summary = "Get my attendance records (paginated)")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<PageResponse<AttendanceRecordResponse>> myAttendance(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 31) Pageable pageable) {
        UUID employeeId = extractEmployeeId(jwt);
        return ResponseEntity.ok(attendanceService.getEmployeeAttendance(employeeId, pageable));
    }

    @Operation(summary = "Department attendance for today (manager view)")
    @GetMapping("/department/{departmentId}/today")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<List<AttendanceRecordResponse>> deptToday(
            @PathVariable UUID departmentId) {
        return ResponseEntity.ok(attendanceService.getDepartmentAttendanceToday(departmentId));
    }

    // ── Manager/Admin: view a SPECIFIC employee's records & weekly summary ──
    // These back the "View Attendance Records" / "Weekly Summary" buttons the
    // admin taps on an employee's profile page. Same service methods the self
    // endpoints use — only the employeeId source differs (path param, not JWT)
    // — gated behind attendance.team.read so plain employees can't read peers.
    // The caller's scope is further constrained by tenant RLS; a DEPT_MANAGER
    // only ever surfaces their own department's employees in the UI that links
    // here, so they can't discover out-of-scope employee IDs to query.

    @Operation(summary = "A specific employee's attendance records (manager/admin)")
    @GetMapping("/employee/{employeeId}/records")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<PageResponse<AttendanceRecordResponse>> employeeRecords(
            @PathVariable UUID employeeId,
            @PageableDefault(size = 31) Pageable pageable) {
        return ResponseEntity.ok(attendanceService.getEmployeeAttendance(employeeId, pageable));
    }

    @Operation(summary = "A specific employee's weekly summary (manager/admin)")
    @GetMapping("/employee/{employeeId}/weekly-summary")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<WeeklySummaryResponse> employeeWeeklySummary(
            @PathVariable UUID employeeId,
            @RequestParam(required = false) LocalDate weekStart) {
        return ResponseEntity.ok(attendanceService.getWeeklySummary(employeeId, weekStart));
    }

    private List<Employee> scopedEmployees(Jwt jwt, UUID departmentId) {
        UUID currentEmployeeId = extractEmployeeId(jwt);
        Employee current = employeeRepository.findById(currentEmployeeId)
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + currentEmployeeId));

        List<Employee> employees;
        if (isAdmin(jwt)) {
            // Admin + HR: organisation-wide, every active employee.
            employees = employeeRepository.findActiveByCompany(current.getCompanyId());
        } else {
            // DEPT_MANAGER: everyone in the department(s) they head — not just
            // direct reports whose reporting_manager_id points at them. A
            // department head "owns" the whole department, so their dashboard
            // shows every teammate in it. Fall back to legacy direct-report
            // scope for managers who haven't been set as any dept's head yet.
            List<UUID> ledDepartmentIds = departmentRepository
                    .findByDepartmentHeadEmployeeId(currentEmployeeId).stream()
                    .map(d -> d.getId())
                    .toList();
            if (!ledDepartmentIds.isEmpty()) {
                List<Employee> companyEmployees =
                        employeeRepository.findActiveByCompany(current.getCompanyId());
                employees = companyEmployees.stream()
                        .filter(e -> e.getDepartmentId() != null
                                && ledDepartmentIds.contains(e.getDepartmentId()))
                        .toList();
            } else {
                employees = employeeRepository.findByManagerId(currentEmployeeId);
            }
        }

        // Exclude the caller from the team list — admins and managers don't
        // punch on this app, so counting them produces phantom "Not Marked /
        // Absent" tiles. (HR does punch, but they're rarely their own report.)
        employees = employees.stream()
                .filter(employee -> !employee.getId().equals(currentEmployeeId))
                .toList();

        if (departmentId != null) {
            employees = employees.stream()
                    .filter(employee -> departmentId.equals(employee.getDepartmentId()))
                    .toList();
        }
        return employees;
    }

    private boolean isManagerOrAdmin(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles != null && roles.stream()
                .anyMatch(role -> role.equals("DEPT_MANAGER") || role.equals("HR_MANAGER")
                        || role.equals("COMPANY_ADMIN") || role.equals("SUPER_ADMIN"));
    }

    private boolean isAdmin(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        return roles != null && roles.stream()
                .anyMatch(role -> role.equals("HR_MANAGER") || role.equals("COMPANY_ADMIN") || role.equals("SUPER_ADMIN"));
    }

    private Map<UUID, String> departmentNames(List<Employee> employees) {
        List<UUID> departmentIds = employees.stream()
                .map(Employee::getDepartmentId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (departmentIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        departmentRepository.findAllById(departmentIds)
                .forEach(department -> names.put(department.getId(), department.getName()));
        return names;
    }

    private StaffStatusResponse toStaffStatus(Employee employee,
                                              AttendanceRecord record,
                                              Map<UUID, String> departmentNames,
                                              Map<UUID, LocalTime> shiftEndByEmployee) {
        return new StaffStatusResponse(
                employee.getId(),
                employee.getEmployeeCode(),
                fullName(employee),
                employee.getJobTitle(),
                employee.getDepartmentId(),
                employee.getDepartmentId() != null ? departmentNames.get(employee.getDepartmentId()) : null,
                employee.getProfilePhotoUrl(),
                record == null || record.getCheckInAt() == null
                        ? "NOT_MARKED"
                        : record.getAttendanceStatus() != null ? record.getAttendanceStatus().name() : "PRESENT",
                record != null ? record.getCheckInAt() : null,
                record != null ? record.getCheckOutAt() : null,
                record != null ? record.getLocationName() : null,
                record != null ? record.getCheckInLatitude() : null,
                record != null ? record.getCheckInLongitude() : null,
                isEarlyCheckout(record, shiftEndByEmployee));
    }

    private AttendanceSummaryCounts countSummary(List<Employee> employees,
                                                 List<AttendanceRecord> records,
                                                 Map<UUID, LocalTime> shiftEndByEmployee) {
        long late = records.stream()
                .filter(record -> record.getAttendanceStatus() != null && record.getAttendanceStatus().name().equals("LATE"))
                .count();
        long halfDay = records.stream()
                .filter(record -> record.getAttendanceStatus() != null && record.getAttendanceStatus().name().equals("HALF_DAY"))
                .count();
        long workFromHome = records.stream()
                .filter(record -> record.getAttendanceType() != null && record.getAttendanceType().name().equals("WFH"))
                .count();
        long marked = records.stream().filter(record -> record.getCheckInAt() != null).count();
        long present = Math.max(0, marked - late - halfDay - workFromHome);
        long notMarked = Math.max(0, employees.size() - marked);
        // Early Out = checked out strictly before the assigned shift end_time
        // (IST wall-clock). See isEarlyCheckout for the exact predicate. An
        // employee can be simultaneously PRESENT/LATE/HALF_DAY *and* an Early
        // Out — the tile is a separate axis, not mutually exclusive with the
        // status buckets, so we do not subtract it from present.
        long earlyCheckout = records.stream()
                .filter(record -> isEarlyCheckout(record, shiftEndByEmployee))
                .count();
        // onLeave and absent are still hardcoded; tracked in a follow-up ticket
        // (leave-request integration not yet wired to the dashboard).
        return new AttendanceSummaryCounts(present, 0, late, halfDay, earlyCheckout, workFromHome, notMarked, notMarked);
    }

    /**
     * True when {@code record} has a non-null {@code check_out_at} whose IST
     * wall-clock time is strictly before the employee's assigned shift
     * {@code end_time}. Returns false when the record is null, the employee
     * hasn't checked out, or we don't know their shift end (no active
     * assignment on the date).
     *
     * <p>TODO night-shift wrap: shifts that span midnight (e.g. 22:00–06:00)
     * are NOT correctly handled by the strict "before end_time" comparison
     * because a 05:30 checkout looks "before 06:00" but is actually on-time,
     * while a 21:00 checkout looks "not before 06:00" but is actually early.
     * The same limitation already exists in AttendanceService.getShiftProfile
     * (which only reads start_time + grace). Fixing this properly requires
     * modelling shift wrap direction; accepted for the initial rollout since
     * every current Unified tenant runs day shifts.
     */
    private static boolean isEarlyCheckout(AttendanceRecord record,
                                           Map<UUID, LocalTime> shiftEndByEmployee) {
        if (record == null || record.getCheckOutAt() == null) {
            return false;
        }
        LocalTime end = shiftEndByEmployee.get(record.getEmployeeId());
        if (end == null) {
            return false;
        }
        LocalTime actual = record.getCheckOutAt().atZone(ZoneId.of("Asia/Kolkata")).toLocalTime();
        return actual.isBefore(end);
    }

    private AttendanceLogResponse toLogResponse(AttendanceEventLog event,
                                                Employee employee,
                                                Map<UUID, String> departmentNames) {
        return new AttendanceLogResponse(
                event.getId(),
                event.getAttendanceRecordId(),
                event.getEmployeeId(),
                employee != null ? fullName(employee) : null,
                employee != null ? employee.getEmployeeCode() : null,
                employee != null && employee.getDepartmentId() != null ? departmentNames.get(employee.getDepartmentId()) : null,
                event.getEventDate(),
                event.getEventAt(),
                event.getEventType() != null ? event.getEventType().name() : null,
                event.getAttendanceStatus() != null ? event.getAttendanceStatus().name() : null,
                event.getLocationName(),
                event.getZoneName(),
                event.getNote());
    }

    private boolean matchesEmployeeSearch(Employee employee, String query) {
        if (employee == null) {
            return false;
        }
        return fullName(employee).toLowerCase().contains(query)
                || employee.getEmployeeCode().toLowerCase().contains(query)
                || employee.getJobTitle() != null && employee.getJobTitle().toLowerCase().contains(query);
    }

    private CorrectionRequestResponse enrichCorrection(CorrectionRequestResponse c,
                                                       Employee employee,
                                                       Map<UUID, String> departmentNames) {
        String employeeName = employee != null ? fullName(employee) : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String departmentName = employee != null && employee.getDepartmentId() != null
                ? departmentNames.get(employee.getDepartmentId())
                : null;
        return new CorrectionRequestResponse(
                c.id(),
                c.employeeId(),
                employeeName,
                employeeCode,
                departmentName,
                c.attendanceRecordId(),
                c.requestedDate(),
                c.requestedCheckInAt(),
                c.requestedCheckOutAt(),
                c.reason(),
                c.attachmentUrl(),
                c.status(),
                c.approverId(),
                c.approverComment(),
                c.decidedAt(),
                c.createdAt());
    }

    private String fullName(Employee employee) {
        // Java's string concatenation prints "null" for a null reference, so
        // (firstName + " " + lastName) became "Anil null" on the punch
        // success screen when lastName was missing. Compose explicitly from
        // the non-null parts, and also drop the literal STRING "null" that
        // legacy import rows sometimes carry in the DB (the frontend used
        // to serialize `String(null)` on save, planting "null" as text).
        return joinName(employee.getFirstName(), employee.getLastName());
    }

    /** Shared name-composer that guards against both real-null and "null"-string. */
    static String joinName(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (isRealName(first)) sb.append(first.trim());
        if (isRealName(last)) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(last.trim());
        }
        return sb.toString();
    }

    private static boolean isRealName(String v) {
        if (v == null) return false;
        String t = v.trim();
        return !t.isEmpty() && !t.equalsIgnoreCase("null") && !t.equalsIgnoreCase("undefined");
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String employeeId = jwt.getClaimAsString("employee_id");
        return employeeId != null ? UUID.fromString(employeeId) : UUID.fromString(jwt.getSubject());
    }
}
