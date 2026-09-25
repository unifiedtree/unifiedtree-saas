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

import java.math.BigDecimal;
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

    @Column(name = "overtime_applicable")
    private boolean overtimeApplicable = false;

    @Column(name = "overtime_multiplier")
    private BigDecimal overtimeMultiplier = new BigDecimal("1.5");

    @Column(name = "is_active")
    private boolean active = true;

    // ── V143.23 ─────────────────────────────────────────────────────────────

    /** Short code shown on rosters and reports ("GEN"); unique per company among active shifts. */
    @Column(name = "code", length = 20)
    private String code;

    /**
     * Core hours of a FLEXIBLE shift: everyone is expected in between these.
     * A check-in after core start is Late (the shift's own start + grace is
     * ignored for flexible shifts that have core hours).
     */
    @Column(name = "core_start_time")
    private LocalTime coreStartTime;

    @Column(name = "core_end_time")
    private LocalTime coreEndTime;

    /**
     * Weekly off days for people on this shift, ISO day numbers as CSV
     * ("6,7" = Sat + Sun). Used by attendance only for employees who have no
     * weekly offs of their own. Null = not set.
     */
    @Column(name = "weekly_off_days", length = 20)
    private String weeklyOffDays;
}
