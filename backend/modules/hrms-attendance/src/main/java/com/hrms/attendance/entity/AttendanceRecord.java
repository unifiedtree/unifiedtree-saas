package com.hrms.attendance.entity;

import com.hrms.attendance.enums.AttendanceType;
import com.hrms.attendance.enums.AttendanceStatus;
import com.hrms.attendance.enums.CheckInMethod;
import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "attendance", name = "records")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class AttendanceRecord extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "attendance_date", nullable = false)
    private LocalDate attendanceDate;

    @Column(name = "check_in_at")
    private Instant checkInAt;

    @Column(name = "check_out_at")
    private Instant checkOutAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "attendance_status")
    private AttendanceStatus attendanceStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "attendance_type")
    private AttendanceType attendanceType;

    @Enumerated(EnumType.STRING)
    @Column(name = "check_in_method")
    private CheckInMethod checkInMethod;

    @Enumerated(EnumType.STRING)
    @Column(name = "check_out_method")
    private CheckInMethod checkOutMethod;

    @Column(name = "check_in_latitude")
    private Double checkInLatitude;

    @Column(name = "check_in_longitude")
    private Double checkInLongitude;

    @Column(name = "check_out_latitude")
    private Double checkOutLatitude;

    @Column(name = "check_out_longitude")
    private Double checkOutLongitude;

    @Column(name = "branch_id")
    private UUID branchId;

    // Geofence zone IDs are not stored in canonical (geofence cut from Phase 1).
    // Fields retained for service-layer compatibility; not persisted.
    @jakarta.persistence.Transient
    private UUID checkInZoneId;

    @jakarta.persistence.Transient
    private UUID checkOutZoneId;

    // canonical column is check_in_location_name
    @Column(name = "check_in_location_name")
    private String locationName;

    @Column(name = "check_in_zone_name")
    private String checkInZoneName;

    @Column(name = "check_out_zone_name")
    private String checkOutZoneName;

    @Column(name = "face_confidence_score")
    private Double faceConfidenceScore;

    @Column(name = "is_regularized", nullable = false)
    private boolean regularized = false;

    @Column(name = "regularization_reason")
    private String regularizationReason;

    // canonical column is work_hours
    @Column(name = "work_hours")
    private Double workingHours;

    @Column(name = "remarks")
    private String remarks;

    @Column(name = "late_by_minutes")
    private Integer lateByMinutes;

    @Column(name = "overtime_minutes")
    private Integer overtimeMinutes;

    // canonical column is manual_entry (no is_ prefix)
    @Column(name = "manual_entry", nullable = false)
    private boolean manualEntry = false;

    @Column(name = "managed_by_employee_id")
    private UUID managedByEmployeeId;

    // canonical column is manual_entry_reason
    @Column(name = "manual_entry_reason")
    private String managerNote;

    @Column(name = "client_event_id")
    private String clientEventId;

    @Column(name = "device_id")
    private String deviceId;
}
