package com.hrms.leave.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.leave.dto.WfhRequestRequest;
import com.hrms.leave.dto.WfhRequestResponse;
import com.hrms.leave.entity.WfhRequest;
import com.hrms.leave.repository.WfhRequestRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * WFH request / approval flow. Kept intentionally minimal — no balance
 * accounting, no half-day duration, no L2 escalation. The single downstream
 * effect of an APPROVED WFH request is that
 * {@code AttendanceService.isApprovedWfhDay} returns true for the covered
 * dates, which lets the employee check in from outside the geofence.
 */
@Service
public class WfhService {

    private static final Logger log = LoggerFactory.getLogger(WfhService.class);

    private final WfhRequestRepository repository;

    public WfhService(WfhRequestRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public WfhRequestResponse apply(UUID employeeId, WfhRequestRequest request, UUID approverId) {
        if (employeeId == null) {
            throw new BusinessRuleException("Employee id is required", "EMPLOYEE_REQUIRED");
        }
        if (request.fromDate() == null || request.toDate() == null) {
            throw new BusinessRuleException("From and to dates are required", "INVALID_DATES");
        }
        if (request.toDate().isBefore(request.fromDate())) {
            throw new BusinessRuleException("End date must not be before start date", "INVALID_DATES");
        }
        // Cap the window: a single WFH request may not span more than 90 days.
        // This bounds the abuse where an attacker (or a mistaken form) could
        // reserve a WFH bypass window for years — preventing overlap checks
        // from doing effective work and locking out any subsequent request.
        long spanDays = java.time.temporal.ChronoUnit.DAYS.between(request.fromDate(), request.toDate()) + 1;
        if (spanDays > 90) {
            throw new BusinessRuleException(
                    "A single WFH request can span at most 90 days. Split into multiple requests if needed.",
                    "WFH_WINDOW_TOO_LONG");
        }
        // The start date must be within a reasonable planning horizon — no
        // scheduling a WFH day 5 years out. 365 days from today is the ceiling.
        if (request.fromDate().isAfter(java.time.LocalDate.now(java.time.ZoneOffset.UTC).plusDays(365))) {
            throw new BusinessRuleException(
                    "Start date must be within one year from today.",
                    "WFH_START_TOO_FAR");
        }
        // Approver must be resolved by the controller via ApproverFallbackResolver
        // BEFORE calling apply(). We refuse to persist a null approver here —
        // audit P0-1: a null approver makes the request invisible to every
        // approval queue on a fresh tenant.
        if (approverId == null) {
            throw new BusinessRuleException(
                    "No approver available — assign this employee a reporting manager, "
                            + "set a department head, or add an HR manager before applying for WFH",
                    "NO_APPROVER_AVAILABLE");
        }

        List<WfhRequest> overlaps = repository
                .findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(
                        employeeId,
                        List.of(ApprovalStatus.PENDING, ApprovalStatus.APPROVED),
                        request.toDate(),
                        request.fromDate());
        if (!overlaps.isEmpty()) {
            throw new BusinessRuleException(
                    "You already have a WFH request that overlaps these dates.",
                    "WFH_OVERLAP");
        }

        WfhRequest entity = new WfhRequest();
        entity.setTenantId(TenantContext.getTenantId());
        entity.setEmployeeId(employeeId);
        entity.setFromDate(request.fromDate());
        entity.setToDate(request.toDate());
        entity.setReason(request.reason());
        entity.setStatus(ApprovalStatus.PENDING);
        entity.setApproverId(approverId);
        WfhRequest saved = repository.save(entity);
        log.info("WFH requested id={} employee={} approver={} range={}..{}",
                saved.getId(), employeeId, approverId, saved.getFromDate(), saved.getToDate());
        return toResponse(saved);
    }

    @Transactional
    public WfhRequestResponse decide(UUID requestId,
                                     UUID approverId,
                                     ApprovalStatus decision,
                                     String comment) {
        if (decision != ApprovalStatus.APPROVED && decision != ApprovalStatus.REJECTED) {
            throw new BusinessRuleException(
                    "Decision must be APPROVED or REJECTED", "INVALID_DECISION");
        }
        WfhRequest entity = repository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("WfhRequest", requestId));
        if (entity.getStatus() != ApprovalStatus.PENDING) {
            throw new BusinessRuleException(
                    "WFH request is not in PENDING status (current: %s)".formatted(entity.getStatus()),
                    "WFH_NOT_PENDING");
        }
        entity.setStatus(decision);
        entity.setApproverId(approverId);
        entity.setDecidedAt(Instant.now());
        entity.setDecisionNote(comment);
        WfhRequest saved = repository.save(entity);
        log.info("WFH decided id={} decision={} approver={}", saved.getId(), decision, approverId);
        return toResponse(saved);
    }

    @Transactional
    public void cancel(UUID requestId, UUID employeeId) {
        WfhRequest entity = repository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("WfhRequest", requestId));
        if (!entity.getEmployeeId().equals(employeeId)) {
            throw new BusinessRuleException(
                    "WFH request does not belong to the employee", "WFH_ACCESS_DENIED");
        }
        if (entity.getStatus() != ApprovalStatus.PENDING && entity.getStatus() != ApprovalStatus.APPROVED) {
            throw new BusinessRuleException(
                    "Only PENDING or APPROVED WFH requests can be cancelled (current: %s)"
                            .formatted(entity.getStatus()),
                    "WFH_CANNOT_CANCEL");
        }
        entity.setStatus(ApprovalStatus.CANCELLED);
        entity.setDecidedAt(Instant.now());
        repository.save(entity);
        log.info("WFH cancelled id={} by employee={}", entity.getId(), employeeId);
    }

    @Transactional(readOnly = true)
    public PageResponse<WfhRequestResponse> getMyRequests(UUID employeeId, Pageable pageable) {
        Page<WfhRequest> page = repository.findByEmployeeIdOrderByFromDateDesc(employeeId, pageable);
        return PageResponse.from(page, this::toResponse);
    }

    @Transactional(readOnly = true)
    public PageResponse<WfhRequestResponse> getPendingApprovalsForManager(UUID managerId, Pageable pageable) {
        Page<WfhRequest> page = repository.findPendingForManager(managerId, pageable);
        return PageResponse.from(page, this::toResponse);
    }

    private WfhRequestResponse toResponse(WfhRequest w) {
        return new WfhRequestResponse(
                w.getId(),
                w.getEmployeeId(),
                null,        // employeeName — filled in by WfhController.enrich*
                null,        // employeeCode
                null,        // departmentName
                w.getFromDate(),
                w.getToDate(),
                w.getReason(),
                w.getStatus(),
                w.getApproverId(),
                w.getDecisionNote(),
                w.getDecidedAt(),
                w.getCreatedAt());
    }
}
