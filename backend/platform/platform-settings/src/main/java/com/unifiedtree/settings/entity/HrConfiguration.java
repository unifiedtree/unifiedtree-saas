package com.unifiedtree.settings.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Tenant-and-company-scoped HR configuration. Per the client spec's
 * "HR Configuration" settings page.
 */
@Entity
@Table(schema = "settings", name = "hr_configuration")
@Getter
@Setter
public class HrConfiguration extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "fiscal_year_start", length = 10)
    private String fiscalYearStart = "APRIL";

    @Column(name = "default_notice_period_days")
    private Integer defaultNoticePeriodDays = 60;

    @Column(name = "probation_period_months")
    private Integer probationPeriodMonths = 6;

    @Column(name = "retirement_age")
    private Integer retirementAge = 60;

    @Column(name = "enable_late_auto_deduction", nullable = false)
    private boolean enableLateAutoDeduction;

    @Column(name = "late_grace_minutes")
    private Integer lateGraceMinutes = 15;

    @Column(name = "enforce_geofencing_for_mobile", nullable = false)
    private boolean enforceGeofencingForMobile = true;

    @Column(name = "allow_work_from_home", nullable = false)
    private boolean allowWorkFromHome = true;

    @Column(name = "workweek_start_day")
    private Integer workweekStartDay = 1;

    /**
     * Weekend day numbers in ISO format (1=Mon ... 7=Sun). Defaults to Sat+Sun.
     * Stored as a Postgres int[] column.
     */
    @Column(name = "weekend_days", columnDefinition = "integer[]")
    private Integer[] weekendDays = new Integer[] { 6, 7 };
}
