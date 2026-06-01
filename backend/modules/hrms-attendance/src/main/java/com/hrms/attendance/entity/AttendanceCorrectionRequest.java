package com.hrms.attendance.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.core.enums.ApprovalStatus;
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
// Maps to attendance.regularization_requests. Class name retained for backward compat.
@Entity
@Table(schema = "attendance", name = "regularization_requests")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class AttendanceCorrectionRequest extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "company_id")
    private UUID companyId;

    @Column(name = "department_id")
    private UUID departmentId;

    // canonical column is record_id
    @Column(name = "record_id")
    private UUID attendanceRecordId;

    // canonical column is request_date
    @Column(name = "request_date", nullable = false)
    private LocalDate requestedDate;

    // canonical column is requested_check_in
    @Column(name = "requested_check_in")
    private Instant requestedCheckInAt;

    // canonical column is requested_check_out
    @Column(name = "requested_check_out")
    private Instant requestedCheckOutAt;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "attachment_url")
    private String attachmentUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ApprovalStatus status = ApprovalStatus.PENDING;

    @Column(name = "approver_id")
    private UUID approverId;

    // canonical column is decision_note
    @Column(name = "decision_note")
    private String approverComment;

    // canonical column is decision_at
    @Column(name = "decision_at")
    private Instant decidedAt;
}
