package com.hrms.leave.entity;

import com.hrms.core.entity.BaseEntity;
import com.hrms.core.enums.ApprovalStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A Work From Home request. Mirrors the shape of {@link LeaveRequest} but is
 * intentionally simpler: no balance accounting, no half-day duration, no
 * L2 escalation — a WFH approval is a single-step manager sign-off.
 *
 * <p>When an approved WFH request overlaps today's IST date,
 * {@code AttendanceService.isApprovedWfhDay} returns true and
 * {@code AttendanceController.checkIn} skips the OUTSIDE_GEOFENCE throw
 * (face-recognition + FACE_MISMATCH checks remain in force — WFH is a
 * location override, not an identity-verification bypass).
 */
@Getter
@Setter
@Entity
@Table(schema = "leave_mgmt", name = "wfh_requests")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public class WfhRequest extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "from_date", nullable = false)
    private LocalDate fromDate;

    @Column(name = "to_date", nullable = false)
    private LocalDate toDate;

    @Column(name = "reason", columnDefinition = "TEXT")
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    private ApprovalStatus status = ApprovalStatus.PENDING;

    @Column(name = "approver_id")
    private UUID approverId;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decision_note", columnDefinition = "TEXT")
    private String decisionNote;
}
