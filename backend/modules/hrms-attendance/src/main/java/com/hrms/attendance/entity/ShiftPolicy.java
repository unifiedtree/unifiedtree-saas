package com.hrms.attendance.entity;

import com.hrms.attendance.enums.ShiftType;
import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.LocalTime;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "attendance", name = "shift_policies")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class ShiftPolicy extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "shift_type")
    private ShiftType shiftType;

    @Column(name = "start_time")
    private LocalTime startTime;

    @Column(name = "end_time")
    private LocalTime endTime;

    @Column(name = "grace_period_minutes")
    private int gracePeriodMinutes = 15;

    @Column(name = "working_hours_per_day")
    private Double workingHoursPerDay = 8.0;

    @Column(name = "is_active")
    private boolean active = true;
}
