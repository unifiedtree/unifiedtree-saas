package com.hrms.attendance.service;

import com.hrms.attendance.client.FaceRecognitionClient;
import com.hrms.attendance.dto.AttendanceCheckinEvent;
import com.hrms.attendance.dto.AttendanceDto;
import com.hrms.attendance.dto.AttendanceRecordResponse;
import com.hrms.attendance.dto.CheckOutSummaryResponse;
import com.hrms.attendance.dto.CheckOutRequest;
import com.hrms.attendance.dto.CorrectionDecisionRequest;
import com.hrms.attendance.dto.CorrectionRequestRequest;
import com.hrms.attendance.dto.CorrectionRequestResponse;
import com.hrms.attendance.dto.DayRecordResponse;
import com.hrms.attendance.dto.FaceCheckInRequest;
import com.hrms.attendance.dto.FaceCheckInResponse;
import com.hrms.attendance.dto.FaceRecognitionResult;
import com.hrms.attendance.dto.GeoFenceZoneRequest;
import com.hrms.attendance.dto.GeoFenceZoneResponse;
import com.hrms.attendance.dto.ManualAttendanceRequest;
import com.hrms.attendance.dto.MonthlyStatsResponse;
import com.hrms.attendance.dto.WeeklyDayResponse;
import com.hrms.attendance.dto.WeeklySummaryResponse;
import com.hrms.attendance.entity.AttendanceCorrectionRequest;
import com.hrms.attendance.entity.AttendanceEventLog;
import com.hrms.attendance.entity.AttendanceRecord;
import com.hrms.attendance.entity.GeoFenceZone;
import com.hrms.attendance.enums.AttendanceEventType;
import com.hrms.attendance.enums.AttendanceStatus;
import com.hrms.attendance.enums.AttendanceType;
import com.hrms.attendance.enums.CheckInMethod;
import com.hrms.attendance.mapper.AttendanceMapper;
import com.hrms.attendance.entity.EmployeeShiftAssignment;
import com.hrms.attendance.entity.ShiftPolicy;
import com.hrms.attendance.repository.AttendanceCorrectionRequestRepository;
import com.hrms.attendance.repository.AttendanceEventLogRepository;
import com.hrms.attendance.repository.AttendanceRecordRepository;
import com.hrms.attendance.repository.GeoFenceZoneRepository;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class AttendanceService {

    private static final Logger log = LoggerFactory.getLogger(AttendanceService.class);
    private static final String CHECKIN_TOPIC = "attendance.checkin.v1";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final LocalTime LATE_THRESHOLD = LocalTime.of(9, 30);
    private static final double STANDARD_HOURS = 8.0;

    private final AttendanceRecordRepository attendanceRecordRepository;
    private final AttendanceEventLogRepository attendanceEventLogRepository;
    private final AttendanceCorrectionRequestRepository correctionRequestRepository;
    private final GeoFenceZoneRepository geoFenceZoneRepository;
    private final FaceRecognitionClient faceRecognitionClient;
    private final GeoValidationService geoValidationService;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final AttendanceMapper attendanceMapper;
    private final double confidenceThreshold;
    private final boolean faceRecognitionEnabled;
    private final boolean kafkaEnabled;

    @Autowired(required = false)
    private JdbcTemplate jdbcTemplate;

    public AttendanceService(
            AttendanceRecordRepository attendanceRecordRepository,
            AttendanceEventLogRepository attendanceEventLogRepository,
            AttendanceCorrectionRequestRepository correctionRequestRepository,
            GeoFenceZoneRepository geoFenceZoneRepository,
            FaceRecognitionClient faceRecognitionClient,
            GeoValidationService geoValidationService,
            KafkaTemplate<String, Object> kafkaTemplate,
            AttendanceMapper attendanceMapper,
            @Value("${hrms.face-recognition.confidence-threshold:0.92}") double confidenceThreshold,
            @Value("${hrms.face-recognition.enabled:true}") boolean faceRecognitionEnabled,
            @Value("${hrms.kafka.enabled:false}") boolean kafkaEnabled) {
        this.kafkaEnabled = kafkaEnabled;
        this.attendanceRecordRepository = attendanceRecordRepository;
        this.attendanceEventLogRepository = attendanceEventLogRepository;
        this.correctionRequestRepository = correctionRequestRepository;
        this.geoFenceZoneRepository = geoFenceZoneRepository;
        this.faceRecognitionClient = faceRecognitionClient;
        this.geoValidationService = geoValidationService;
        this.kafkaTemplate = kafkaTemplate;
        this.attendanceMapper = attendanceMapper;
        this.confidenceThreshold = confidenceThreshold;
        this.faceRecognitionEnabled = faceRecognitionEnabled;
    }

    // ── New JSON check-in (frontend-facing) ─────────────────────────────────

    @Transactional
    public AttendanceDto checkInJson(UUID employeeId, UUID companyId, UUID branchId, UUID departmentId,
                                     double latitude, double longitude,
                                     String faceBase64, String checkInMethodStr, UUID tenantId) {
        return checkInJson(employeeId, companyId, branchId, departmentId, latitude, longitude,
                faceBase64, checkInMethodStr, tenantId, null, null, null, null);
    }

    @Transactional
    public AttendanceDto checkInJson(UUID employeeId, UUID companyId, UUID branchId, UUID departmentId,
                                     double latitude, double longitude,
                                     String faceBase64, String checkInMethodStr, UUID tenantId,
                                     String locationName, String zoneName,
                                     String deviceId, String clientEventId) {
        if (clientEventId != null && !clientEventId.isBlank()) {
            Optional<AttendanceRecord> syncedRecord = attendanceRecordRepository.findByClientEventId(clientEventId);
            if (syncedRecord.isPresent()) {
                return toDto(syncedRecord.get());
            }
        }

        LocalDate today = LocalDate.now(IST);
        attendanceRecordRepository.findByEmployeeIdAndAttendanceDate(employeeId, today)
                .filter(r -> r.getCheckInAt() != null)
                .ifPresent(r -> {
                    throw new BusinessRuleException("Already checked in today", "ALREADY_CHECKED_IN");
                });

        CheckInMethod method = parseMethod(checkInMethodStr);

        AttendanceRecord record = new AttendanceRecord();
        record.setTenantId(tenantId);
        record.setEmployeeId(employeeId);
        record.setCompanyId(companyId);
        record.setDepartmentId(departmentId);
        record.setBranchId(branchId);
        record.setAttendanceDate(today);
        record.setCheckInAt(Instant.now());
        record.setAttendanceType(AttendanceType.OFFICE);
        record.setAttendanceStatus(resolveStatus(record.getCheckInAt()));
        record.setCheckInMethod(method);
        record.setCheckInLatitude(latitude);
        record.setCheckInLongitude(longitude);
        record.setLocationName(locationName);
        record.setCheckInZoneName(zoneName);
        record.setDeviceId(deviceId);
        record.setClientEventId(clientEventId);
        record.setLateByMinutes(calculateLateMinutes(record.getCheckInAt()));

        if (faceRecognitionEnabled && method == CheckInMethod.FACE_RECOGNITION
                && faceBase64 != null && !faceBase64.isBlank()) {
            byte[] faceBytes = Base64.getDecoder().decode(faceBase64);
            FaceRecognitionResult result = faceRecognitionClient.matchFace(employeeId, faceBytes);
            log.info("Face recognition: employee={}, matched={}, score={}", employeeId, result.matched(), result.confidenceScore());
            if (!result.matched() || result.confidenceScore() < confidenceThreshold) {
                throw new BusinessRuleException("Face not recognized", "FACE_MISMATCH");
            }
            record.setFaceConfidenceScore(result.confidenceScore());
        }

        AttendanceRecord saved = attendanceRecordRepository.save(record);
        logEvent(saved, AttendanceEventType.CHECK_IN, latitude, longitude, locationName, zoneName, employeeId, null);
        log.info("Check-in recorded: id={}, employee={}, method={}", saved.getId(), employeeId, method);

        publishCheckinEvent(saved, tenantId, method);
        return toDto(saved);
    }

    // ── New checkout (frontend-facing, employeeId from JWT) ─────────────────

    @Transactional
    public AttendanceDto checkOut(UUID employeeId) {
        return checkOut(employeeId, null, null, null, null, null, null);
    }

    @Transactional
    public AttendanceDto checkOut(UUID employeeId,
                                  Double latitude,
                                  Double longitude,
                                  String checkOutMethod,
                                  String locationName,
                                  String zoneName,
                                  String deviceId) {
        LocalDate today = LocalDate.now(IST);
        AttendanceRecord record = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(employeeId, today)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No attendance record for employee " + employeeId + " on " + today));

        if (record.getCheckOutAt() != null) {
            return toDto(record);
        }

        Instant checkOutAt = Instant.now();
        record.setCheckOutAt(checkOutAt);
        record.setCheckOutLatitude(latitude);
        record.setCheckOutLongitude(longitude);
        record.setCheckOutMethod(parseMethod(checkOutMethod));
        if (locationName != null && !locationName.isBlank()) {
            record.setLocationName(locationName);
        }
        record.setCheckOutZoneName(zoneName);
        if (deviceId != null && !deviceId.isBlank()) {
            record.setDeviceId(deviceId);
        }
        if (record.getCheckInAt() != null) {
            double hours = Duration.between(record.getCheckInAt(), checkOutAt).toMinutes() / 60.0;
            record.setWorkingHours(Math.round(hours * 100.0) / 100.0);
            record.setOvertimeMinutes(calculateOvertimeMinutes(record.getWorkingHours()));
        }

        AttendanceRecord saved = attendanceRecordRepository.save(record);
        logEvent(saved, AttendanceEventType.CHECK_OUT, latitude, longitude,
                locationName, zoneName, employeeId, null);
        log.info("Check-out recorded: employee={}, workingHours={}", employeeId, saved.getWorkingHours());
        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public CheckOutSummaryResponse getCheckOutSummary(UUID employeeId) {
        AttendanceRecord record = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(employeeId, LocalDate.now(IST))
                .filter(r -> r.getCheckInAt() != null && r.getCheckOutAt() == null)
                .orElseThrow(() -> new ResourceNotFoundException("No active attendance session for employee " + employeeId));

        long minutes = Duration.between(record.getCheckInAt(), Instant.now()).toMinutes();
        return new CheckOutSummaryResponse(
                record.getId(),
                record.getCheckInAt(),
                Math.round((minutes / 60.0) * 100.0) / 100.0,
                minutes,
                record.getLocationName(),
                minutes < 1);
    }

    // ── Today's record ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Optional<AttendanceDto> getTodayRecord(UUID employeeId) {
        return attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(employeeId, LocalDate.now(IST))
                .map(this::toDto);
    }

    // ── Monthly stats ────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public MonthlyStatsResponse getMonthlyStats(UUID employeeId, int year, int month) {
        LocalDate start = LocalDate.of(year, month, 1);
        LocalDate end = start.withDayOfMonth(start.lengthOfMonth());
        LocalDate today = LocalDate.now(IST);

        List<AttendanceRecord> records = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDateBetween(employeeId, start, end);
        Map<LocalDate, AttendanceRecord> byDate = records.stream()
                .collect(Collectors.toMap(AttendanceRecord::getAttendanceDate, r -> r));

        int presentDays = 0, absentDays = 0, onTimeDays = 0, lateDays = 0;

        LocalDate cursor = start;
        while (!cursor.isAfter(end) && !cursor.isAfter(today)) {
            DayOfWeek dow = cursor.getDayOfWeek();
            if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) {
                cursor = cursor.plusDays(1);
                continue;
            }
            AttendanceRecord rec = byDate.get(cursor);
            if (rec != null && rec.getCheckInAt() != null) {
                presentDays++;
                LocalTime checkInLocal = rec.getCheckInAt().atZone(IST).toLocalTime();
                if (checkInLocal.isAfter(LATE_THRESHOLD)) lateDays++;
                else onTimeDays++;
            } else {
                absentDays++;
            }
            cursor = cursor.plusDays(1);
        }

        int workingDays = presentDays + absentDays;
        int score = workingDays > 0 ? Math.round((float) presentDays / workingDays * 100) : 100;

        return new MonthlyStatsResponse(presentDays, absentDays, 0, onTimeDays, lateDays, score);
    }

    // ── Month history (calendar) ─────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<DayRecordResponse> getMonthHistory(UUID employeeId, int year, int month) {
        LocalDate start = LocalDate.of(year, month, 1);
        LocalDate end = start.withDayOfMonth(start.lengthOfMonth());
        LocalDate today = LocalDate.now(IST);

        List<AttendanceRecord> records = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDateBetween(employeeId, start, end);
        Map<LocalDate, AttendanceRecord> byDate = records.stream()
                .collect(Collectors.toMap(AttendanceRecord::getAttendanceDate, r -> r));

        List<DayRecordResponse> result = new ArrayList<>();
        LocalDate cursor = start;

        while (!cursor.isAfter(end)) {
            DayOfWeek dow = cursor.getDayOfWeek();
            if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) {
                result.add(new DayRecordResponse(cursor.toString(), "WEEKEND", null, null, null));
            } else {
                AttendanceRecord rec = byDate.get(cursor);
                if (rec != null && rec.getCheckInAt() != null) {
                    LocalTime checkInLocal = rec.getCheckInAt().atZone(IST).toLocalTime();
                    String status = checkInLocal.isAfter(LATE_THRESHOLD) ? "LATE" : "PRESENT";
                    result.add(new DayRecordResponse(
                            cursor.toString(), status,
                            rec.getCheckInAt().toString(),
                            rec.getCheckOutAt() != null ? rec.getCheckOutAt().toString() : null,
                            rec.getWorkingHours()));
                } else if (!cursor.isAfter(today)) {
                    result.add(new DayRecordResponse(cursor.toString(), "ABSENT", null, null, null));
                }
                // future working days: omit (frontend handles missing dates as no-dot)
            }
            cursor = cursor.plusDays(1);
        }
        return result;
    }

    // ── Weekly summary ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public WeeklySummaryResponse getWeeklySummary(UUID employeeId) {
        return getWeeklySummary(employeeId, null);
    }

    @Transactional(readOnly = true)
    public WeeklySummaryResponse getWeeklySummary(UUID employeeId, LocalDate weekStart) {
        LocalDate today = LocalDate.now(IST);
        LocalDate monday = weekStart != null
                ? weekStart.with(DayOfWeek.MONDAY)
                : today.with(DayOfWeek.MONDAY);
        LocalDate sunday = monday.plusDays(6);

        List<AttendanceRecord> records = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDateBetween(employeeId, monday, sunday);
        Map<LocalDate, AttendanceRecord> byDate = records.stream()
                .collect(Collectors.toMap(AttendanceRecord::getAttendanceDate, r -> r));

        List<WeeklyDayResponse> days = new ArrayList<>();
        double totalHours = 0, overtime = 0, totalArrivalMinutes = 0;
        int presentDays = 0, arrivalCount = 0;

        for (int i = 0; i < 7; i++) {
            LocalDate day = monday.plusDays(i);
            DayOfWeek dow = day.getDayOfWeek();

            if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) {
                AttendanceRecord rec = byDate.get(day);
                double h = rec != null && rec.getWorkingHours() != null ? rec.getWorkingHours() : 0;
                String checkIn = rec != null ? formatIstHourMinute(rec.getCheckInAt()) : null;
                String checkOut = rec != null ? formatIstHourMinute(rec.getCheckOutAt()) : null;
                Integer lateBy = rec != null ? rec.getLateByMinutes() : null;
                days.add(new WeeklyDayResponse(day.toString(), h, "WEEKEND",
                        checkIn, checkOut, lateBy));
                continue;
            }
            if (day.isAfter(today)) {
                days.add(new WeeklyDayResponse(day.toString(), 0, "ABSENT", null, null, null));
                continue;
            }

            AttendanceRecord rec = byDate.get(day);
            if (rec != null && rec.getCheckInAt() != null) {
                double h = rec.getWorkingHours() != null ? rec.getWorkingHours() : 0;
                LocalTime checkInLocal = rec.getCheckInAt().atZone(IST).toLocalTime();
                String status = checkInLocal.isAfter(LATE_THRESHOLD) ? "LATE" : "ON_TIME";
                totalHours += h;
                overtime += Math.max(0, h - STANDARD_HOURS);
                presentDays++;
                totalArrivalMinutes += checkInLocal.getHour() * 60.0 + checkInLocal.getMinute();
                arrivalCount++;
                days.add(new WeeklyDayResponse(
                        day.toString(),
                        h,
                        status,
                        formatIstHourMinute(rec.getCheckInAt()),
                        formatIstHourMinute(rec.getCheckOutAt()),
                        rec.getLateByMinutes()));
            } else {
                days.add(new WeeklyDayResponse(day.toString(), 0, "ABSENT", null, null, null));
            }
        }

        String avgArrival = null;
        if (arrivalCount > 0) {
            int avgMin = (int) (totalArrivalMinutes / arrivalCount);
            int h = avgMin / 60;
            int m = avgMin % 60;
            avgArrival = h < 12
                    ? "%02d:%02d AM".formatted(h == 0 ? 12 : h, m)
                    : "%02d:%02d PM".formatted(h == 12 ? 12 : h - 12, m);
        }

        Double dailyTargetHours = lookupDailyTargetHours(employeeId, monday);

        return new WeeklySummaryResponse(
                Math.round(totalHours * 100.0) / 100.0,
                Math.round(overtime * 100.0) / 100.0,
                presentDays,
                avgArrival,
                dailyTargetHours,
                days);
    }

    private String formatIstHourMinute(Instant instant) {
        if (instant == null) {
            return null;
        }
        return instant.atZone(IST).toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm"));
    }

    public record ShiftProfile(String scheduledStart, Integer graceMinutes, Double dailyTargetHours) {
    }

    @Transactional(readOnly = true)
    public ShiftProfile getShiftProfile(UUID employeeId, LocalDate onDate) {
        if (jdbcTemplate == null || employeeId == null) {
            return null;
        }
        try {
            return jdbcTemplate.query("""
                    SELECT sp.start_time, sp.grace_period_minutes, sp.working_hours_per_day
                      FROM attendance.employee_shift_assignments esa
                      JOIN attendance.shift_policies sp
                        ON sp.id = esa.shift_policy_id
                     WHERE esa.employee_id = ?
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
                    employeeId, onDate, onDate);
        } catch (Exception ex) {
            log.debug("Shift profile lookup failed for employee {}: {}", employeeId, ex.getMessage());
            return null;
        }
    }

    private Double lookupDailyTargetHours(UUID employeeId, LocalDate onDate) {
        if (jdbcTemplate == null || employeeId == null) {
            return null;
        }
        try {
            return jdbcTemplate.query("""
                    SELECT sp.working_hours_per_day
                      FROM attendance.employee_shift_assignments esa
                      JOIN attendance.shift_policies sp
                        ON sp.id = esa.shift_policy_id
                     WHERE esa.employee_id = ?
                       AND esa.effective_from <= ?
                       AND (esa.effective_to IS NULL OR esa.effective_to >= ?)
                       AND sp.is_active = TRUE
                     ORDER BY esa.effective_from DESC
                     LIMIT 1
                    """,
                    rs -> {
                        if (!rs.next()) return null;
                        double value = rs.getDouble("working_hours_per_day");
                        return rs.wasNull() ? null : value;
                    },
                    employeeId, onDate, onDate);
        } catch (Exception ex) {
            log.debug("Daily target hours lookup failed for employee {}: {}", employeeId, ex.getMessage());
            return null;
        }
    }

    // ── Legacy methods (kept for backward compat) ────────────────────────────

    @Transactional
    public FaceCheckInResponse processFaceCheckIn(FaceCheckInRequest request, byte[] faceFrame, UUID tenantId) {
        LocalDate today = LocalDate.now(IST);
        Optional<AttendanceRecord> existing = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(request.employeeId(), today);

        if (existing.isPresent() && existing.get().getCheckInAt() != null) {
            log.warn("Duplicate check-in attempt: employee={}, date={}", request.employeeId(), today);
            throw new BusinessRuleException(
                    "Employee " + request.employeeId() + " has already checked in today (" + today + ")");
        }

        FaceRecognitionResult result = faceRecognitionClient.matchFace(request.employeeId(), faceFrame);
        log.info("Face recognition result: employee={}, matched={}, score={}",
                request.employeeId(), result.matched(), result.confidenceScore());

        if (result.matched() && result.confidenceScore() >= confidenceThreshold) {
            Instant checkInAt = Instant.now();
            AttendanceRecord record = new AttendanceRecord();
            record.setTenantId(tenantId);
            record.setEmployeeId(request.employeeId());
            record.setAttendanceDate(today);
            record.setCheckInAt(checkInAt);
            record.setAttendanceType(AttendanceType.OFFICE);
            record.setAttendanceStatus(resolveStatus(checkInAt));
            record.setCheckInMethod(CheckInMethod.FACE_RECOGNITION);
            record.setCheckInLatitude(request.latitude());
            record.setCheckInLongitude(request.longitude());
            record.setBranchId(request.branchId());
            record.setFaceConfidenceScore(result.confidenceScore());
            record.setLateByMinutes(calculateLateMinutes(checkInAt));
            AttendanceRecord saved = attendanceRecordRepository.save(record);
            logEvent(saved, AttendanceEventType.CHECK_IN, request.latitude(), request.longitude(),
                    null, null, request.employeeId(), null);
            publishCheckinEvent(saved, tenantId, CheckInMethod.FACE_RECOGNITION);
            return new FaceCheckInResponse(true, saved.getId(), checkInAt, "Check-in successful", result.confidenceScore());
        }

        return new FaceCheckInResponse(false, null, null,
                "Face not recognized — please try again or use PIN fallback", result.confidenceScore());
    }

    @Transactional
    public AttendanceRecordResponse processCheckOut(CheckOutRequest request) {
        LocalDate today = LocalDate.now(IST);
        AttendanceRecord record = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(request.employeeId(), today)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No attendance record found for employee " + request.employeeId() + " on " + today));
        Instant checkOutAt = Instant.now();
        record.setCheckOutAt(checkOutAt);
        record.setCheckOutLatitude(request.latitude());
        record.setCheckOutLongitude(request.longitude());
        if (record.getCheckInAt() != null) {
            double hours = Duration.between(record.getCheckInAt(), checkOutAt).toMinutes() / 60.0;
            record.setWorkingHours(Math.round(hours * 100.0) / 100.0);
            record.setOvertimeMinutes(calculateOvertimeMinutes(record.getWorkingHours()));
        }
        AttendanceRecord saved = attendanceRecordRepository.save(record);
        logEvent(saved, AttendanceEventType.CHECK_OUT, request.latitude(), request.longitude(),
                request.locationName(), request.zoneName(), request.employeeId(), null);
        return attendanceMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<AttendanceRecordResponse> getEmployeeAttendance(UUID employeeId, Pageable pageable) {
        Page<AttendanceRecord> page = attendanceRecordRepository.findByEmployeeId(employeeId, pageable);
        return PageResponse.of(page.map(attendanceMapper::toResponse));
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecordResponse> getDepartmentAttendanceToday(UUID departmentId) {
        LocalDate today = LocalDate.now(IST);
        return attendanceRecordRepository
                .findByDepartmentIdAndAttendanceDateBetween(departmentId, today, today)
                .stream().map(attendanceMapper::toResponse).toList();
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<AttendanceRecord> getRecordsForEmployeesOnDate(List<UUID> employeeIds, LocalDate date) {
        if (employeeIds == null || employeeIds.isEmpty()) {
            return List.of();
        }
        return attendanceRecordRepository.findByEmployeeIdInAndAttendanceDate(employeeIds, date);
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecord> getRecordsForEmployeesBetween(List<UUID> employeeIds, LocalDate from, LocalDate to) {
        if (employeeIds == null || employeeIds.isEmpty()) {
            return List.of();
        }
        return attendanceRecordRepository.findByEmployeeIdInAndAttendanceDateBetween(employeeIds, from, to);
    }

    @Transactional(readOnly = true)
    public List<AttendanceEventLog> getEventLogsForEmployees(List<UUID> employeeIds, LocalDate date) {
        if (employeeIds == null || employeeIds.isEmpty()) {
            return List.of();
        }
        return attendanceEventLogRepository.findByEmployeeIdInAndEventDateOrderByEventAtAsc(employeeIds, date);
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecord> getActiveSessions(List<UUID> employeeIds, LocalDate date) {
        if (employeeIds == null || employeeIds.isEmpty()) {
            return List.of();
        }
        return attendanceRecordRepository.findActiveSessions(employeeIds, date);
    }

    @Transactional
    public AttendanceDto manualEntry(ManualAttendanceRequest request,
                                     UUID actorEmployeeId,
                                     UUID tenantId,
                                     UUID companyId,
                                     UUID departmentId,
                                     UUID branchId) {
        if (request.checkInAt() == null && request.checkOutAt() == null) {
            throw new BusinessRuleException("Manual entry needs at least check-in or check-out time", "MANUAL_TIME_REQUIRED");
        }

        AttendanceRecord record = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(request.employeeId(), request.attendanceDate())
                .orElseGet(AttendanceRecord::new);

        if (record.getId() == null) {
            record.setTenantId(tenantId);
            record.setEmployeeId(request.employeeId());
            record.setCompanyId(companyId);
            record.setDepartmentId(departmentId);
            record.setBranchId(branchId);
            record.setAttendanceDate(request.attendanceDate());
        }

        if (request.checkInAt() != null) {
            record.setCheckInAt(request.checkInAt());
            record.setCheckInLatitude(request.latitude());
            record.setCheckInLongitude(request.longitude());
            record.setLateByMinutes(calculateLateMinutes(request.checkInAt()));
        }
        if (request.checkOutAt() != null) {
            record.setCheckOutAt(request.checkOutAt());
            record.setCheckOutLatitude(request.latitude());
            record.setCheckOutLongitude(request.longitude());
        }

        record.setAttendanceType(parseAttendanceType(request.attendanceType()));
        record.setAttendanceStatus(parseAttendanceStatus(request.attendanceStatus(), record.getCheckInAt()));
        record.setCheckInMethod(CheckInMethod.MANAGER_OVERRIDE);
        record.setManualEntry(true);
        record.setRegularized(true);
        record.setRegularizationReason(request.reason());
        record.setManagedByEmployeeId(actorEmployeeId);
        record.setManagerNote(request.reason());
        record.setLocationName(request.locationName());
        recomputeWorkingHours(record);

        AttendanceRecord saved = attendanceRecordRepository.save(record);
        logEvent(saved, AttendanceEventType.MANUAL_ENTRY, request.latitude(), request.longitude(),
                request.locationName(), null, actorEmployeeId, request.reason());
        return toDto(saved);
    }

    @Transactional
    public CorrectionRequestResponse createCorrectionRequest(UUID employeeId,
                                                            UUID companyId,
                                                            UUID departmentId,
                                                            CorrectionRequestRequest request) {
        AttendanceCorrectionRequest correction = new AttendanceCorrectionRequest();
        correction.setTenantId(TenantContext.getTenantId());
        correction.setEmployeeId(employeeId);
        correction.setCompanyId(companyId);
        correction.setDepartmentId(departmentId);
        correction.setAttendanceRecordId(request.attendanceRecordId());
        correction.setRequestedDate(request.requestedDate());
        correction.setRequestedCheckInAt(request.requestedCheckInAt());
        correction.setRequestedCheckOutAt(request.requestedCheckOutAt());
        correction.setReason(request.reason());
        correction.setAttachmentUrl(request.attachmentUrl());
        correction.setStatus(ApprovalStatus.PENDING);
        correction = correctionRequestRepository.save(correction);

        AttendanceRecord linked = request.attendanceRecordId() == null
                ? null
                : attendanceRecordRepository.findById(request.attendanceRecordId()).orElse(null);
        if (linked != null) {
            logEvent(linked, AttendanceEventType.CORRECTION_REQUESTED, null, null,
                    linked.getLocationName(), null, employeeId, request.reason());
        }
        return toCorrectionResponse(correction);
    }

    @Transactional(readOnly = true)
    public PageResponse<CorrectionRequestResponse> getMyCorrectionRequests(UUID employeeId, Pageable pageable) {
        Page<AttendanceCorrectionRequest> page = correctionRequestRepository.findByEmployeeId(employeeId, pageable);
        return PageResponse.from(page, this::toCorrectionResponse);
    }

    @Transactional(readOnly = true)
    public PageResponse<CorrectionRequestResponse> getCorrectionRequestsForEmployees(List<UUID> employeeIds,
                                                                                     ApprovalStatus status,
                                                                                     Pageable pageable) {
        Page<AttendanceCorrectionRequest> page = status == null
                ? correctionRequestRepository.findByEmployeeIdIn(employeeIds, pageable)
                : correctionRequestRepository.findByEmployeeIdInAndStatus(employeeIds, status, pageable);
        return PageResponse.from(page, this::toCorrectionResponse);
    }

    @Transactional
    public CorrectionRequestResponse decideCorrection(UUID correctionId,
                                                      UUID approverEmployeeId,
                                                      CorrectionDecisionRequest decision) {
        if (decision.status() != ApprovalStatus.APPROVED && decision.status() != ApprovalStatus.REJECTED) {
            throw new BusinessRuleException("Correction status must be APPROVED or REJECTED", "INVALID_CORRECTION_STATUS");
        }

        AttendanceCorrectionRequest correction = correctionRequestRepository.findById(correctionId)
                .orElseThrow(() -> new ResourceNotFoundException("Attendance correction", correctionId));

        if (correction.getStatus() != ApprovalStatus.PENDING) {
            throw new BusinessRuleException("Correction request is not pending", "CORRECTION_NOT_PENDING");
        }

        correction.setStatus(decision.status());
        correction.setApproverId(approverEmployeeId);
        correction.setApproverComment(decision.comment());
        correction.setDecidedAt(Instant.now());

        if (decision.status() == ApprovalStatus.APPROVED) {
            applyApprovedCorrection(correction, approverEmployeeId, decision.comment());
        }

        return toCorrectionResponse(correctionRequestRepository.save(correction));
    }

    @Transactional(readOnly = true)
    public List<GeoFenceZoneResponse> listGeoFenceZones(UUID companyId) {
        return geoFenceZoneRepository.findByCompanyIdAndActiveTrue(companyId)
                .stream()
                .map(this::toZoneResponse)
                .toList();
    }

    @Transactional
    public GeoFenceZoneResponse saveGeoFenceZone(UUID zoneId, UUID tenantId, UUID defaultCompanyId,
                                                 GeoFenceZoneRequest request) {
        GeoFenceZone zone = zoneId == null
                ? new GeoFenceZone()
                : geoFenceZoneRepository.findById(zoneId)
                .orElseThrow(() -> new ResourceNotFoundException("Geo fence zone", zoneId));
        if (zoneId == null) {
            zone.setTenantId(tenantId);
        }
        zone.setCompanyId(request.companyId() != null ? request.companyId() : defaultCompanyId);
        zone.setBranchId(request.branchId());
        zone.setDepartmentId(request.departmentId());
        zone.setName(request.name());
        zone.setLatitude(request.latitude());
        zone.setLongitude(request.longitude());
        zone.setRadiusMeters(request.radiusMeters());
        zone.setPunchMethod(parseMethod(request.punchMethod()));
        zone.setColorHex(request.colorHex());
        zone.setIconKey(request.iconKey());
        if (request.active() != null) {
            zone.setActive(request.active());
        }
        return toZoneResponse(geoFenceZoneRepository.save(zone));
    }

    @Transactional
    public void deleteGeoFenceZone(UUID zoneId) {
        GeoFenceZone zone = geoFenceZoneRepository.findById(zoneId)
                .orElseThrow(() -> new ResourceNotFoundException("Geo fence zone", zoneId));
        zone.setActive(false);
        geoFenceZoneRepository.save(zone);
    }

    private AttendanceDto toDto(AttendanceRecord r) {
        return new AttendanceDto(
                r.getId(),
                r.getAttendanceDate().toString(),
                r.getCheckInAt() != null ? r.getCheckInAt().toString() : null,
                r.getCheckOutAt() != null ? r.getCheckOutAt().toString() : null,
                r.getAttendanceType() != null ? r.getAttendanceType().name() : null,
                r.getAttendanceStatus() != null ? r.getAttendanceStatus().name() : null,
                r.getCheckInMethod() != null ? r.getCheckInMethod().name() : null,
                r.getCheckOutMethod() != null ? r.getCheckOutMethod().name() : null,
                r.getWorkingHours(),
                r.getFaceConfidenceScore(),
                r.getLocationName(),
                r.getCheckInZoneName(),
                r.getCheckOutZoneName(),
                r.getLateByMinutes(),
                r.getOvertimeMinutes(),
                r.isManualEntry());
    }

    private CheckInMethod parseMethod(String s) {
        if (s == null) return CheckInMethod.MANUAL;
        return switch (s.toUpperCase()) {
            case "FACE", "FACE_RECOGNITION" -> CheckInMethod.FACE_RECOGNITION;
            case "GPS" -> CheckInMethod.GPS;
            case "PIN" -> CheckInMethod.PIN;
            case "MANAGER_OVERRIDE" -> CheckInMethod.MANAGER_OVERRIDE;
            case "BIOMETRIC", "BIOMETRIC_DEVICE" -> CheckInMethod.BIOMETRIC_DEVICE;
            case "MANUAL" -> CheckInMethod.MANUAL;
            default -> CheckInMethod.MANUAL;
        };
    }

    private AttendanceType parseAttendanceType(String value) {
        if (value == null || value.isBlank()) {
            return AttendanceType.OFFICE;
        }
        try {
            return AttendanceType.valueOf(value.toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return AttendanceType.OFFICE;
        }
    }

    private AttendanceStatus parseAttendanceStatus(String value, Instant checkInAt) {
        if (value != null && !value.isBlank()) {
            try {
                return AttendanceStatus.valueOf(value.toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // fall through to computed status
            }
        }
        return checkInAt == null ? AttendanceStatus.NOT_MARKED : resolveStatus(checkInAt);
    }

    private AttendanceStatus resolveStatus(Instant checkInAt) {
        if (checkInAt == null) {
            return AttendanceStatus.NOT_MARKED;
        }
        LocalTime checkInLocal = checkInAt.atZone(IST).toLocalTime();
        return checkInLocal.isAfter(LATE_THRESHOLD) ? AttendanceStatus.LATE : AttendanceStatus.ON_TIME;
    }

    private Integer calculateLateMinutes(Instant checkInAt) {
        if (checkInAt == null) {
            return null;
        }
        LocalTime checkInLocal = checkInAt.atZone(IST).toLocalTime();
        if (!checkInLocal.isAfter(LATE_THRESHOLD)) {
            return 0;
        }
        return (int) Duration.between(LATE_THRESHOLD, checkInLocal).toMinutes();
    }

    private Integer calculateOvertimeMinutes(Double workingHours) {
        if (workingHours == null) {
            return 0;
        }
        return (int) Math.max(0, Math.round((workingHours - STANDARD_HOURS) * 60));
    }

    private void recomputeWorkingHours(AttendanceRecord record) {
        if (record.getCheckInAt() != null && record.getCheckOutAt() != null) {
            double hours = Duration.between(record.getCheckInAt(), record.getCheckOutAt()).toMinutes() / 60.0;
            record.setWorkingHours(Math.round(hours * 100.0) / 100.0);
            record.setOvertimeMinutes(calculateOvertimeMinutes(record.getWorkingHours()));
        }
    }

    private void applyApprovedCorrection(AttendanceCorrectionRequest correction,
                                         UUID approverEmployeeId,
                                         String note) {
        AttendanceRecord record = correction.getAttendanceRecordId() == null
                ? attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(correction.getEmployeeId(), correction.getRequestedDate())
                .orElseGet(AttendanceRecord::new)
                : attendanceRecordRepository.findById(correction.getAttendanceRecordId())
                .orElseGet(AttendanceRecord::new);

        if (record.getId() == null) {
            record.setTenantId(TenantContext.getTenantId());
            record.setEmployeeId(correction.getEmployeeId());
            record.setCompanyId(correction.getCompanyId());
            record.setDepartmentId(correction.getDepartmentId());
            record.setAttendanceDate(correction.getRequestedDate());
        }
        if (correction.getRequestedCheckInAt() != null) {
            record.setCheckInAt(correction.getRequestedCheckInAt());
            record.setLateByMinutes(calculateLateMinutes(correction.getRequestedCheckInAt()));
        }
        if (correction.getRequestedCheckOutAt() != null) {
            record.setCheckOutAt(correction.getRequestedCheckOutAt());
        }
        record.setRegularized(true);
        record.setRegularizationReason(correction.getReason());
        record.setManagedByEmployeeId(approverEmployeeId);
        record.setManagerNote(note);
        record.setAttendanceType(AttendanceType.OFFICE);
        record.setAttendanceStatus(parseAttendanceStatus(null, record.getCheckInAt()));
        recomputeWorkingHours(record);

        AttendanceRecord saved = attendanceRecordRepository.save(record);
        correction.setAttendanceRecordId(saved.getId());
        logEvent(saved, AttendanceEventType.CORRECTION_APPROVED, null, null,
                saved.getLocationName(), null, approverEmployeeId, note);
    }

    private CorrectionRequestResponse toCorrectionResponse(AttendanceCorrectionRequest correction) {
        return new CorrectionRequestResponse(
                correction.getId(),
                correction.getEmployeeId(),
                correction.getAttendanceRecordId(),
                correction.getRequestedDate(),
                correction.getRequestedCheckInAt(),
                correction.getRequestedCheckOutAt(),
                correction.getReason(),
                correction.getAttachmentUrl(),
                correction.getStatus(),
                correction.getApproverId(),
                correction.getApproverComment(),
                correction.getDecidedAt(),
                correction.getCreatedAt());
    }

    private GeoFenceZoneResponse toZoneResponse(GeoFenceZone zone) {
        return new GeoFenceZoneResponse(
                zone.getId(),
                zone.getCompanyId(),
                zone.getBranchId(),
                zone.getDepartmentId(),
                zone.getName(),
                zone.getLatitude(),
                zone.getLongitude(),
                zone.getRadiusMeters(),
                zone.getPunchMethod() != null ? zone.getPunchMethod().name() : null,
                zone.getColorHex(),
                zone.getIconKey(),
                zone.isActive());
    }

    private void logEvent(AttendanceRecord record,
                          AttendanceEventType eventType,
                          Double latitude,
                          Double longitude,
                          String locationName,
                          String zoneName,
                          UUID actorEmployeeId,
                          String note) {
        AttendanceEventLog event = new AttendanceEventLog();
        event.setTenantId(record.getTenantId() != null ? record.getTenantId() : TenantContext.getTenantId());
        event.setAttendanceRecordId(record.getId());
        event.setEmployeeId(record.getEmployeeId());
        event.setCompanyId(record.getCompanyId());
        event.setDepartmentId(record.getDepartmentId());
        event.setBranchId(record.getBranchId());
        event.setEventDate(record.getAttendanceDate());
        event.setEventAt(Instant.now());
        event.setEventType(eventType);
        event.setAttendanceStatus(record.getAttendanceStatus());
        event.setLatitude(latitude);
        event.setLongitude(longitude);
        event.setLocationName(locationName);
        event.setZoneName(zoneName);
        event.setActorEmployeeId(actorEmployeeId);
        event.setNote(note);
        attendanceEventLogRepository.save(event);
    }

    private void publishCheckinEvent(AttendanceRecord saved, UUID tenantId, CheckInMethod method) {
        if (!kafkaEnabled) {
            // Kafka is disabled — skip the publish entirely. Calling
            // kafkaTemplate.send() with no broker available blocks for
            // max.block.ms (default 60s) trying to fetch producer metadata,
            // which makes the /checkin HTTP response hang.
            return;
        }
        try {
            AttendanceCheckinEvent event = new AttendanceCheckinEvent(
                    saved.getId(), saved.getEmployeeId(), tenantId,
                    saved.getCompanyId(), saved.getDepartmentId(), saved.getBranchId(),
                    saved.getCheckInAt(), method.name(), Instant.now());
            kafkaTemplate.send(CHECKIN_TOPIC, tenantId.toString(), event);
        } catch (Exception e) {
            log.warn("Failed to publish check-in event for employee={}: {}", saved.getEmployeeId(), e.getMessage());
        }
    }
}
