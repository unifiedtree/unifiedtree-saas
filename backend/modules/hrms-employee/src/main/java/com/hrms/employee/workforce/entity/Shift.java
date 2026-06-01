package com.hrms.employee.workforce.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalTime;
import java.util.UUID;

@Entity
@Table(schema = "org", name = "shifts")
@Getter
@Setter
public class Shift extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "code", length = 30)
    private String code;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    @Column(name = "break_minutes", nullable = false)
    private int breakMinutes = 30;

    @Column(name = "grace_minutes", nullable = false)
    private int graceMinutes = 10;

    @Column(name = "days_bitmask", nullable = false)
    private int daysBitmask = 62;

    @Column(name = "is_night_shift", nullable = false)
    private boolean nightShift = false;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;
}
