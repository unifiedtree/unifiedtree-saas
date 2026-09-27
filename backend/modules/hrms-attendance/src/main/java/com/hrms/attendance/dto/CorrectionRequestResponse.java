package com.hrms.attendance.dto;

import com.hrms.core.enums.ApprovalStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record CorrectionRequestResponse(
        UUID id,
        UUID employeeId,
        String employeeName,
        String employeeCode,
        String departmentName,
        UUID attendanceRecordId,
        LocalDate requestedDate,
        Instant requestedCheckInAt,
        Instant requestedCheckOutAt,
        String reason,
        String attachmentUrl,
        ApprovalStatus status,
        UUID approverId,
        String approverComment,
        Instant decidedAt,
        Instant createdAt,
        // ── V143.53 redesign (BW-23). Additive.
        /**
         * While the request waits: who it went to, by the path its notification
         * takes (reporting manager, else department head, else HR, else a super
         * admin). Null once decided.
         */
        String approverName,
        /** Who approved or rejected it; null while it waits. */
        String decidedByName
) {
    /** The shape before BW-23 (no names). */
    public CorrectionRequestResponse(UUID id, UUID employeeId, String employeeName, String employeeCode,
                                     String departmentName, UUID attendanceRecordId, LocalDate requestedDate,
                                     Instant requestedCheckInAt, Instant requestedCheckOutAt, String reason,
                                     String attachmentUrl, ApprovalStatus status, UUID approverId,
                                     String approverComment, Instant decidedAt, Instant createdAt) {
        this(id, employeeId, employeeName, employeeCode, departmentName, attendanceRecordId, requestedDate,
                requestedCheckInAt, requestedCheckOutAt, reason, attachmentUrl, status, approverId, approverComment,
                decidedAt, createdAt, null, null);
    }
}
