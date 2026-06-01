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

    // canonical column is carry_forward_max_days
    @Column(name = "carry_forward_max_days")
    private int maxCarryForwardDays = 0;

    @Column(name = "is_encashable")
    private boolean encashable;

    @Column(name = "is_paid_leave")
    private boolean paidLeave = true;

    @Column(name = "is_active")
    private boolean active = true;

    @Column(name = "applicable_gender", length = 20)
    private String applicableGender;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;
}
