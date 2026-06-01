package com.hrms.leave.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.leave.enums.LeaveDuration;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(schema = "leave_mgmt", name = "leave_requests")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class LeaveRequest extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "leave_type_id", nullable = false)
    private UUID leaveTypeId;

    @Column(name = "approver_id")
    private UUID approverId;

    @Column(name = "l2_approver_id")
    private UUID l2ApproverId;

    @Column(name = "l2_approver_comment", columnDefinition = "TEXT")
    private String l2ApproverComment;

    @Column(name = "l2_approved_at")
    private Instant l2ApprovedAt;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "duration", length = 30)
    private LeaveDuration duration;

    @Column(name = "total_days", nullable = false)
    private double totalDays;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ApprovalStatus status = ApprovalStatus.PENDING;

    // canonical column is decision_note
    @Column(name = "decision_note", columnDefinition = "TEXT")
    private String approverComment;

    // canonical column is decision_at
    @Column(name = "decision_at")
    private Instant approvedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "cancellation_reason", columnDefinition = "TEXT")
    private String cancellationReason;
}
