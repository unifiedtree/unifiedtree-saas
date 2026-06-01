package com.hrms.attendance.entity;

import com.hrms.attendance.enums.AttendanceEventType;
import com.hrms.attendance.enums.AttendanceStatus;
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
@Table(schema = "attendance", name = "event_logs")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class AttendanceEventLog extends BaseEntity {

    // canonical column is record_id
    @Column(name = "record_id")
    private UUID attendanceRecordId;

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "department_id")
    private UUID departmentId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "event_date", nullable = false)
    private LocalDate eventDate;

    @Column(name = "event_at", nullable = false)
    private Instant eventAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "event_type", nullable = false)
    private AttendanceEventType eventType;

    @Enumerated(EnumType.STRING)
    @Column(name = "attendance_status")
    private AttendanceStatus attendanceStatus;

    @Column(name = "latitude")
    private Double latitude;

    @Column(name = "longitude")
    private Double longitude;

    @Column(name = "location_name")
    private String locationName;

    @Column(name = "zone_name")
    private String zoneName;

    @Column(name = "actor_employee_id")
    private UUID actorEmployeeId;

    @Column(name = "note")
    private String note;
}
