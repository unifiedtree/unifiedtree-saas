package com.unifiedtree.attendance.api;

import com.unifiedtree.attendance.api.AttendanceApiDtos.AttendanceDto;
import com.unifiedtree.attendance.api.AttendanceApiDtos.AttendanceHomeResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.AttendanceRecordResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CheckInRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CheckOutRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CheckOutSummaryResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CorrectionRequestRequest;
import com.unifiedtree.attendance.api.AttendanceApiDtos.CorrectionRequestResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.DayRecordResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.EmployeeResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.GeoValidateResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.MonthlyStatsResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.PageResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.WeeklyDayResponse;
import com.unifiedtree.attendance.api.AttendanceApiDtos.WeeklySummaryResponse;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class CanonicalAttendanceService {
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final LocalTime LATE_THRESHOLD = LocalTime.of(9, 30);
    private static final double STANDARD_HOURS = 8.0;

    private final JdbcTemplate jdbc;

    public CanonicalAttendanceService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public AttendanceHomeResponse home() {
        EmployeeContext employee = currentEmployee();
        LocalDate today = LocalDate.now(IST);
        AttendanceDto todayRecord = findToday(employee.employeeId()).orElse(null);
        MonthlyStatsResponse monthly = monthlyStats(today.getYear(), today.getMonthValue());
        int pending = countPendingCorrections(employee.employeeId());
        ShiftProfile shift = lookupShiftProfile(employee.employeeId(), today);

        return new AttendanceHomeResponse(
                employee.fullName(),
                employee.jobTitle(),
                todayRecord != null && todayRecord.checkInTime() != null && todayRecord.checkOutTime() == null,
                todayRecord,
                monthly,
                employee.branchName() != null ? employee.branchName() : "Office",
                true,
                pending,
                0,
                shift != null ? shift.scheduledStart() : null,
                shift != null ? shift.graceMinutes() : null);
    }

    @Transactional(readOnly = true)
    public GeoValidateResponse geoFence(double latitude, double longitude) {
        EmployeeContext employee = currentEmployee();
        if (employee.branchId() == null || employee.branchLat() == null || employee.branchLon() == null) {
            return new GeoValidateResponse(true, employee.branchId(), employee.branchName(), 0,
                    "No branch geofence configured. Attendance is allowed.");
        }

        double meters = distanceMeters(latitude, longitude, employee.branchLat(), employee.branchLon());
        boolean within = meters <= Math.max(1, employee.geoFenceRadiusMeters());
        return new GeoValidateResponse(
                within,
                employee.branchId(),
                employee.branchName(),
                meters,
                within ? "Within office geofence." : "Outside office geofence.");
    }

    @Transactional
    public AttendanceDto checkIn(CheckInRequest request) {
        EmployeeContext employee = currentEmployee();
        LocalDate today = LocalDate.now(IST);
        Optional<AttendanceDto> existing = findRecord(employee.employeeId(), today);
        if (existing.isPresent()) {
            return existing.get();
        }

        Instant now = Instant.now();
        String status = attendanceStatus(now);
        UUID recordId = UUID.randomUUID();
        String method = checkMethod(request.checkInMethod());
        String location = firstNonBlank(request.locationName(), employee.branchName(), "Office");
        Integer lateBy = lateByMinutes(now);

        jdbc.update("""
                INSERT INTO attendance.records (
                    id, tenant_id, employee_id, attendance_date,
                    check_in_at, attendance_type, attendance_status, check_in_method,
                    check_in_latitude, check_in_longitude, check_in_location_name,
                    check_in_zone_name, branch_id, company_id, department_id,
                    face_confidence_score, late_by_minutes, overtime_minutes, work_hours,
                    manual_entry, created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?, 'OFFICE', ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL,
                    FALSE, now(), now()
                )
                """,
                recordId,
                tenantId(),
                employee.employeeId(),
                today,
                Timestamp.from(now),
                status,
                method,
                request.latitude(),
                request.longitude(),
                location,
                firstNonBlank(request.zoneName(), employee.branchName()),
                employee.branchId(),
                employee.companyId(),
                employee.departmentId(),
                lateBy);

        logEvent(recordId, employee, "CHECK_IN", now, status,
                request.latitude(), request.longitude(), location, firstNonBlank(request.zoneName(), employee.branchName()), null);
        return findRecord(employee.employeeId(), today)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Attendance insert failed"));
    }

    @Transactional
    public AttendanceDto checkOut(CheckOutRequest request) {
        EmployeeContext employee = currentEmployee();
        LocalDate today = LocalDate.now(IST);
        AttendanceDto active = findRecord(employee.employeeId(), today)
                .filter(r -> r.checkInTime() != null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No active attendance session for today"));
        if (active.checkOutTime() != null) {
            return active;
        }

        Instant out = Instant.now();
        Instant in = Instant.parse(active.checkInTime());
        double hours = round2(Duration.between(in, out).toMinutes() / 60.0);
        int overtime = (int) Math.max(0, Math.round((hours - STANDARD_HOURS) * 60));
        String method = checkMethod(request != null ? request.checkOutMethod() : null);
        String location = firstNonBlank(
                request != null ? request.locationName() : null,
                active.locationName(),
                employee.branchName(),
                "Office");

        jdbc.update("""
                UPDATE attendance.records
                   SET check_out_at = ?,
                       check_out_method = ?,
                       check_out_latitude = ?,
                       check_out_longitude = ?,
                       check_out_location_name = ?,
                       check_out_zone_name = ?,
                       work_hours = ?,
                       overtime_minutes = ?,
                       updated_at = now()
                 WHERE tenant_id = ?
                   AND employee_id = ?
                   AND attendance_date = ?
                   AND id = ?
                """,
                Timestamp.from(out),
                method,
                request != null ? request.latitude() : null,
                request != null ? request.longitude() : null,
                location,
                request != null ? request.zoneName() : null,
                hours,
                overtime,
                tenantId(),
                employee.employeeId(),
                today,
                active.id());

        logEvent(active.id(), employee, "CHECK_OUT", out, active.attendanceStatus(),
                request != null ? request.latitude() : null,
                request != null ? request.longitude() : null,
                location,
                request != null ? request.zoneName() : null,
                null);
        return findRecord(employee.employeeId(), today)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Attendance checkout failed"));
    }

    @Transactional(readOnly = true)
    public CheckOutSummaryResponse checkoutSummary() {
        EmployeeContext employee = currentEmployee();
        AttendanceDto active = findRecord(employee.employeeId(), LocalDate.now(IST))
                .filter(r -> r.checkInTime() != null && r.checkOutTime() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No active attendance session"));
        Instant in = Instant.parse(active.checkInTime());
        long minutes = Duration.between(in, Instant.now()).toMinutes();
        return new CheckOutSummaryResponse(
                active.id(),
                in,
                round2(minutes / 60.0),
                minutes,
                active.locationName(),
                minutes < 60);
    }

    @Transactional(readOnly = true)
    public Optional<AttendanceDto> today() {
        return findToday(currentEmployee().employeeId());
    }

    @Transactional(readOnly = true)
    public MonthlyStatsResponse monthlyStats(Integer year, Integer month) {
        EmployeeContext employee = currentEmployee();
        LocalDate today = LocalDate.now(IST);
        int y = year != null ? year : today.getYear();
        int m = month != null ? month : today.getMonthValue();
        LocalDate start = LocalDate.of(y, m, 1);
        LocalDate end = start.withDayOfMonth(start.lengthOfMonth());
        if (end.isAfter(today)) {
            end = today;
        }

        Map<LocalDate, AttendanceDto> records = recordsBetween(employee.employeeId(), start, end).stream()
                .collect(Collectors.toMap(r -> LocalDate.parse(r.attendanceDate()), Function.identity(), (a, b) -> a));

        int present = 0;
        int absent = 0;
        int late = 0;
        int onTime = 0;
        LocalDate cursor = start;
        while (!cursor.isAfter(end)) {
            if (isWeekend(cursor)) {
                cursor = cursor.plusDays(1);
                continue;
            }
            AttendanceDto rec = records.get(cursor);
            if (rec != null && rec.checkInTime() != null) {
                present++;
                if ("LATE".equals(rec.attendanceStatus())) late++;
                else onTime++;
            } else {
                absent++;
            }
            cursor = cursor.plusDays(1);
        }
        int working = present + absent;
        int score = working == 0 ? 100 : Math.round((float) present * 100 / working);
        return new MonthlyStatsResponse(present, absent, 0, onTime, late, score);
    }

    @Transactional(readOnly = true)
    public List<DayRecordResponse> history(Integer year, Integer month) {
        EmployeeContext employee = currentEmployee();
        LocalDate today = LocalDate.now(IST);
        int y = year != null ? year : today.getYear();
        int m = month != null ? month : today.getMonthValue();
        LocalDate start = LocalDate.of(y, m, 1);
        LocalDate end = start.withDayOfMonth(start.lengthOfMonth());

        Map<LocalDate, AttendanceDto> records = recordsBetween(employee.employeeId(), start, end).stream()
                .collect(Collectors.toMap(r -> LocalDate.parse(r.attendanceDate()), Function.identity(), (a, b) -> a));
        List<DayRecordResponse> out = new ArrayList<>();
        LocalDate cursor = start;
        while (!cursor.isAfter(end)) {
            AttendanceDto rec = records.get(cursor);
            if (rec != null) {
                out.add(new DayRecordResponse(cursor.toString(), rec.attendanceStatus(), rec.checkInTime(), rec.checkOutTime(), rec.workHours()));
            } else if (isWeekend(cursor)) {
                out.add(new DayRecordResponse(cursor.toString(), "WEEKEND", null, null, null));
            } else if (!cursor.isAfter(today)) {
                out.add(new DayRecordResponse(cursor.toString(), "ABSENT", null, null, null));
            }
            cursor = cursor.plusDays(1);
        }
        return out;
    }

    @Transactional(readOnly = true)
    public WeeklySummaryResponse weeklySummary() {
        return weeklySummary(null);
    }

    @Transactional(readOnly = true)
    public WeeklySummaryResponse weeklySummary(LocalDate weekStart) {
        EmployeeContext employee = currentEmployee();
        LocalDate today = LocalDate.now(IST);
        LocalDate monday = weekStart != null
                ? weekStart.with(DayOfWeek.MONDAY)
                : today.with(DayOfWeek.MONDAY);
        LocalDate sunday = monday.plusDays(6);
        Map<LocalDate, AttendanceDto> records = recordsBetween(employee.employeeId(), monday, sunday).stream()
                .collect(Collectors.toMap(r -> LocalDate.parse(r.attendanceDate()), Function.identity(), (a, b) -> a));

        List<WeeklyDayResponse> days = new ArrayList<>();
        double totalHours = 0;
        double overtime = 0;
        int presentDays = 0;
        long arrivalMinutes = 0;
        int arrivalCount = 0;
        for (int i = 0; i < 7; i++) {
            LocalDate date = monday.plusDays(i);
            AttendanceDto rec = records.get(date);
            double hours = rec != null && rec.workHours() != null ? rec.workHours() : 0;
            String status = rec != null ? rec.attendanceStatus() : (isWeekend(date) ? "WEEKEND" : "ABSENT");
            String checkInHm = null;
            String checkOutHm = null;
            Integer lateBy = null;
            if (rec != null) {
                checkInHm = formatHm(rec.checkInTime());
                checkOutHm = formatHm(rec.checkOutTime());
                lateBy = rec.lateByMinutes();
                if (rec.checkInTime() != null) {
                    presentDays++;
                    LocalTime t = Instant.parse(rec.checkInTime()).atZone(IST).toLocalTime();
                    arrivalMinutes += t.getHour() * 60L + t.getMinute();
                    arrivalCount++;
                }
            }
            totalHours += hours;
            overtime += Math.max(0, hours - STANDARD_HOURS);
            days.add(new WeeklyDayResponse(date.toString(), round2(hours), status,
                    checkInHm, checkOutHm, lateBy));
        }
        String avgArrival = arrivalCount == 0
                ? "--"
                : LocalTime.of((int) (arrivalMinutes / arrivalCount / 60), (int) (arrivalMinutes / arrivalCount % 60))
                .format(DateTimeFormatter.ofPattern("HH:mm"));
        Double dailyTargetHours = lookupDailyTargetHours(employee.employeeId(), monday);
        return new WeeklySummaryResponse(round2(totalHours), round2(overtime), presentDays,
                avgArrival, dailyTargetHours, days);
    }

    private String formatHm(String isoInstant) {
        if (isoInstant == null) return null;
        try {
            return Instant.parse(isoInstant).atZone(IST).toLocalTime()
                    .format(DateTimeFormatter.ofPattern("HH:mm"));
        } catch (Exception ex) {
            return null;
        }
    }

    private Double lookupDailyTargetHours(UUID employeeId, LocalDate onDate) {
        if (employeeId == null) return null;
        try {
            return jdbc.query("""
                    SELECT sp.working_hours_per_day
                      FROM attendance.employee_shift_assignments esa
                      JOIN attendance.shift_policies sp
                        ON sp.id = esa.shift_policy_id
                       AND sp.tenant_id = esa.tenant_id
                     WHERE esa.tenant_id = ?
                       AND esa.employee_id = ?
                       AND esa.effective_from <= ?
                       AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                       AND sp.is_active = TRUE
                     ORDER BY esa.effective_from DESC
                     LIMIT 1
                    """,
                    rs -> {
                        if (!rs.next()) return null;
                        double v = rs.getDouble("working_hours_per_day");
                        return rs.wasNull() ? null : v;
                    },
                    tenantId(), employeeId, onDate, onDate);
        } catch (Exception ex) {
            return null;
        }
    }

    private ShiftProfile lookupShiftProfile(UUID employeeId, LocalDate onDate) {
        if (employeeId == null) return null;
        try {
            return jdbc.query("""
                    SELECT sp.start_time, sp.grace_period_minutes, sp.working_hours_per_day
                      FROM attendance.employee_shift_assignments esa
                      JOIN attendance.shift_policies sp
                        ON sp.id = esa.shift_policy_id
                       AND sp.tenant_id = esa.tenant_id
                     WHERE esa.tenant_id = ?
                       AND esa.employee_id = ?
                       AND esa.effective_from <= ?
                       AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                       AND sp.is_active = TRUE
                     ORDER BY esa.effective_from DESC
                     LIMIT 1
                    """,
                    rs -> {
                        if (!rs.next()) return null;
                        java.sql.Time start = rs.getTime("start_time");
                        String scheduledStart = start == null
                                ? null
                                : start.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"));
                        int graceRaw = rs.getInt("grace_period_minutes");
                        Integer grace = rs.wasNull() ? null : graceRaw;
                        double hoursRaw = rs.getDouble("working_hours_per_day");
                        Double hours = rs.wasNull() ? null : hoursRaw;
                        return new ShiftProfile(scheduledStart, grace, hours);
                    },
                    tenantId(), employeeId, onDate, onDate);
        } catch (Exception ex) {
            return null;
        }
    }

    private record ShiftProfile(String scheduledStart, Integer graceMinutes, Double dailyTargetHours) {
    }

    @Transactional(readOnly = true)
    public PageResponse<AttendanceRecordResponse> myRecords(int page, int size) {
        EmployeeContext employee = currentEmployee();
        int safePage = Math.max(page, 0);
        int safeSize = Math.max(1, Math.min(size, 100));
        long total = jdbc.queryForObject("""
                SELECT COUNT(*)
                  FROM attendance.records
                 WHERE tenant_id = ? AND employee_id = ?
                """, Long.class, tenantId(), employee.employeeId());
        List<AttendanceRecordResponse> rows = jdbc.query("""
                SELECT id, employee_id, attendance_date, check_in_at, check_out_at,
                       attendance_status, attendance_type, check_in_method, check_out_method,
                       work_hours, check_in_location_name, check_out_location_name,
                       check_in_zone_name, check_out_zone_name, late_by_minutes,
                       overtime_minutes, manual_entry
                  FROM attendance.records
                 WHERE tenant_id = ? AND employee_id = ?
                 ORDER BY attendance_date DESC
                 LIMIT ? OFFSET ?
                """, this::toRecordResponse, tenantId(), employee.employeeId(), safeSize, safePage * safeSize);
        int totalPages = total == 0 ? 0 : (int) Math.ceil((double) total / safeSize);
        return new PageResponse<>(rows, safePage, safeSize, total, totalPages, safePage + 1 >= totalPages);
    }

    @Transactional
    public CorrectionRequestResponse createCorrection(CorrectionRequestRequest request) {
        EmployeeContext employee = currentEmployee();
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.regularization_requests (
                    id, tenant_id, employee_id, record_id, request_date, missing_for_date,
                    requested_check_in, requested_check_out, reason, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', now())
                """,
                id,
                tenantId(),
                employee.employeeId(),
                request.attendanceRecordId(),
                LocalDate.now(IST),
                request.requestedDate(),
                timestamp(request.requestedCheckInAt()),
                timestamp(request.requestedCheckOutAt()),
                request.reason());
        return correctionById(id);
    }

    @Transactional(readOnly = true)
    public PageResponse<CorrectionRequestResponse> myCorrections(int page, int size) {
        EmployeeContext employee = currentEmployee();
        int safePage = Math.max(page, 0);
        int safeSize = Math.max(1, Math.min(size, 100));
        long total = jdbc.queryForObject("""
                SELECT COUNT(*)
                  FROM attendance.regularization_requests
                 WHERE tenant_id = ? AND employee_id = ?
                """, Long.class, tenantId(), employee.employeeId());
        List<CorrectionRequestResponse> rows = jdbc.query("""
                SELECT id, employee_id, record_id, missing_for_date, requested_check_in,
                       requested_check_out, reason, NULL::text AS attachment_url, status,
                       approver_id, decision_note, decision_at, created_at
                  FROM attendance.regularization_requests
                 WHERE tenant_id = ? AND employee_id = ?
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?
                """, this::toCorrectionResponse, tenantId(), employee.employeeId(), safeSize, safePage * safeSize);
        int totalPages = total == 0 ? 0 : (int) Math.ceil((double) total / safeSize);
        return new PageResponse<>(rows, safePage, safeSize, total, totalPages, safePage + 1 >= totalPages);
    }

    @Transactional(readOnly = true)
    public EmployeeResponse me() {
        EmployeeContext employee = currentEmployee();
        return jdbc.queryForObject("""
                SELECT e.id, e.tenant_id, e.employee_code, e.first_name, e.last_name,
                       e.email, e.phone, e.date_of_birth, e.gender, e.company_id,
                       e.department_id, e.branch_id, e.reporting_manager_id,
                       d.title AS job_title, e.employment_type, e.employment_status,
                       e.date_of_joining, b.name AS work_location, e.ctc_annual,
                       e.pan_number, e.aadhaar_number, e.pf_uan, e.esi_number,
                       e.bank_account_number, e.bank_ifsc, e.bank_name,
                       e.is_face_enrolled, e.profile_photo_url, e.created_at
                  FROM hrms.employees e
                  LEFT JOIN hrms.designations d ON d.tenant_id = e.tenant_id AND d.id = e.designation_id
                  LEFT JOIN org.branches b ON b.tenant_id = e.tenant_id AND b.id = e.branch_id
                 WHERE e.tenant_id = ? AND e.id = ?
                """, this::toEmployeeResponse, tenantId(), employee.employeeId());
    }

    private EmployeeContext currentEmployee() {
        UUID tenantId = tenantId();
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No active user");
        }
        try {
            return jdbc.queryForObject("""
                    SELECT uc.employee_id,
                           e.company_id,
                           e.department_id,
                           e.branch_id,
                           trim(e.first_name || ' ' || coalesce(e.last_name, '')) AS full_name,
                           coalesce(d.title, 'Employee') AS job_title,
                           b.name AS branch_name,
                           b.latitude::float8 AS branch_lat,
                           b.longitude::float8 AS branch_lon,
                           coalesce(b.geo_fence_radius_meters, 500) AS radius
                      FROM auth.user_credentials uc
                      JOIN hrms.employees e ON e.tenant_id = uc.tenant_id AND e.id = uc.employee_id
                      LEFT JOIN hrms.designations d ON d.tenant_id = e.tenant_id AND d.id = e.designation_id
                      LEFT JOIN org.branches b ON b.tenant_id = e.tenant_id AND b.id = e.branch_id
                     WHERE uc.tenant_id = ?
                       AND uc.id = ?
                       AND uc.is_active = TRUE
                       AND e.is_active = TRUE
                    """, (rs, rowNum) -> new EmployeeContext(
                            requireUuid(rs, "employee_id"),
                            requireUuid(rs, "company_id"),
                            uuid(rs, "department_id"),
                            uuid(rs, "branch_id"),
                            rs.getString("full_name"),
                            rs.getString("job_title"),
                            rs.getString("branch_name"),
                            doubleOrNull(rs, "branch_lat"),
                            doubleOrNull(rs, "branch_lon"),
                            rs.getInt("radius")), tenantId, userId);
        } catch (EmptyResultDataAccessException ex) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "This login is not linked to an active employee profile.");
        }
    }

    private Optional<AttendanceDto> findToday(UUID employeeId) {
        return findRecord(employeeId, LocalDate.now(IST));
    }

    private Optional<AttendanceDto> findRecord(UUID employeeId, LocalDate date) {
        List<AttendanceDto> rows = jdbc.query("""
                SELECT id, attendance_date, check_in_at, check_out_at,
                       attendance_type, attendance_status, check_in_method, check_out_method,
                       work_hours, face_confidence_score,
                       coalesce(check_out_location_name, check_in_location_name) AS location_name,
                       check_in_zone_name, check_out_zone_name, late_by_minutes,
                       overtime_minutes, manual_entry
                  FROM attendance.records
                 WHERE tenant_id = ? AND employee_id = ? AND attendance_date = ?
                 ORDER BY created_at DESC
                 LIMIT 1
                """, this::toDto, tenantId(), employeeId, date);
        return rows.stream().findFirst();
    }

    private List<AttendanceDto> recordsBetween(UUID employeeId, LocalDate start, LocalDate end) {
        return jdbc.query("""
                SELECT id, attendance_date, check_in_at, check_out_at,
                       attendance_type, attendance_status, check_in_method, check_out_method,
                       work_hours, face_confidence_score,
                       coalesce(check_out_location_name, check_in_location_name) AS location_name,
                       check_in_zone_name, check_out_zone_name, late_by_minutes,
                       overtime_minutes, manual_entry
                  FROM attendance.records
                 WHERE tenant_id = ?
                   AND employee_id = ?
                   AND attendance_date BETWEEN ? AND ?
                 ORDER BY attendance_date ASC
                """, this::toDto, tenantId(), employeeId, start, end);
    }

    private void logEvent(UUID recordId, EmployeeContext employee, String eventType, Instant at,
                          String status, Double latitude, Double longitude,
                          String location, String zoneName, String note) {
        jdbc.update("""
                INSERT INTO attendance.event_logs (
                    id, tenant_id, employee_id, record_id, company_id, department_id, branch_id,
                    event_at, event_date, event_type, attendance_status, latitude, longitude,
                    location_name, zone_name, actor_employee_id, note, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                """,
                UUID.randomUUID(),
                tenantId(),
                employee.employeeId(),
                recordId,
                employee.companyId(),
                employee.departmentId(),
                employee.branchId(),
                Timestamp.from(at),
                LocalDate.ofInstant(at, IST),
                eventType,
                status,
                latitude,
                longitude,
                location,
                zoneName,
                employee.employeeId(),
                note);
    }

    private CorrectionRequestResponse correctionById(UUID id) {
        return jdbc.queryForObject("""
                SELECT id, employee_id, record_id, missing_for_date, requested_check_in,
                       requested_check_out, reason, NULL::text AS attachment_url, status,
                       approver_id, decision_note, decision_at, created_at
                  FROM attendance.regularization_requests
                 WHERE tenant_id = ? AND id = ?
                """, this::toCorrectionResponse, tenantId(), id);
    }

    private int countPendingCorrections(UUID employeeId) {
        Integer count = jdbc.queryForObject("""
                SELECT COUNT(*)::int
                  FROM attendance.regularization_requests
                 WHERE tenant_id = ? AND employee_id = ? AND status = 'PENDING'
                """, Integer.class, tenantId(), employeeId);
        return count == null ? 0 : count;
    }

    private AttendanceDto toDto(ResultSet rs, int rowNum) throws SQLException {
        return new AttendanceDto(
                requireUuid(rs, "id"),
                rs.getDate("attendance_date").toLocalDate().toString(),
                instantString(rs, "check_in_at"),
                instantString(rs, "check_out_at"),
                rs.getString("attendance_type"),
                rs.getString("attendance_status"),
                rs.getString("check_in_method"),
                rs.getString("check_out_method"),
                doubleOrNull(rs, "work_hours"),
                doubleOrNull(rs, "face_confidence_score"),
                rs.getString("location_name"),
                rs.getString("check_in_zone_name"),
                rs.getString("check_out_zone_name"),
                intOrNull(rs, "late_by_minutes"),
                intOrNull(rs, "overtime_minutes"),
                rs.getBoolean("manual_entry"));
    }

    private AttendanceRecordResponse toRecordResponse(ResultSet rs, int rowNum) throws SQLException {
        return new AttendanceRecordResponse(
                requireUuid(rs, "id"),
                requireUuid(rs, "employee_id"),
                rs.getDate("attendance_date").toLocalDate(),
                instant(rs, "check_in_at"),
                instant(rs, "check_out_at"),
                rs.getString("attendance_status"),
                rs.getString("attendance_type"),
                rs.getString("check_in_method"),
                rs.getString("check_out_method"),
                doubleOrNull(rs, "work_hours"),
                false,
                firstNonBlank(rs.getString("check_out_location_name"), rs.getString("check_in_location_name")),
                rs.getString("check_in_zone_name"),
                rs.getString("check_out_zone_name"),
                intOrNull(rs, "late_by_minutes"),
                intOrNull(rs, "overtime_minutes"),
                rs.getBoolean("manual_entry"));
    }

    private CorrectionRequestResponse toCorrectionResponse(ResultSet rs, int rowNum) throws SQLException {
        return new CorrectionRequestResponse(
                requireUuid(rs, "id"),
                requireUuid(rs, "employee_id"),
                uuid(rs, "record_id"),
                rs.getDate("missing_for_date").toLocalDate(),
                instant(rs, "requested_check_in"),
                instant(rs, "requested_check_out"),
                rs.getString("reason"),
                rs.getString("attachment_url"),
                rs.getString("status"),
                uuid(rs, "approver_id"),
                rs.getString("decision_note"),
                instant(rs, "decision_at"),
                instant(rs, "created_at"));
    }

    private EmployeeResponse toEmployeeResponse(ResultSet rs, int rowNum) throws SQLException {
        Double ctc = doubleOrNull(rs, "ctc_annual");
        return new EmployeeResponse(
                requireUuid(rs, "id"),
                requireUuid(rs, "tenant_id"),
                rs.getString("employee_code"),
                rs.getString("first_name"),
                rs.getString("last_name"),
                rs.getString("email"),
                rs.getString("phone"),
                rs.getDate("date_of_birth") != null ? rs.getDate("date_of_birth").toLocalDate() : null,
                rs.getString("gender"),
                requireUuid(rs, "company_id"),
                uuid(rs, "department_id"),
                uuid(rs, "branch_id"),
                uuid(rs, "reporting_manager_id"),
                rs.getString("job_title"),
                rs.getString("employment_type"),
                rs.getString("employment_status"),
                rs.getDate("date_of_joining") != null ? rs.getDate("date_of_joining").toLocalDate() : null,
                rs.getString("work_location"),
                "MONTHLY",
                ctc == null ? null : round2(ctc / 12.0),
                rs.getString("pan_number"),
                rs.getString("aadhaar_number"),
                rs.getString("pf_uan"),
                rs.getString("esi_number"),
                rs.getString("bank_account_number"),
                rs.getString("bank_ifsc"),
                rs.getString("bank_name"),
                null,
                rs.getBoolean("is_face_enrolled"),
                rs.getString("profile_photo_url"),
                instant(rs, "created_at"));
    }

    private UUID tenantId() {
        return TenantContext.requireTenantId();
    }

    private String attendanceStatus(Instant checkInAt) {
        return checkInAt.atZone(IST).toLocalTime().isAfter(LATE_THRESHOLD) ? "LATE" : "PRESENT";
    }

    private Integer lateByMinutes(Instant checkInAt) {
        LocalTime local = checkInAt.atZone(IST).toLocalTime();
        return local.isAfter(LATE_THRESHOLD) ? (int) Duration.between(LATE_THRESHOLD, local).toMinutes() : 0;
    }

    private String checkMethod(String raw) {
        if (raw == null || raw.isBlank()) {
            return "MANUAL";
        }
        return switch (raw.toUpperCase()) {
            case "FACE", "FACE_RECOGNITION" -> "FACE_RECOGNITION";
            case "GPS", "MOBILE_GPS", "GEO_FENCE" -> "MOBILE_GPS";
            case "BIOMETRIC", "BIOMETRIC_DEVICE", "BIOMETRIC_FINGERPRINT" -> "BIOMETRIC_FINGERPRINT";
            case "KIOSK" -> "KIOSK";
            case "API" -> "API";
            default -> "MANUAL";
        };
    }

    private static boolean isWeekend(LocalDate date) {
        return date.getDayOfWeek() == DayOfWeek.SATURDAY || date.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    private static String firstNonBlank(String... values) {
        if (values == null) return null;
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return null;
    }

    private static Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }

    private static String instantString(ResultSet rs, String column) throws SQLException {
        Instant instant = instant(rs, column);
        return instant == null ? null : instant.toString();
    }

    private static UUID uuid(ResultSet rs, String column) throws SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : (UUID) value;
    }

    private static UUID requireUuid(ResultSet rs, String column) throws SQLException {
        UUID value = uuid(rs, column);
        if (value == null) {
            throw new SQLException("Required UUID column was null: " + column);
        }
        return value;
    }

    private static Double doubleOrNull(ResultSet rs, String column) throws SQLException {
        double value = rs.getDouble(column);
        return rs.wasNull() ? null : value;
    }

    private static Integer intOrNull(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double radius = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return radius * c;
    }

    private record EmployeeContext(
            UUID employeeId,
            UUID companyId,
            UUID departmentId,
            UUID branchId,
            String fullName,
            String jobTitle,
            String branchName,
            Double branchLat,
            Double branchLon,
            int geoFenceRadiusMeters
    ) {
    }
}
