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
import com.hrms.attendance.enums.CheckInMethod;
import com.hrms.leave.entity.LeaveRequest;
import com.hrms.leave.repository.LeaveRequestRepository;
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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
    private final LeaveRequestRepository leaveRequestRepository;
    @org.springframework.beans.factory.annotation.Autowired
    private ApproverScopeGuard approverScopeGuard;
    /** Company attendance policy + manual reviews (V143.10): the day's effective status. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.hrms.attendance.policy.EffectiveDayStatusService effectiveDays;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private AttendanceReviewService reviewService;
    /** Per-company attendance rules (geofence on mobile) from HR Configuration. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.unifiedtree.settings.service.HrConfigurationService hrConfiguration;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private OvertimeReasons overtimeReasons;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private FacePunchDevices facePunchDevices;

    /** Longest window the trend endpoint will serve; longer requests are clamped. */
    private static final int MAX_TREND_DAYS = 31;

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
                                WorkforceDepartmentRepository departmentRepository,
                                LeaveRequestRepository leaveRequestRepository) {
        this.attendanceService = attendanceService;
        this.geoValidationService = geoValidationService;
        this.contextResolver = contextResolver;
        this.employeeRepository = employeeRepository;
        this.departmentRepository = departmentRepository;
        this.leaveRequestRepository = leaveRequestRepository;
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
        // covers the punch's IST date is allowed to punch from any location. The
        // face-recognition + FACE_MISMATCH checks in checkInJson still fire —
        // WFH is a location override, not an identity-verification bypass.
        //
        // The date is resolved from the punch's effective instant (the client's
        // offline capturedAt when it passes the service's safety bounds, else
        // server now) so a punch captured before midnight and flushed after it
        // is still matched against the WFH approval for the day it was made.
        LocalDate punchDate = attendanceService
                .effectivePunchInstant(request.capturedAt(), request.offlineCaptured())
                .atZone(ZoneId.of("Asia/Kolkata")).toLocalDate();
        boolean wfhDay = attendanceService.isApprovedWfhDay(employeeId, punchDate);

        // Blocked only when the server-wide switch AND the company's "Require
        // geofencing on mobile" rule (HR Configuration -> Attendance rules) are on.
        if (!geoValidation.withinFence() && geofenceEnforce && companyRequiresGeofence(ctx.companyId()) && !wfhDay) {
            throw new BusinessRuleException(
                    (geoValidation.message() != null ? geoValidation.message() : "You are outside the attendance zone.")
                            + " Check in from inside your office zone, or ask HR for a work-from-home day.",
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
                wfhDay,
                // capturedAt is honoured ONLY when offlineCaptured is set — an
                // online punch is happening now, so the server clock wins.
                // Both are null/false for pre-capturedAt app builds, which keeps
                // the server-clock behaviour byte-for-byte.
                request.offlineCaptured(),
                request.capturedAt());
        // Accepted from outside the zone (the company doesn't require it): mark
        // the day so it shows in the attendance review list.
        if (!geoValidation.withinFence() && !wfhDay && reviewService != null && dto != null && dto.id() != null) {
            try {
                reviewService.flagOutsideGeofence(dto.id(), LocalDate.parse(dto.attendanceDate()), geoValidation.distanceMeters());
            } catch (RuntimeException e) {
                org.slf4j.LoggerFactory.getLogger(AttendanceController.class)
                        .warn("Could not flag an outside-zone check-in {}: {}", dto.id(), e.getMessage());
            }
        }
        // Put the phone / kiosk on the face check that cleared this punch, so
        // the Face tab can say where it happened (V143.25). Best effort.
        if (facePunchDevices != null) {
            try {
                facePunchDevices.link(jwt.getSubject(), request.deviceId(), request.checkInMethod());
            } catch (RuntimeException ignored) {
                // The punch is saved; a missing device label must never fail it.
            }
        }
        return ResponseEntity.ok(dto);
    }

    /** The company's "Require geofencing on mobile" rule; true (enforce) when it can't be read. */
    private boolean companyRequiresGeofence(UUID companyId) {
        if (hrConfiguration == null || companyId == null) return true;
        try {
            return hrConfiguration.getOrDefault(companyId).enforceGeofencingForMobile();
        } catch (RuntimeException e) {
            return true;
        }
    }

    @Operation(summary = "Check out — returns updated attendance record")
    @PostMapping("/checkout")
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public ResponseEntity<AttendanceDto> checkOut(
            @RequestBody(required = false) CheckOutRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        // Employee identity is ALWAYS the caller (JWT). Never trust a
        // client-supplied employeeId here — that used to let any user with
        // attendance.checkin.self force-checkout an arbitrary employee (IDOR,
        // slug: checkout-arbitrary-employee-idor). The DTO no longer carries
        // that field. If a legitimate manager-force-checkout need arises,
        // add a NEW endpoint POST /v1/attendance/team/force-checkout guarded
        // by @PreAuthorize("hasAuthority('attendance.regularization.approve')").
        UUID employeeId = extractEmployeeId(jwt);
        AttendanceDto out = attendanceService.checkOut(
                employeeId,
                request != null ? request.latitude() : null,
                request != null ? request.longitude() : null,
                request != null ? request.checkOutMethod() : null,
                request != null ? request.locationName() : null,
                request != null ? request.zoneName() : null,
                request != null ? request.deviceId() : null,
                request != null && request.offlineCaptured(),
                request != null ? request.capturedAt() : null);
        // Why they stayed late, when the app sends it (V143.25). Best effort.
        if (overtimeReasons != null && request != null && out != null) {
            try {
                overtimeReasons.recordAtCheckout(out.id(), employeeId, request.overtimeReason());
            } catch (RuntimeException ignored) {
                // The check-out is saved; a missing reason must never fail it.
            }
        }
        return ResponseEntity.ok(out);
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
        int y = year  != null ? year  : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).getYear();
        int m = month != null ? month : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).getMonthValue();
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
        int y = year  != null ? year  : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).getYear();
        int m = month != null ? month : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).getMonthValue();
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
        LocalDate now = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));

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
        LocalDate selectedDate = date != null ? date : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        List<Employee> rosterAll = scopedEmployees(jwt, departmentId);
        // Exclude anyone who joined after the date (a 1-Oct hire is not
        // "absent" on 24 Sep) or whose weekly off falls on the date (Sat/Sun
        // fallback if the employee has no explicit weekly_off_days).
        List<UUID> rosterAllIds = rosterAll.stream().map(Employee::getId).toList();
        java.util.Map<UUID, LocalDate> joins = attendanceService.joiningDatesFor(rosterAllIds);
        java.util.Map<UUID, java.util.Set<Integer>> weekOffs = attendanceService.weeklyOffSetsFor(rosterAllIds);
        int dow = selectedDate.getDayOfWeek().getValue();
        List<Employee> employees = rosterAll.stream()
                .filter(emp -> {
                    LocalDate joined = joins.get(emp.getId());
                    if (joined != null && joined.isAfter(selectedDate)) return false;
                    java.util.Set<Integer> off = weekOffs.get(emp.getId());
                    return off == null || !off.contains(dow);
                })
                .toList();
        List<UUID> employeeIds = employees.stream().map(Employee::getId).toList();
        List<AttendanceRecord> records = attendanceService.getRecordsForEmployeesOnDate(
                employeeIds, selectedDate);
        Map<UUID, AttendanceRecord> byEmployee = records.stream()
                .collect(Collectors.toMap(AttendanceRecord::getEmployeeId, Function.identity(), (a, b) -> a));
        Map<UUID, String> departmentNames = departmentNames(employees);
        // One bulk lookup for the shift in force on the date; its end feeds both
        // the per-row earlyCheckout flag and the aggregate countSummary tile,
        // its name/start/grace feed the per-row "late by" columns.
        Map<UUID, AttendanceService.ShiftWindow> shiftLookup;
        try {
            shiftLookup = attendanceService.getShiftWindowsForEmployees(employeeIds, selectedDate);
        } catch (RuntimeException e) {
            // Shift details only enrich the roster (late-by, early checkout). A
            // failure there must not take down the whole team dashboard, which
            // the mobile manager home screen also loads.
            org.slf4j.LoggerFactory.getLogger(AttendanceController.class)
                    .warn("Team dashboard: shift lookup failed for {} on {}: {}", employeeIds.size(), selectedDate, e.getMessage());
            shiftLookup = Map.of();
        }
        Map<UUID, AttendanceService.ShiftWindow> shiftByEmployee = shiftLookup;
        Map<UUID, java.time.Instant> shiftEndByEmployee = shiftByEmployee.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> e.getValue().expectedEnd()));

        // Approved leave is looked up ONCE and handed to both the roster rows
        // and the tiles. It used to be fetched inside countSummary only, which
        // is why the "On Leave" / "Absent" tiles had no per-row counterpart:
        // clicking a tile filtered rows that never carried the fact the tile
        // was counting. One lookup, one set, both consumers.
        Set<UUID> onLeaveIds = employees.isEmpty()
                ? Set.of()
                : Set.copyOf(leaveRequestRepository.findEmployeeIdsOnApprovedLeave(
                        employeeIds, selectedDate));

        // The day's effective status per person: the company attendance policy
        // (grace, half-day rules, late allowance) and any reviewer's change.
        Map<UUID, com.hrms.attendance.policy.EffectiveDay> effective = effectiveOn(employeeIds, selectedDate);

        List<StaffStatusResponse> staff = employees.stream()
                .map(employee -> toStaffStatus(
                        employee, byEmployee.get(employee.getId()), departmentNames, shiftEndByEmployee,
                        onLeaveIds.contains(employee.getId()), shiftByEmployee.get(employee.getId()),
                        effective.get(employee.getId())))
                .sorted(Comparator.comparing(StaffStatusResponse::fullName))
                .toList();

        return ResponseEntity.ok(new TeamDashboardResponse(
                selectedDate,
                effective.isEmpty()
                        ? countSummary(employees, records, shiftEndByEmployee, onLeaveIds)
                        : countSummaryFromRows(staff, onLeaveIds),
                staff));
    }

    /** Effective statuses for one day; empty when the policy service isn't available. */
    private Map<UUID, com.hrms.attendance.policy.EffectiveDay> effectiveOn(List<UUID> employeeIds, LocalDate date) {
        if (effectiveDays == null || employeeIds.isEmpty()) return Map.of();
        Map<UUID, com.hrms.attendance.policy.EffectiveDay> out = new HashMap<>();
        effectiveDays.effectiveStatuses(employeeIds, date, date).forEach((id, byDate) -> {
            com.hrms.attendance.policy.EffectiveDay d = byDate.get(date);
            if (d != null) out.put(id, d);
        });
        return out;
    }

    /**
     * The row's status in the words the mobile app already uses: ON_TIME /
     * PRESENT / LATE / HALF_DAY for a worked day, ABSENT when a worked day was
     * judged absent (hours rule, reviewer), otherwise NOT_MARKED (no punch).
     */
    static String legacyStatus(com.hrms.attendance.policy.EffectiveDay d) {
        return switch (d.status()) {
            case com.hrms.attendance.policy.EffectiveDay.PRESENT ->
                    d.hasPunch() && !d.manual() && d.lateMinutes() == null ? "ON_TIME" : "PRESENT";
            case com.hrms.attendance.policy.EffectiveDay.LATE, com.hrms.attendance.policy.EffectiveDay.HALF_DAY -> d.status();
            case com.hrms.attendance.policy.EffectiveDay.ABSENT -> d.hasPunch() || d.manual() ? "ABSENT" : "NOT_MARKED";
            default -> "NOT_MARKED";
        };
    }

    /** Tiles from the rows' statuses, so a tile and its drill-down always agree. */
    static AttendanceSummaryCounts countSummaryFromRows(List<StaffStatusResponse> rows, Set<UUID> onLeaveIds) {
        java.util.function.Predicate<StaffStatusResponse> worked = r ->
                "ON_TIME".equals(r.status()) || "PRESENT".equals(r.status())
                        || "LATE".equals(r.status()) || "HALF_DAY".equals(r.status());
        long late = rows.stream().filter(r -> "LATE".equals(r.status())).count();
        long halfDay = rows.stream().filter(r -> "HALF_DAY".equals(r.status())).count();
        long wfh = rows.stream().filter(worked).filter(r -> "WFH".equals(r.attendanceType())).count();
        long present = rows.stream().filter(r -> "ON_TIME".equals(r.status()) || "PRESENT".equals(r.status()))
                .filter(r -> !"WFH".equals(r.attendanceType())).count();
        Set<UUID> markedIds = rows.stream().filter(worked).map(StaffStatusResponse::employeeId).collect(Collectors.toSet());
        long onLeaveUnmarked = onLeaveIds.stream().filter(id -> !markedIds.contains(id)).count();
        // A company holiday, a day before tracking started or a future day is
        // nobody's "not marked" / absent.
        long offDay = rows.stream().filter(r -> !worked.test(r) && isOffDay(r.effectiveStatus())).count();
        long notMarked = Math.max(0, rows.size() - markedIds.size() - offDay);
        long absent = Math.max(0, notMarked - onLeaveUnmarked);
        long early = rows.stream().filter(StaffStatusResponse::earlyCheckout).count();
        return new AttendanceSummaryCounts(present, onLeaveIds.size(), late, halfDay, early, wfh, notMarked, absent);
    }

    private static boolean isOffDay(String effectiveStatus) {
        return com.hrms.attendance.policy.EffectiveDay.HOLIDAY.equals(effectiveStatus)
                || com.hrms.attendance.policy.EffectiveDay.WEEKLY_OFF.equals(effectiveStatus)
                || com.hrms.attendance.policy.EffectiveDay.NOT_TRACKED.equals(effectiveStatus)
                || com.hrms.attendance.policy.EffectiveDay.UPCOMING.equals(effectiveStatus);
    }

    /**
     * Per-day attendance counts across a date range — the series behind the
     * dashboard's attendance trend chart.
     *
     * <p>Deliberately ONE query for the whole window (plus one for leave)
     * rather than re-running the single-day dashboard per date: a 31-day range
     * would otherwise be 62 round trips and would re-ship the roster each time.
     * Records are fetched once and bucketed by date in memory.
     *
     * <p>Days with no records still appear, as zero rows, so the chart keeps an
     * unbroken x-axis over weekends and holidays instead of silently dropping
     * them.
     */
    @Operation(summary = "Per-day attendance counts for a date range (trend chart)")
    @GetMapping("/dashboard/trend")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<List<DailyAttendanceCounts>> dashboardTrend(
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to,
            @RequestParam(required = false) UUID departmentId,
            @AuthenticationPrincipal Jwt jwt) {
        LocalDate end   = to != null ? to : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        LocalDate start = from != null ? from : end.minusDays(6);
        if (start.isAfter(end)) {
            LocalDate swap = start; start = end; end = swap;
        }
        // Clamp rather than 400: a chart asking for too much should degrade to
        // the most recent MAX_TREND_DAYS, not blow up in the user's face.
        if (start.isBefore(end.minusDays(MAX_TREND_DAYS - 1L))) {
            start = end.minusDays(MAX_TREND_DAYS - 1L);
        }

        List<Employee> employees = scopedEmployees(jwt, departmentId);
        List<UUID> employeeIds = employees.stream().map(Employee::getId).toList();
        // Per-day roster: exclude employees who joined after the day, or whose
        // weekly off falls on that day. Same rule the KPI tiles use, so tile
        // and chart never disagree.
        java.util.Map<UUID, LocalDate> trendJoins = attendanceService.joiningDatesFor(employeeIds);
        java.util.Map<UUID, java.util.Set<Integer>> trendOffs = attendanceService.weeklyOffSetsFor(employeeIds);

        List<AttendanceRecord> records = employeeIds.isEmpty()
                ? List.of()
                : attendanceService.getRecordsForEmployeesBetween(employeeIds, start, end);
        Map<LocalDate, List<AttendanceRecord>> recordsByDate = records.stream()
                .filter(record -> record.getAttendanceDate() != null)
                .collect(Collectors.groupingBy(AttendanceRecord::getAttendanceDate));

        // Approved leave for the window, expanded per day. One row can span
        // many days, so it contributes to every date it covers inside [start,end].
        Map<LocalDate, Set<UUID>> leaveByDate = new HashMap<>();
        if (!employeeIds.isEmpty()) {
            for (LeaveRequest leave : leaveRequestRepository.findApprovedLeaveInRange(employeeIds, start, end)) {
                LocalDate cursor = leave.getStartDate().isBefore(start) ? start : leave.getStartDate();
                LocalDate last   = leave.getEndDate().isAfter(end) ? end : leave.getEndDate();
                while (!cursor.isAfter(last)) {
                    leaveByDate.computeIfAbsent(cursor, key -> new HashSet<>()).add(leave.getEmployeeId());
                    cursor = cursor.plusDays(1);
                }
            }
        }

        // Company attendance policy + reviewers' changes (V143.10): count each
        // person once per day from their effective status.
        Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> effective =
                effectiveDays == null || employeeIds.isEmpty() ? Map.of() : effectiveDays.effectiveStatuses(employeeIds, start, end);

        List<DailyAttendanceCounts> series = new java.util.ArrayList<>();
        for (LocalDate day = start; !day.isAfter(end); day = day.plusDays(1)) {
            List<AttendanceRecord> dayRecords = recordsByDate.getOrDefault(day, List.of());
            Set<UUID> onLeaveIds = leaveByDate.getOrDefault(day, Set.of());
            int dayDow = day.getDayOfWeek().getValue();
            LocalDate dayFinal = day;
            int rosterForDay = (int) employees.stream()
                    .filter(emp -> {
                        LocalDate joined = trendJoins.get(emp.getId());
                        if (joined != null && joined.isAfter(dayFinal)) return false;
                        java.util.Set<Integer> off = trendOffs.get(emp.getId());
                        return off == null || !off.contains(dayDow);
                    })
                    .count();
            // People (already joined) whose own weekly off is this day. When
            // that is everyone, the calendar shows the day as a weekly off.
            int offForDay = (int) employees.stream()
                    .filter(emp -> {
                        LocalDate joined = trendJoins.get(emp.getId());
                        if (joined != null && joined.isAfter(dayFinal)) return false;
                        java.util.Set<Integer> off = trendOffs.get(emp.getId());
                        return off != null && off.contains(dayDow);
                    })
                    .count();
            if (!effective.isEmpty()) {
                List<UUID> roster = employees.stream()
                        .filter(emp -> {
                            LocalDate joined = trendJoins.get(emp.getId());
                            if (joined != null && joined.isAfter(dayFinal)) return false;
                            java.util.Set<Integer> off = trendOffs.get(emp.getId());
                            return off == null || !off.contains(dayDow);
                        })
                        .map(Employee::getId).toList();
                series.add(effectiveCounts(day, roster, offForDay, effective, dayRecords));
                continue;
            }
            series.add(dailyCounts(day, rosterForDay, offForDay, dayRecords, onLeaveIds));
        }
        return ResponseEntity.ok(series);
    }

    /**
     * Same bucket definitions as {@link #countSummary} so the trend chart and
     * the KPI tiles can never disagree — present excludes late/half-day/WFH,
     * and approved-leave people are removed from absent.
     */
    static DailyAttendanceCounts dailyCounts(LocalDate date,
                                             int rosterSize,
                                             int weeklyOff,
                                             List<AttendanceRecord> dayRecords,
                                             Set<UUID> onLeaveIds) {
        long late = dayRecords.stream()
                .filter(r -> r.getAttendanceStatus() != null && r.getAttendanceStatus().name().equals("LATE"))
                .count();
        long halfDay = dayRecords.stream()
                .filter(r -> r.getAttendanceStatus() != null && r.getAttendanceStatus().name().equals("HALF_DAY"))
                .count();
        long workFromHome = dayRecords.stream()
                .filter(r -> r.getAttendanceType() != null && r.getAttendanceType().name().equals("WFH"))
                .count();
        long marked = dayRecords.stream().filter(r -> r.getCheckInAt() != null).count();
        long present = dayRecords.stream().filter(AttendanceController::isPresentBucket).count();

        Set<UUID> markedIds = dayRecords.stream()
                .filter(r -> r.getCheckInAt() != null)
                .map(AttendanceRecord::getEmployeeId)
                .collect(Collectors.toSet());
        long onLeaveUnmarked = onLeaveIds.stream().filter(id -> !markedIds.contains(id)).count();

        long notMarked = Math.max(0, rosterSize - marked);
        long absent = Math.max(0, notMarked - onLeaveUnmarked);
        long overtimeMinutes = dayRecords.stream()
                .filter(r -> r.getOvertimeMinutes() != null)
                .mapToLong(AttendanceRecord::getOvertimeMinutes)
                .sum();
        // Everyone who checked in, each person once, and the part of them who
        // worked from home on time (not late, not half-day). present + late +
        // halfDay + workFromHomeOnTime = checkedIn, so a WFH-and-late day is no
        // longer counted twice (V143.25).
        long checkedIn = markedIds.size();
        long workFromHomeOnTime = dayRecords.stream()
                .filter(r -> r.getCheckInAt() != null)
                .filter(r -> r.getAttendanceType() != null && r.getAttendanceType().name().equals("WFH"))
                .filter(r -> {
                    String st = r.getAttendanceStatus() == null ? "" : r.getAttendanceStatus().name();
                    return !st.equals("LATE") && !st.equals("HALF_DAY");
                })
                .map(AttendanceRecord::getEmployeeId)
                .distinct()
                .count();
        return new DailyAttendanceCounts(
                date, present, onLeaveIds.size(), late, halfDay, workFromHome, notMarked, absent,
                overtimeMinutes, checkedIn, workFromHomeOnTime, rosterSize, weeklyOff,
                rosterSize == 0 && weeklyOff > 0);
    }

    /**
     * One day's counts from effective statuses: each person lands in exactly one
     * bucket, so present + late + half day + work from home is the number who
     * came in. notMarked = absent (no punch, no leave) + on leave.
     */
    static DailyAttendanceCounts effectiveCounts(LocalDate date, List<UUID> roster, int weeklyOff,
                                                 Map<UUID, Map<LocalDate, com.hrms.attendance.policy.EffectiveDay>> effective,
                                                 List<AttendanceRecord> dayRecords) {
        long present = 0, late = 0, halfDay = 0, wfhOnTime = 0, wfhAll = 0, onLeave = 0, absent = 0;
        for (UUID id : roster) {
            com.hrms.attendance.policy.EffectiveDay d = effective.getOrDefault(id, Map.of()).get(date);
            if (d == null) continue;
            boolean home = "WFH".equals(d.attendanceType());
            switch (d.status()) {
                case com.hrms.attendance.policy.EffectiveDay.PRESENT -> { if (home) { wfhOnTime++; wfhAll++; } else present++; }
                case com.hrms.attendance.policy.EffectiveDay.LATE -> { late++; if (home) wfhAll++; }
                case com.hrms.attendance.policy.EffectiveDay.HALF_DAY -> { halfDay++; if (home) wfhAll++; }
                case com.hrms.attendance.policy.EffectiveDay.ON_LEAVE -> onLeave++;
                case com.hrms.attendance.policy.EffectiveDay.ABSENT, com.hrms.attendance.policy.EffectiveDay.NOT_MARKED -> absent++;
                default -> { /* holiday, weekly off, not tracked: not counted */ }
            }
        }
        long overtime = dayRecords.stream().filter(r -> r.getOvertimeMinutes() != null).mapToLong(AttendanceRecord::getOvertimeMinutes).sum();
        // Each person is in one bucket: present + late + half day + on-time WFH = the
        // ones who came in (checkedIn). workFromHome is everyone who worked from home
        // (late and half-day ones too), as w2f's V143.25 fields define it.
        long checkedIn = present + late + halfDay + wfhOnTime;
        return new DailyAttendanceCounts(date, present, onLeave, late, halfDay, wfhAll, absent + onLeave, absent, overtime,
                checkedIn, wfhOnTime, roster.size(), weeklyOff, roster.isEmpty() && weeklyOff > 0);
    }

    /** One point on the attendance trend chart. */
    public record DailyAttendanceCounts(
            LocalDate date,
            long present,
            long onLeave,
            long late,
            long halfDay,
            long workFromHome,
            long notMarked,
            long absent,
            /** Total overtime clocked that day, in minutes, across the roster. */
            long overtimeMinutes,
            /** People who checked in that day, each counted once (V143.25). */
            long checkedIn,
            /** Of those, the ones who worked from home and were neither late nor half-day. */
            long workFromHomeOnTime,
            /** People expected at work that day: joined, and not on their weekly off. */
            long scheduled,
            /** People (already joined) whose weekly off is that day. */
            long weeklyOff,
            /** True when the day is a weekly off for everyone in scope (nobody scheduled). */
            boolean weeklyOffDay) {}

    /**
     * How today's punches arrived — face, GPS, PIN, biometric device, manual or
     * manager override. Feeds the dashboard's "Attendance Source" panel.
     *
     * <p>Only rows with a check-in are counted: a NOT_MARKED employee has no
     * method, and bucketing them under "manual" would invent a punch. Methods
     * with a zero count are still returned so the panel keeps a stable shape
     * instead of reflowing as usage shifts through the day.
     *
     * <p>Optional {@code from} + {@code to} (both given) count every check-in in
     * that range instead — Attendance Analytics for a past month. The range is
     * clamped like the trend's; without it the endpoint answers for one day,
     * as before.
     */
    @Operation(summary = "Check-ins grouped by capture method, for a day or a date range")
    @GetMapping("/dashboard/sources")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<AttendanceSourceBreakdown> dashboardSources(
            @RequestParam(required = false) LocalDate date,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to,
            @AuthenticationPrincipal Jwt jwt) {
        LocalDate selectedDate = date != null ? date : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        LocalDate[] range = sourceRange(selectedDate, from, to);
        List<Employee> employees = scopedEmployees(jwt, departmentId);
        List<UUID> employeeIds = employees.stream().map(Employee::getId).toList();
        List<AttendanceRecord> records = employeeIds.isEmpty()
                ? List.of()
                : range[0].equals(range[1])
                        ? attendanceService.getRecordsForEmployeesOnDate(employeeIds, range[0])
                        : attendanceService.getRecordsForEmployeesBetween(employeeIds, range[0], range[1]);

        Map<String, Long> byMethod = new HashMap<>();
        for (CheckInMethod method : CheckInMethod.values()) byMethod.put(method.name(), 0L);
        long unknown = 0;
        for (AttendanceRecord record : records) {
            if (record.getCheckInAt() == null) continue;
            CheckInMethod method = record.getCheckInMethod();
            if (method == null) { unknown++; continue; }
            byMethod.merge(method.name(), 1L, Long::sum);
        }
        List<SourceCount> sources = byMethod.entrySet().stream()
                .map(entry -> new SourceCount(entry.getKey(), entry.getValue()))
                .sorted(Comparator.comparing(SourceCount::method))
                .toList();
        return ResponseEntity.ok(new AttendanceSourceBreakdown(range[1], sources, unknown));
    }

    /**
     * The days the sources panel counts: {@code [from, to]} when both are given
     * (swapped if reversed, clamped to the last {@link #MAX_TREND_DAYS} days),
     * otherwise just {@code date}.
     */
    static LocalDate[] sourceRange(LocalDate date, LocalDate from, LocalDate to) {
        if (from == null || to == null) return new LocalDate[] { date, date };
        LocalDate start = from, end = to;
        if (start.isAfter(end)) { LocalDate swap = start; start = end; end = swap; }
        if (start.isBefore(end.minusDays(MAX_TREND_DAYS - 1L))) start = end.minusDays(MAX_TREND_DAYS - 1L);
        return new LocalDate[] { start, end };
    }

    /** One capture-method bucket. */
    public record SourceCount(String method, long count) {}

    /** Today's punches grouped by how they were captured. */
    public record AttendanceSourceBreakdown(
            LocalDate date,
            List<SourceCount> sources,
            /** Punches whose method was never recorded (legacy rows). */
            long unknown) {}

    @Operation(summary = "Manager/Admin chronological attendance activity log")
    @GetMapping("/logs")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<List<AttendanceLogResponse>> logs(
            @RequestParam(required = false) LocalDate date,
            @RequestParam(required = false) UUID departmentId,
            @RequestParam(required = false) String search,
            @AuthenticationPrincipal Jwt jwt) {
        LocalDate selectedDate = date != null ? date : LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
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

    @Operation(summary = "HR/Admin manual attendance entry or override")
    @PostMapping("/manual-entry")
    @PreAuthorize("hasAuthority('attendance.workforce.admin')")
    public ResponseEntity<AttendanceDto> manualEntry(
            @Valid @RequestBody ManualAttendanceRequest request,
            @AuthenticationPrincipal Jwt jwt) {
        // Even with the permission, you cannot rewrite your OWN attendance.
        UUID actor = extractEmployeeId(jwt);
        if (actor != null && actor.equals(request.employeeId())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "You cannot record manual attendance for yourself.");
        }
        AttendanceContextResolver.Context target = contextResolver.resolve(request.employeeId());
        AttendanceDto dto = attendanceService.manualEntry(
                request,
                actor,
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
        // Proof must be a file this person uploaded (or a web link from older clients).
        String proofProblem = CorrectionProofController.attachmentProblem(
                request.attachmentUrl(), CorrectionProofController.ownPrefix(employeeId));
        if (proofProblem != null) throw new BusinessRuleException(proofProblem, "CORRECTION_PROOF_INVALID");
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
            @AuthenticationPrincipal Jwt jwt,
            org.springframework.security.core.Authentication auth) {
        approverScopeGuard.assertCanDecideFor(attendanceService.correctionRequesterOf(correctionId), jwt, auth);
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
            @PageableDefault(size = 31) Pageable pageable,
            @AuthenticationPrincipal Jwt jwt) {
        // B7 FIX (audit 2026-08-15): object-scope IDOR guard — attendance.team.read
        // alone allowed any manager in the tenant to enumerate any employee's
        // attendance. Restrict to self / direct manager / HR-Admin.
        assertCanReadEmployeeAttendance(jwt, employeeId);
        return ResponseEntity.ok(attendanceService.getEmployeeAttendance(employeeId, pageable));
    }

    @Operation(summary = "A specific employee's weekly summary (manager/admin)")
    @GetMapping("/employee/{employeeId}/weekly-summary")
    @PreAuthorize("hasAuthority('attendance.team.read')")
    public ResponseEntity<WeeklySummaryResponse> employeeWeeklySummary(
            @PathVariable UUID employeeId,
            @RequestParam(required = false) LocalDate weekStart,
            @AuthenticationPrincipal Jwt jwt) {
        // B7 FIX (audit 2026-08-15): same IDOR guard as records above.
        assertCanReadEmployeeAttendance(jwt, employeeId);
        return ResponseEntity.ok(attendanceService.getWeeklySummary(employeeId, weekStart));
    }

    /**
     * Object-scope IDOR guard used by {@code /employee/{id}/records} +
     * {@code /employee/{id}/weekly-summary}. Same rule as
     * {@code EmployeeController.assertCanAccessEmployee}: SELF /
     * direct-manager / HR-Admin.
     */
    private void assertCanReadEmployeeAttendance(Jwt jwt, UUID targetEmployeeId) {
        if (jwt == null || targetEmployeeId == null) {
            throw new org.springframework.security.access.AccessDeniedException("forbidden");
        }
        UUID caller = extractEmployeeId(jwt);
        if (targetEmployeeId.equals(caller)) return;
        // Company-wide attendance admins (permission, not role name: V143.17).
        if (isAdmin(jwt)) return;
        Employee target = employeeRepository.findById(targetEmployeeId).orElse(null);
        if (target != null && caller.equals(target.getManagerId())) return;
        throw new org.springframework.security.access.AccessDeniedException(
                "You are not authorised to view this employee's attendance.");
    }

    private List<Employee> scopedEmployees(Jwt jwt, UUID departmentId) {
        return new TeamEmployeeScope(employeeRepository, departmentRepository).resolve(jwt, departmentId);
    }

    // Permission-based since V143.17; these used to test role names, which the
    // Roles & permissions screen (and per-person overrides) could not change.
    /** Sees a team: holds attendance.team.read (the My team page permission). */
    static boolean isManagerOrAdmin(Jwt jwt) {
        return hasPermission(jwt, "attendance.team.read");
    }

    /**
     * Company-wide attendance: holds attendance.workforce.admin. Exactly the
     * roles that used to pass by name (HR_MANAGER, ADMIN, OWNER, SUPER_ADMIN).
     */
    static boolean isAdmin(Jwt jwt) {
        return hasPermission(jwt, "attendance.workforce.admin");
    }

    /** The token's permissions claim (the same set Spring Security checks with hasAuthority). */
    static boolean hasPermission(Jwt jwt, String permission) {
        if (jwt == null) return false;
        List<String> permissions = jwt.getClaimAsStringList("permissions");
        return permissions != null && permissions.contains(permission);
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
                                              Map<UUID, java.time.Instant> shiftEndByEmployee,
                                              boolean onLeave,
                                              AttendanceService.ShiftWindow shift,
                                              com.hrms.attendance.policy.EffectiveDay eff) {
        String status = eff != null ? legacyStatus(eff) : record == null || record.getCheckInAt() == null
                ? "NOT_MARKED"
                : record.getAttendanceStatus() != null ? record.getAttendanceStatus().name() : "PRESENT";
        java.time.Instant checkIn = record != null ? record.getCheckInAt() : null;
        java.time.Instant expected = shift != null ? shift.expectedStart() : eff != null ? eff.expectedStart() : null;
        return new StaffStatusResponse(
                employee.getId(),
                employee.getEmployeeCode(),
                fullName(employee),
                employee.getJobTitle(),
                employee.getDepartmentId(),
                employee.getDepartmentId() != null ? departmentNames.get(employee.getDepartmentId()) : null,
                employee.getProfilePhotoUrl(),
                status,
                checkIn,
                record != null ? record.getCheckOutAt() : null,
                record != null ? record.getLocationName() : null,
                record != null ? record.getCheckInLatitude() : null,
                record != null ? record.getCheckInLongitude() : null,
                eff != null ? eff.earlyLeave() : isEarlyCheckout(record, shiftEndByEmployee),
                record != null && record.getAttendanceType() != null
                        ? record.getAttendanceType().name()
                        : null,
                onLeave,
                shift != null ? shift.shiftName() : null,
                expected,
                shift != null ? Integer.valueOf(shift.graceMinutes()) : eff != null ? eff.graceMinutes() : null,
                eff != null ? eff.lateMinutes() : StaffStatusResponse.lateBy(status, checkIn, expected),
                eff != null ? eff.status() : null,
                eff != null ? eff.note() : null,
                eff != null && eff.manual(),
                eff != null && eff.lossOfPay(),
                eff != null && eff.withinAllowance(),
                eff != null && eff.outsideGeofence(),
                eff != null && eff.punchRejected(),
                eff != null ? eff.earlyByMinutes() : null,
                eff != null ? eff.workedMinutes() : null);
    }

    // Count a set, not scalar subtraction: LATE and WFH can overlap.
    static boolean isPresentBucket(AttendanceRecord record) {
        String status = record.getAttendanceStatus() == null ? "" : record.getAttendanceStatus().name();
        return record.getCheckInAt() != null && !status.equals("LATE") && !status.equals("HALF_DAY")
                && (record.getAttendanceType() == null || !record.getAttendanceType().name().equals("WFH"));
    }

    private AttendanceSummaryCounts countSummary(List<Employee> employees,
                                                 List<AttendanceRecord> records,
                                                 Map<UUID, java.time.Instant> shiftEndByEmployee,
                                                 Set<UUID> onLeaveIds) {
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
        long present = records.stream().filter(AttendanceController::isPresentBucket).count();

        // Who is legitimately out today. Only APPROVED leave counts — a pending
        // request has not taken anyone out of the office. The set is resolved by
        // the caller (one lookup, shared with the per-row roster) and is already
        // restricted to the roster this dashboard is scoped to, so a manager's
        // tile never leaks org-wide numbers.
        long onLeave = onLeaveIds.size();

        // An employee on approved leave who also punched in is counted by the
        // punch, not by the leave — otherwise the buckets would double-count.
        Set<UUID> markedIds = records.stream()
                .filter(record -> record.getCheckInAt() != null)
                .map(AttendanceRecord::getEmployeeId)
                .collect(Collectors.toSet());
        long onLeaveUnmarked = onLeaveIds.stream().filter(id -> !markedIds.contains(id)).count();

        // notMarked = no punch at all (the raw "nobody knows" bucket).
        // absent    = no punch AND no approved leave, i.e. genuinely unexplained.
        // Before this fix `absent` was literally `notMarked` passed twice, so the
        // two tiles always rendered the same number and people on approved leave
        // were reported as absent.
        long notMarked = Math.max(0, employees.size() - marked);
        long absent = Math.max(0, notMarked - onLeaveUnmarked);
        // Early Out = checked out strictly before the assigned shift end_time
        // (IST wall-clock). See isEarlyCheckout for the exact predicate. An
        // employee can be simultaneously PRESENT/LATE/HALF_DAY *and* an Early
        // Out — the tile is a separate axis, not mutually exclusive with the
        // status buckets, so we do not subtract it from present.
        long earlyCheckout = records.stream()
                .filter(record -> isEarlyCheckout(record, shiftEndByEmployee))
                .count();
        return new AttendanceSummaryCounts(
                present, onLeave, late, halfDay, earlyCheckout, workFromHome, notMarked, absent);
    }

    /** Compare absolute shift-end instants so overnight shifts use the following date. */
    private static boolean isEarlyCheckout(AttendanceRecord record,
                                           Map<UUID, java.time.Instant> shiftEndByEmployee) {
        if (record == null || record.getCheckOutAt() == null) return false;
        java.time.Instant end = shiftEndByEmployee.get(record.getEmployeeId());
        return end != null && record.getCheckOutAt().isBefore(end);
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
