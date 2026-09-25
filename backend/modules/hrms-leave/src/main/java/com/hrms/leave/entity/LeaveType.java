package com.hrms.leave.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.leave.enums.LeaveCategory;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

@Getter
@Setter
@Entity
@Table(
        schema = "leave_mgmt",
        name = "leave_types",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_leave_type_tenant_code",
                columnNames = {"tenant_id", "company_id", "code"}
        )
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class LeaveType extends BaseEntity {

    @Column(name = "company_id", nullable = false)
    private UUID companyId;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "code", nullable = false, length = 30)
    private String code;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", length = 50)
    private LeaveCategory category;

    @Column(name = "annual_entitlement", nullable = false)
    private double annualEntitlement;

    @Column(name = "max_consecutive_days")
    private int maxConsecutiveDays;

    @Column(name = "min_notice_days")
    private int minNoticeDays = 0;

    // canonical column is carry_forward
    @Column(name = "carry_forward")
    private boolean carryForwardAllowed;

    // canonical column is carry_forward_max_days. Boxed Integer (not primitive)
    // so a legacy NULL in the DB doesn't blow up Hibernate hydration — that
    // produced a PropertyAccessException -> 500 on /v1/leave/overview and
    // surfaced to the mobile app as "Cannot reach the HRMS server."
    @Column(name = "carry_forward_max_days")
    private Integer maxCarryForwardDays = 0;

    @Column(name = "is_encashable")
    private boolean encashable;

    /**
     * How the annual quota is credited: YEARLY (all of it at the start of the
     * year, the behaviour every balance had before V143.23), MONTHLY (quota/12
     * on the 1st of each month) or QUARTERLY (quota/4 on the 1st of Jan, Apr,
     * Jul and Oct). See LeaveAccrualMath.
     */
    @Column(name = "accrual_frequency", length = 20)
    private String accrualFrequency = "YEARLY";

    /** The most days one person may encash in a leave year; null = no yearly limit. */
    @Column(name = "max_encash_days")
    private Integer maxEncashDays;

    @Column(name = "is_paid_leave")
    private boolean paidLeave = true;

    @Column(name = "is_active")
    private boolean active = true;

    @Column(name = "applicable_gender", length = 20)
    private String applicableGender;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;
}
