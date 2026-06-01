package com.hrms.leave.entity;

import com.hrms.core.entity.BaseEntity;
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
        name = "leave_balances",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_leave_balance",
                columnNames = {"tenant_id", "employee_id", "leave_type_id", "year"}
        )
)
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class LeaveBalance extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "leave_type_id", nullable = false)
    private UUID leaveTypeId;

    @Column(name = "year", nullable = false)
    private int year;

    @Column(name = "total_entitlement", nullable = false)
    private double totalEntitlement;

    @Column(name = "used", nullable = false)
    private double used = 0;

    @Column(name = "pending", nullable = false)
    private double pending = 0;

    @Column(name = "carry_forward", nullable = false)
    private double carryForward = 0;

    /**
     * Computed available balance: totalEntitlement + carryForward - used - pending
     */
    @Transient
    public double getAvailable() {
        return totalEntitlement + carryForward - used - pending;
    }
}
