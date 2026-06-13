package com.unifiedtree.attendance.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class AttendanceApiDtos {
    private AttendanceApiDtos() {
    }

    public record CheckInRequest(
            @NotNull Double latitude,
            @NotNull Double longitude,
            String faceImageBase64,
            String checkInMethod,
            String locationName,
            String zoneName,
            String deviceId,
            String clientEventId,
            Boolean offlineCaptured
    ) {
    }

    public record CheckOutRequest(
            UUID employeeId,
            Double latitude,
            Double longitude,
            String checkOutMethod,
            String locationName,
            String zoneName,
            String deviceId,
            String clientEventId
    ) {
    }

    public record AttendanceDto(
            UUID id,
            String attendanceDate,
            String checkInTime,
            String checkOutTime,
            String attendanceType,
            String attendanceStatus,
            String checkInMethod,
            String checkOutMethod,
            Double workHours,
            Double faceConfidenceScore,
            String locationName,
            String checkInZoneName,
            String checkOutZoneName,
            Integer lateByMinutes,
            Integer overtimeMinutes,
            boolean manualEntry
    ) {
    }

    public record MonthlyStatsResponse(
            int presentDays,
            int absentDays,
            int holidays,
            int onTimeDays,
            int lateDays,
            int attendanceScore
    ) {
    }

    public record AttendanceHomeResponse(
            String employeeName,
            String jobTitle,
            boolean punchedIn,
            AttendanceDto todayRecord,
            MonthlyStatsResponse monthlySummary,
            String locationLabel,
            boolean withinZone,
            int pendingApprovals,
            int teamPresentToday,
            String scheduledStart,
            Integer graceMinutes
    ) {
        public AttendanceHomeResponse(String employeeName,
                                      String jobTitle,
                                      boolean punchedIn,
                                      AttendanceDto todayRecord,
                                      MonthlyStatsResponse monthlySummary,
                                      String locationLabel,
                                      boolean withinZone,
                                      int pendingApprovals,
                                      int teamPresentToday) {
            this(employeeName, jobTitle, punchedIn, todayRecord, monthlySummary,
                    locationLabel, withinZone, pendingApprovals, teamPresentToday, null, null);
        }
    }

    public record CheckOutSummaryResponse(
            UUID attendanceRecordId,
            Instant startedAt,
            double totalDurationHours,
            long totalDurationMinutes,
            String locationName,
            boolean shortSessionWarning
    ) {
    }

    public record DayRecordResponse(
            String date,
            String status,
            String checkInTime,
            String checkOutTime,
            Double workHours
    ) {
    }

    public record WeeklyDayResponse(
            String date,
            double hours,
            String status,
            String checkInTime,
            String checkOutTime,
            Integer lateByMinutes
    ) {
        public WeeklyDayResponse(String date, double hours, String status) {
            this(date, hours, status, null, null, null);
        }
    }

    public record WeeklySummaryResponse(
            double totalHours,
            double overtimeHours,
            int presentDays,
            String avgArrivalTime,
            Double dailyTargetHours,
            List<WeeklyDayResponse> days
    ) {
        public WeeklySummaryResponse(double totalHours,
                                     double overtimeHours,
                                     int presentDays,
                                     String avgArrivalTime,
                                     List<WeeklyDayResponse> days) {
            this(totalHours, overtimeHours, presentDays, avgArrivalTime, null, days);
        }
    }

    public record AttendanceRecordResponse(
            UUID id,
            UUID employeeId,
            LocalDate attendanceDate,
            Instant checkInAt,
            Instant checkOutAt,
            String attendanceStatus,
            String attendanceType,
            String checkInMethod,
            String checkOutMethod,
            Double workingHours,
            boolean regularized,
            String locationName,
            String checkInZoneName,
            String checkOutZoneName,
            Integer lateByMinutes,
            Integer overtimeMinutes,
            boolean manualEntry
    ) {
    }

    public record GeoValidateRequest(
            UUID employeeId,
            @NotNull Double latitude,
            @NotNull Double longitude
    ) {
    }

    public record GeoValidateResponse(
            boolean withinFence,
            UUID branchId,
            String branchName,
            double distanceMeters,
            String message
    ) {
    }

    public record CorrectionRequestRequest(
            UUID attendanceRecordId,
            @NotNull LocalDate requestedDate,
            Instant requestedCheckInAt,
            Instant requestedCheckOutAt,
            @NotBlank String reason,
            String attachmentUrl
    ) {
    }

    public record CorrectionRequestResponse(
            UUID id,
            UUID employeeId,
            UUID attendanceRecordId,
            LocalDate requestedDate,
            Instant requestedCheckInAt,
            Instant requestedCheckOutAt,
            String reason,
            String attachmentUrl,
            String status,
            UUID approverId,
            String approverComment,
            Instant decidedAt,
            Instant createdAt
    ) {
    }

    public record PageResponse<T>(
            List<T> content,
            int page,
            int size,
            long totalElements,
            int totalPages,
            boolean last
    ) {
    }

    public record EmployeeResponse(
            UUID id,
            UUID tenantId,
            String employeeCode,
            String firstName,
            String lastName,
            String email,
            String phone,
            LocalDate dateOfBirth,
            String gender,
            UUID companyId,
            UUID departmentId,
            UUID branchId,
            UUID geoFenceZoneId,
            String weeklyOffDays,
            UUID managerId,
            String jobTitle,
            String employmentType,
            String employmentStatus,
            LocalDate dateOfJoining,
            String workLocation,
            String salaryFrequency,
            Double monthlySalary,
            String panNumber,
            String aadhaarNumber,
            String uanNumber,
            String esiNumber,
            String bankAccountNumber,
            String bankIfscCode,
            String bankName,
            String bankBranchName,
            boolean isFaceEnrolled,
            String profilePhotoUrl,
            Instant createdAt
    ) {
    }
}
