package com.hrms.leave.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.enums.ApprovalStatus;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.leave.dto.*;
import com.hrms.leave.entity.LeaveBalance;
import com.hrms.leave.entity.LeaveRequest;
import com.hrms.leave.entity.LeaveType;
import com.hrms.leave.mapper.LeaveBalanceMapper;
import com.hrms.leave.mapper.LeaveRequestMapper;
import com.hrms.leave.repository.HolidayCalendarRepository;
import com.hrms.leave.repository.LeaveBalanceRepository;
import com.hrms.leave.repository.LeaveRequestRepository;
import com.hrms.leave.repository.LeaveTypeRepository;
import com.unifiedtree.notifications.events.LeaveDecidedEvent;
import com.unifiedtree.notifications.events.LeaveRequestCancelledEvent;
import com.unifiedtree.notifications.events.LeaveRequestSubmittedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import com.hrms.core.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class LeaveService {

    private static final Logger log = LoggerFactory.getLogger(LeaveService.class);

    private static final String TOPIC_LEAVE_REQUESTED = "leave.requested.v1";
    private static final String TOPIC_LEAVE_APPROVED  = "leave.approved.v1";
    private static final String TOPIC_LEAVE_CANCELLED = "leave.cancelled.v1";

    private final LeaveTypeRepository leaveTypeRepository;
    private final LeaveBalanceRepository leaveBalanceRepository;
    private final LeaveRequestRepository leaveRequestRepository;
    private final HolidayCalendarRepository holidayCalendarRepository;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final LeaveRequestMapper leaveRequestMapper;
    private final LeaveBalanceMapper leaveBalanceMapper;
    private final JdbcTemplate jdbcTemplate;
    private final ApplicationEventPublisher eventPublisher;
    private final boolean kafkaEnabled;

    public LeaveService(
            LeaveTypeRepository leaveTypeRepository,
            LeaveBalanceRepository leaveBalanceRepository,
            LeaveRequestRepository leaveRequestRepository,
            HolidayCalendarRepository holidayCalendarRepository,
            KafkaTemplate<String, Object> kafkaTemplate,
            LeaveRequestMapper leaveRequestMapper,
            LeaveBalanceMapper leaveBalanceMapper,
            JdbcTemplate jdbcTemplate,
            ApplicationEventPublisher eventPublisher,
            @org.springframework.beans.factory.annotation.Value("${hrms.kafka.enabled:false}") boolean kafkaEnabled) {
        this.leaveTypeRepository = leaveTypeRepository;
        this.leaveBalanceRepository = leaveBalanceRepository;
        this.leaveRequestRepository = leaveRequestRepository;
        this.holidayCalendarRepository = holidayCalendarRepository;
        this.kafkaTemplate = kafkaTemplate;
        this.leaveRequestMapper = leaveRequestMapper;
        this.leaveBalanceMapper = leaveBalanceMapper;
        this.jdbcTemplate = jdbcTemplate;
        this.eventPublisher = eventPublisher;
        this.kafkaEnabled = kafkaEnabled;
    }

    private String resolveEmail(UUID employeeId, UUID tenantId) {
        if (employeeId == null) return null;
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT email FROM auth.user_credentials WHERE employee_id = ? AND tenant_id = ? AND is_active = true LIMIT 1",
                    String.class, employeeId, tenantId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private String resolveName(UUID employeeId, UUID tenantId) {
        if (employeeId == null) return null;
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT first_name || ' ' || last_name FROM hrms.employees WHERE id = ? AND tenant_id = ? LIMIT 1",
                    String.class, employeeId, tenantId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    @Transactional
    public LeaveRequestResponse applyLeave(UUID employeeId, UUID companyId,
                                           LeaveRequestRequest request, UUID approverId) {
        log.info("Applying leave for employee={} leaveType={}", employeeId, request.leaveTypeId());

        // Validate leave type exists and is active
        LeaveType leaveType = leaveTypeRepository.findById(request.leaveTypeId())
                .orElseThrow(() -> new ResourceNotFoundException("LeaveType", request.leaveTypeId()));
        if (!leaveType.isActive()) {
            throw new BusinessRuleException(
                    "Leave type '%s' is not active".formatted(leaveType.getName()),
                    "LEAVE_TYPE_INACTIVE");
        }

        // Validate dates
        LocalDate startDate = request.startDate();
        LocalDate endDate = request.endDate();
        if (endDate.isBefore(startDate)) {
            throw new BusinessRuleException("End date must not be before start date", "INVALID_LEAVE_DATES");
        }

        // Guard past-dated applications BEFORE the notice check. Without this
        // gate, an applicant picking a start date in the past hits the notice
        // path with a NEGATIVE noticeDays and sees the misleading text
        // "Minimum notice of 0 day(s) required" (or whatever the leave type is
        // set to) — a confusing error for what is really "you cannot apply
        // for leave in the past". Reject explicitly with LEAVE_START_IN_PAST
        // so the mobile UI can render the right message.
        if (startDate.isBefore(LocalDate.now())) {
            throw new BusinessRuleException(
                    "Leave start date cannot be in the past", "LEAVE_START_IN_PAST");
        }

        // Reject overlapping / duplicate leave requests for the same employee.
        // Any existing PENDING / PENDING_L2 / APPROVED leave whose date range
        // intersects [startDate, endDate] blocks a new application — otherwise
        // the applicant can double-book themselves (two PENDING requests for
        // the same day, or a fresh request layered on top of an already-approved
        // one), which then double-deducts pending balance and creates
        // ambiguous approver queues. Cancelled / rejected rows are ignored on
        // purpose so a corrected re-application still goes through.
        List<LeaveRequest> overlapping = leaveRequestRepository.findOverlapping(
                employeeId,
                List.of(ApprovalStatus.PENDING, ApprovalStatus.PENDING_L2, ApprovalStatus.APPROVED),
                startDate,
                endDate);
        if (!overlapping.isEmpty()) {
            throw new BusinessRuleException(
                    "Overlapping leave request already exists",
                    "LEAVE_DATES_OVERLAP");
        }

        // Check min notice days — must be the TOTAL elapsed days, not
        // Period.getDays() (which is only the day-of-month component, so a
        // start date one month out reads as 0 days' notice and wrongly rejects).
        long noticeDays = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), startDate);
        if (noticeDays < leaveType.getMinNoticeDays()) {
            throw new BusinessRuleException(
                    "Minimum notice of %d day(s) required before leave start date".formatted(leaveType.getMinNoticeDays()),
                    "INSUFFICIENT_NOTICE");
        }

        // Calculate working days (exclude weekends and holidays)
        Set<LocalDate> holidays = fetchHolidayDates(companyId, startDate, endDate);
        double totalDays = calculateWorkingDays(startDate, endDate, request.duration(), holidays);

        if (totalDays <= 0) {
            throw new BusinessRuleException("Leave request contains no working days", "NO_WORKING_DAYS");
        }

        // Check max consecutive days if configured
        if (leaveType.getMaxConsecutiveDays() > 0 && totalDays > leaveType.getMaxConsecutiveDays()) {
            throw new BusinessRuleException(
                    "Leave cannot exceed %d consecutive day(s) for type '%s'"
                            .formatted(leaveType.getMaxConsecutiveDays(), leaveType.getName()),
                    "EXCEEDS_CONSECUTIVE_DAYS");
        }

        // Check leave balance. New hires (and employees added before a leave type
        // existed) have NO balance row until the monthly accrual job runs — so
        // create it lazily from the leave type's annual entitlement instead of
        // hard-failing. Without this, a freshly onboarded employee could never
        // apply for leave ("No allocations yet" / LEAVE_BALANCE_NOT_FOUND).
        int year = startDate.getYear();
        LeaveBalance balance = leaveBalanceRepository
                .findByEmployeeIdAndLeaveTypeIdAndYear(employeeId, request.leaveTypeId(), year)
                .orElseGet(() -> {
                    LeaveBalance b = new LeaveBalance();
                    b.setTenantId(TenantContext.getTenantId());
                    b.setEmployeeId(employeeId);
                    b.setLeaveTypeId(request.leaveTypeId());
                    b.setYear(year);
                    b.setTotalEntitlement(leaveType.getAnnualEntitlement());
                    b.setUsed(0);
                    b.setPending(0);
                    b.setCarryForward(0);
                    return leaveBalanceRepository.save(b);
                });

        if (balance.getAvailable() < totalDays) {
            throw new BusinessRuleException(
                    "Insufficient leave balance. Available: %.1f, Requested: %.1f"
                            .formatted(balance.getAvailable(), totalDays),
                    "INSUFFICIENT_LEAVE_BALANCE");
        }

        // Create leave request
        LeaveRequest leaveRequest = new LeaveRequest();
        leaveRequest.setTenantId(TenantContext.getTenantId());
        leaveRequest.setEmployeeId(employeeId);
        leaveRequest.setLeaveTypeId(request.leaveTypeId());
        leaveRequest.setApproverId(approverId);
        leaveRequest.setStartDate(startDate);
        leaveRequest.setEndDate(endDate);
        leaveRequest.setDuration(request.duration());
        leaveRequest.setTotalDays(totalDays);
        leaveRequest.setReason(request.reason());
        leaveRequest.setStatus(ApprovalStatus.PENDING);

        leaveRequest = leaveRequestRepository.save(leaveRequest);

        // Increment pending balance
        balance.setPending(balance.getPending() + totalDays);
        leaveBalanceRepository.save(balance);

        log.info("Leave request created id={} for employee={}", leaveRequest.getId(), employeeId);

        UUID tenantId = TenantContext.getTenantId();

        // In-process Spring event → notif.notifications fan-out (see
        // com.unifiedtree.notifications.listener.DomainEventListener). Runs
        // AFTER_COMMIT so a rollback in this tx cannot leave a phantom
        // notification. This is independent of the Kafka path below (Kafka is
        // off on Railway; the notifications pipeline is always on).
        try {
            eventPublisher.publishEvent(new LeaveRequestSubmittedEvent(
                    leaveRequest.getId(), employeeId, approverId, tenantId,
                    leaveType.getName(), startDate, endDate, totalDays));
        } catch (Exception ex) {
            log.warn("Failed to publish LeaveRequestSubmittedEvent for {}: {}",
                    leaveRequest.getId(), ex.getMessage());
        }

        // Publish Kafka event
        // CRITICAL: skip the Kafka publish when Kafka is disabled. Otherwise
        // kafkaTemplate.send() blocks for up to `max.block.ms` (~60s default)
        // trying to fetch producer metadata from a broker that doesn't exist —
        // the HTTP request hangs on the Submit Application button and the user
        // sees an indefinite "Submitting…" spinner. Same defensive pattern
        // already used in AttendanceService.publishCheckinEvent.
        if (kafkaEnabled) {
            try {
                LeaveRequestedEvent event = new LeaveRequestedEvent(
                        leaveRequest.getId(),
                        employeeId,
                        tenantId,
                        approverId,
                        startDate,
                        endDate,
                        totalDays,
                        leaveType.getName(),
                        Instant.now(),
                        resolveName(employeeId, tenantId),
                        resolveEmail(employeeId, tenantId),
                        resolveEmail(approverId, tenantId),
                        resolveName(approverId, tenantId)
                );
                kafkaTemplate.send(TOPIC_LEAVE_REQUESTED, tenantId.toString(), event);
                log.debug("Published {} event for leaveRequest={}", TOPIC_LEAVE_REQUESTED, leaveRequest.getId());
            } catch (Exception e) {
                log.warn("Failed to publish {} for leaveRequest={}: {}",
                        TOPIC_LEAVE_REQUESTED, leaveRequest.getId(), e.getMessage());
            }
        }

        LeaveRequestResponse response = leaveRequestMapper.toResponse(leaveRequest);
        return new LeaveRequestResponse(
                response.id(),
                response.employeeId(),
                response.employeeName(),
                response.employeeCode(),
                response.departmentName(),
                response.leaveTypeId(),
                leaveType.getName(),
                response.startDate(),
                response.endDate(),
                response.totalDays(),
                response.reason(),
                response.status(),
                response.approverComment(),
                response.approvedAt(),
                response.createdAt()
        );
    }

    @Transactional
    public LeaveRequestResponse approveLeave(UUID requestId, UUID approverId, LeaveApprovalRequest approval) {
        log.info("Processing leave approval requestId={} approverId={} status={}",
                requestId, approverId, approval.status());

        // Validate approval status
        if (approval.status() != ApprovalStatus.APPROVED && approval.status() != ApprovalStatus.REJECTED) {
            throw new BusinessRuleException(
                    "Approval status must be APPROVED or REJECTED", "INVALID_APPROVAL_STATUS");
        }

        LeaveRequest leaveRequest = leaveRequestRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveRequest", requestId));

        // Self-approval guard: the actor (approverId is the caller's employeeId
        // extracted from JWT) must not be the same person as the request's
        // applicant. Without this a manager who is also the applicant on their
        // own request — which happens on tenants where the approver-fallback
        // chain resolved to the applicant themselves (e.g. a founding HR who
        // is both applicant and terminal fallback) — could rubber-stamp their
        // own leave.
        assertNotSelfApproval(leaveRequest, approverId);

        if (leaveRequest.getStatus() != ApprovalStatus.PENDING) {
            throw new BusinessRuleException(
                    "Leave request is not in PENDING status, current status: %s"
                            .formatted(leaveRequest.getStatus()),
                    "LEAVE_NOT_PENDING");
        }

        LeaveBalance balance = leaveBalanceRepository
                .findByEmployeeIdAndLeaveTypeIdAndYear(
                        leaveRequest.getEmployeeId(),
                        leaveRequest.getLeaveTypeId(),
                        leaveRequest.getStartDate().getYear())
                .orElseThrow(() -> new BusinessRuleException(
                        "Leave balance not found for request", "LEAVE_BALANCE_NOT_FOUND"));

        double totalDays = leaveRequest.getTotalDays();

        // Update request
        leaveRequest.setStatus(approval.status());
        leaveRequest.setApproverComment(approval.comment());
        leaveRequest.setApproverId(approverId);
        leaveRequest.setApprovedAt(Instant.now());

        if (approval.status() == ApprovalStatus.APPROVED) {
            // used += totalDays, pending -= totalDays
            balance.setUsed(balance.getUsed() + totalDays);
            balance.setPending(balance.getPending() - totalDays);
            log.info("Leave APPROVED: balance updated for employee={}", leaveRequest.getEmployeeId());
        } else {
            // REJECTED: revert pending
            balance.setPending(balance.getPending() - totalDays);
            log.info("Leave REJECTED: pending balance reverted for employee={}", leaveRequest.getEmployeeId());
        }

        leaveBalanceRepository.save(balance);
        leaveRequest = leaveRequestRepository.save(leaveRequest);

        // In-process notification fan-out for the terminal decision.
        try {
            String ltName = leaveTypeRepository.findById(leaveRequest.getLeaveTypeId())
                    .map(LeaveType::getName).orElse(null);
            eventPublisher.publishEvent(new LeaveDecidedEvent(
                    leaveRequest.getId(),
                    leaveRequest.getEmployeeId(),
                    leaveRequest.getTenantId(),
                    approval.status() == ApprovalStatus.APPROVED,
                    ltName,
                    leaveRequest.getStartDate(),
                    leaveRequest.getEndDate(),
                    approval.comment()));
        } catch (Exception ex) {
            log.warn("Failed to publish LeaveDecidedEvent for {}: {}",
                    leaveRequest.getId(), ex.getMessage());
        }

        // Publish Kafka event (skipped when Kafka disabled — see applyLeave note).
        if (kafkaEnabled) {
            try {
                UUID tid = leaveRequest.getTenantId();
                UUID eid = leaveRequest.getEmployeeId();
                String ltName = leaveTypeRepository.findById(leaveRequest.getLeaveTypeId())
                        .map(LeaveType::getName).orElse(null);
                LeaveApprovedEvent event = new LeaveApprovedEvent(
                        leaveRequest.getId(),
                        eid,
                        tid,
                        approval.status(),
                        Instant.now(),
                        resolveEmail(eid, tid),
                        resolveName(eid, tid),
                        ltName,
                        leaveRequest.getStartDate(),
                        leaveRequest.getEndDate(),
                        approval.comment()
                );
                kafkaTemplate.send(TOPIC_LEAVE_APPROVED, tid.toString(), event);
                log.debug("Published {} event for leaveRequest={}", TOPIC_LEAVE_APPROVED, leaveRequest.getId());
            } catch (Exception e) {
                log.warn("Failed to publish {} for leaveRequest={}: {}",
                        TOPIC_LEAVE_APPROVED, leaveRequest.getId(), e.getMessage());
            }
        }

        LeaveRequestResponse response = leaveRequestMapper.toResponse(leaveRequest);
        String leaveTypeName = leaveTypeRepository.findById(leaveRequest.getLeaveTypeId())
                .map(LeaveType::getName)
                .orElse(null);

        return new LeaveRequestResponse(
                response.id(),
                response.employeeId(),
                response.employeeName(),
                response.employeeCode(),
                response.departmentName(),
                response.leaveTypeId(),
                leaveTypeName,
                response.startDate(),
                response.endDate(),
                response.totalDays(),
                response.reason(),
                response.status(),
                response.approverComment(),
                response.approvedAt(),
                response.createdAt()
        );
    }

    @Transactional
    public void cancelLeave(UUID requestId, UUID employeeId, String reason) {
        log.info("Cancelling leave requestId={} by employee={}", requestId, employeeId);

        LeaveRequest leaveRequest = leaveRequestRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveRequest", requestId));

        if (!leaveRequest.getEmployeeId().equals(employeeId)) {
            throw new BusinessRuleException(
                    "Leave request does not belong to the employee", "LEAVE_ACCESS_DENIED");
        }

        ApprovalStatus currentStatus = leaveRequest.getStatus();
        if (currentStatus != ApprovalStatus.PENDING && currentStatus != ApprovalStatus.APPROVED) {
            throw new BusinessRuleException(
                    "Only PENDING or APPROVED leave requests can be cancelled, current status: %s"
                            .formatted(currentStatus),
                    "LEAVE_CANNOT_CANCEL");
        }

        LeaveBalance balance = leaveBalanceRepository
                .findByEmployeeIdAndLeaveTypeIdAndYear(
                        leaveRequest.getEmployeeId(),
                        leaveRequest.getLeaveTypeId(),
                        leaveRequest.getStartDate().getYear())
                .orElseThrow(() -> new BusinessRuleException(
                        "Leave balance not found for request", "LEAVE_BALANCE_NOT_FOUND"));

        double totalDays = leaveRequest.getTotalDays();

        if (currentStatus == ApprovalStatus.APPROVED) {
            // Revert used balance
            balance.setUsed(balance.getUsed() - totalDays);
            log.info("Cancelled APPROVED leave: used balance reverted for employee={}", employeeId);
        } else {
            // Revert pending balance
            balance.setPending(balance.getPending() - totalDays);
            log.info("Cancelled PENDING leave: pending balance reverted for employee={}", employeeId);
        }

        leaveRequest.setStatus(ApprovalStatus.CANCELLED);
        leaveRequest.setCancelledAt(Instant.now());
        leaveRequest.setCancellationReason(reason);

        leaveBalanceRepository.save(balance);
        leaveRequestRepository.save(leaveRequest);

        // Notify the approver so a cancelled request never lingers in their queue.
        try {
            String ltName = leaveTypeRepository.findById(leaveRequest.getLeaveTypeId())
                    .map(LeaveType::getName).orElse(null);
            eventPublisher.publishEvent(new LeaveRequestCancelledEvent(
                    leaveRequest.getId(), employeeId, leaveRequest.getApproverId(),
                    leaveRequest.getTenantId(), ltName,
                    leaveRequest.getStartDate(), leaveRequest.getEndDate()));
        } catch (Exception ex) {
            log.warn("Failed to publish LeaveRequestCancelledEvent for {}: {}",
                    leaveRequest.getId(), ex.getMessage());
        }

        if (kafkaEnabled) {
            try {
                UUID tid = leaveRequest.getTenantId();
                String ltName = leaveTypeRepository.findById(leaveRequest.getLeaveTypeId())
                        .map(LeaveType::getName).orElse(null);
                LeaveCancelledEvent event = new LeaveCancelledEvent(
                        leaveRequest.getId(),
                        employeeId,
                        tid,
                        leaveRequest.getApproverId(),
                        ltName,
                        leaveRequest.getStartDate(),
                        leaveRequest.getEndDate(),
                        reason,
                        Instant.now(),
                        resolveName(employeeId, tid),
                        resolveEmail(employeeId, tid),
                        resolveEmail(leaveRequest.getApproverId(), tid),
                        resolveName(leaveRequest.getApproverId(), tid)
                );
                kafkaTemplate.send(TOPIC_LEAVE_CANCELLED, tid.toString(), event);
            } catch (Exception e) {
                log.warn("Failed to publish {} for leaveRequest={}: {}",
                        TOPIC_LEAVE_CANCELLED, requestId, e.getMessage());
            }
        }

        log.info("Leave request {} cancelled successfully", requestId);
    }

    @Transactional(readOnly = true)
    public PageResponse<LeaveRequestResponse> getMyLeaves(UUID employeeId, Pageable pageable) {
        log.debug("Fetching leave requests for employee={}", employeeId);
        Page<LeaveRequest> page = leaveRequestRepository.findByEmployeeId(employeeId, pageable);
        return PageResponse.from(page, this::toResponseWithTypeName);
    }

    /** Tenant-wide pending queue for admin/HR — every PENDING leave in the tenant (RLS scopes). */
    @Transactional(readOnly = true)
    public PageResponse<LeaveRequestResponse> getAllPending(Pageable pageable) {
        Page<LeaveRequest> page = leaveRequestRepository.findAllPending(pageable);
        return PageResponse.from(page, this::toResponseWithTypeName);
    }

    @Transactional(readOnly = true)
    public PageResponse<LeaveRequestResponse> getPendingApprovalsForManager(UUID managerId, Pageable pageable) {
        // Broadened match: also returns leaves whose applicant's current
        // reporting_manager_id or department head is `managerId`, not just
        // those whose approver_id column was frozen to `managerId` at apply
        // time. This prevents the "2nd leave never shows up" symptom that
        // fires when the applicant's manager assignment changes between two
        // applications, or when the apply-time fallback chain resolves to a
        // different UUID (audit fix: leave-approval-invisibility).
        log.debug("Fetching pending approvals (L1) for manager={} (broadened match)", managerId);
        Page<LeaveRequest> page = leaveRequestRepository.findPendingForManager(managerId, pageable);
        return PageResponse.from(page, this::toResponseWithTypeName);
    }

    @Transactional(readOnly = true)
    public PageResponse<LeaveRequestResponse> getPendingL2Approvals(Pageable pageable) {
        log.debug("Fetching pending L2 (HR) approvals");
        Page<LeaveRequest> page = leaveRequestRepository
                .findByStatus(ApprovalStatus.PENDING_L2, pageable);
        return PageResponse.from(page, this::toResponseWithTypeName);
    }

    @Transactional(readOnly = true)
    public PageResponse<LeaveRequestResponse> getDecidedApprovalsForManager(UUID managerId, Pageable pageable) {
        log.debug("Fetching decided approvals history for manager={}", managerId);
        Page<LeaveRequest> page = leaveRequestRepository.findDecidedForManager(managerId, pageable);
        return PageResponse.from(page, this::toResponseWithTypeName);
    }

    @Transactional
    public LeaveRequestResponse approveL1(UUID requestId, UUID managerId, LeaveApprovalRequest approval) {
        log.info("L1 approval requestId={} managerId={} decision={}", requestId, managerId, approval.status());

        LeaveRequest req = leaveRequestRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveRequest", requestId));

        // Self-approval guard — see approveLeave for the reasoning.
        assertNotSelfApproval(req, managerId);

        if (req.getStatus() != ApprovalStatus.PENDING) {
            throw new BusinessRuleException(
                    "Leave request is not awaiting L1 approval (status=%s)".formatted(req.getStatus()),
                    "LEAVE_NOT_PENDING");
        }

        if (approval.status() == ApprovalStatus.REJECTED) {
            revertPendingBalance(req);
            req.setStatus(ApprovalStatus.REJECTED);
            req.setApproverId(managerId);
            req.setApproverComment(approval.comment());
            req.setApprovedAt(Instant.now());
            LeaveRequest saved = leaveRequestRepository.save(req);
            // Terminal decision — notify the employee. (L1 APPROVED escalates
            // to PENDING_L2 and does NOT notify the employee yet — they should
            // only see "approved" after L2 signs off.)
            publishLeaveDecidedSafely(saved, false, approval.comment());
            return toResponseWithTypeName(saved);
        }

        if (approval.status() != ApprovalStatus.APPROVED) {
            throw new BusinessRuleException("L1 decision must be APPROVED or REJECTED", "INVALID_APPROVAL_STATUS");
        }

        // L1 approved → escalate to L2
        req.setStatus(ApprovalStatus.PENDING_L2);
        req.setApproverId(managerId);
        req.setApproverComment(approval.comment());
        req.setApprovedAt(Instant.now());
        log.info("Leave requestId={} escalated to L2 (HR) approval", requestId);
        return toResponseWithTypeName(leaveRequestRepository.save(req));
    }

    @Transactional
    public LeaveRequestResponse approveL2(UUID requestId, UUID hrUserId, LeaveApprovalRequest approval) {
        log.info("L2 approval requestId={} hrUserId={} decision={}", requestId, hrUserId, approval.status());

        LeaveRequest req = leaveRequestRepository.findById(requestId)
                .orElseThrow(() -> new ResourceNotFoundException("LeaveRequest", requestId));

        // Self-approval guard — see approveLeave for the reasoning. Also
        // blocks the L1 approver from also signing off L2 (impersonating
        // hrUserId as themselves) — that is already prevented by the
        // preAuthorize on the controller, but the applicant==actor case is
        // the one this guard specifically closes.
        assertNotSelfApproval(req, hrUserId);

        if (req.getStatus() != ApprovalStatus.PENDING_L2) {
            throw new BusinessRuleException(
                    "Leave request is not awaiting L2 approval (status=%s)".formatted(req.getStatus()),
                    "LEAVE_NOT_PENDING_L2");
        }

        req.setL2ApproverId(hrUserId);
        req.setL2ApproverComment(approval.comment());
        req.setL2ApprovedAt(Instant.now());

        LeaveBalance balance = leaveBalanceRepository
                .findByEmployeeIdAndLeaveTypeIdAndYear(
                        req.getEmployeeId(), req.getLeaveTypeId(), req.getStartDate().getYear())
                .orElseThrow(() -> new BusinessRuleException("Leave balance not found", "LEAVE_BALANCE_NOT_FOUND"));

        if (approval.status() == ApprovalStatus.APPROVED) {
            balance.setUsed(balance.getUsed() + req.getTotalDays());
            balance.setPending(balance.getPending() - req.getTotalDays());
            req.setStatus(ApprovalStatus.APPROVED);
            log.info("Leave FULLY APPROVED (L2): employee={}", req.getEmployeeId());
        } else if (approval.status() == ApprovalStatus.REJECTED) {
            revertPendingBalance(req, balance);
            req.setStatus(ApprovalStatus.REJECTED);
            log.info("Leave REJECTED at L2: employee={}", req.getEmployeeId());
        } else {
            throw new BusinessRuleException("L2 decision must be APPROVED or REJECTED", "INVALID_APPROVAL_STATUS");
        }

        leaveBalanceRepository.save(balance);
        LeaveRequest saved = leaveRequestRepository.save(req);
        publishLeaveDecidedSafely(saved, saved.getStatus() == ApprovalStatus.APPROVED, approval.comment());
        return toResponseWithTypeName(saved);
    }

    /**
     * Rejects a decision when the actor is the same employee as the leave's
     * applicant. Called from every approval path (approveLeave / approveL1 /
     * approveL2). Throws BusinessRuleException with code SELF_APPROVAL_NOT_ALLOWED
     * — the intent is a 403-style refusal (a policy violation, not an input
     * shape problem) surfaced with an actionable message the UI can render.
     */
    private void assertNotSelfApproval(LeaveRequest req, UUID actorEmployeeId) {
        if (actorEmployeeId != null && actorEmployeeId.equals(req.getEmployeeId())) {
            throw new BusinessRuleException(
                    "You cannot approve your own leave request",
                    "SELF_APPROVAL_NOT_ALLOWED");
        }
    }

    /** Best-effort publish of the notification event — never propagates. */
    private void publishLeaveDecidedSafely(LeaveRequest req, boolean approved, String comment) {
        try {
            String ltName = leaveTypeRepository.findById(req.getLeaveTypeId())
                    .map(LeaveType::getName).orElse(null);
            eventPublisher.publishEvent(new LeaveDecidedEvent(
                    req.getId(),
                    req.getEmployeeId(),
                    req.getTenantId(),
                    approved,
                    ltName,
                    req.getStartDate(),
                    req.getEndDate(),
                    comment));
        } catch (Exception ex) {
            log.warn("Failed to publish LeaveDecidedEvent for {}: {}", req.getId(), ex.getMessage());
        }
    }

    private void revertPendingBalance(LeaveRequest req) {
        leaveBalanceRepository.findByEmployeeIdAndLeaveTypeIdAndYear(
                req.getEmployeeId(), req.getLeaveTypeId(), req.getStartDate().getYear())
                .ifPresent(b -> {
                    b.setPending(b.getPending() - req.getTotalDays());
                    leaveBalanceRepository.save(b);
                });
    }

    private void revertPendingBalance(LeaveRequest req, LeaveBalance balance) {
        balance.setPending(balance.getPending() - req.getTotalDays());
    }

    @Transactional(readOnly = true)
    public List<LeaveBalanceResponse> getMyBalances(UUID employeeId, int year) {
        log.debug("Fetching leave balances for employee={} year={}", employeeId, year);
        List<LeaveBalance> balances = leaveBalanceRepository.findByEmployeeIdAndYear(employeeId, year);
        return balances.stream()
                .map(balance -> {
                    String leaveTypeName = leaveTypeRepository.findById(balance.getLeaveTypeId())
                            .map(LeaveType::getName)
                            .orElse(null);
                    LeaveBalanceResponse response = leaveBalanceMapper.toResponse(balance);
                    return new LeaveBalanceResponse(
                            response.id(),
                            response.employeeId(),
                            response.leaveTypeId(),
                            leaveTypeName,
                            response.year(),
                            response.totalEntitlement(),
                            response.used(),
                            response.pending(),
                            response.carryForward(),
                            response.available()
                    );
                })
                .collect(Collectors.toList());
    }

    @Transactional
    public void initLeaveBalances(UUID employeeId, UUID companyId, UUID tenantId, int year) {
        log.info("Initialising leave balances for employee={} company={} year={}", employeeId, companyId, year);
        List<LeaveType> activeLeaveTypes = leaveTypeRepository.findByCompanyIdAndActiveTrue(companyId);

        for (LeaveType leaveType : activeLeaveTypes) {
            boolean exists = leaveBalanceRepository
                    .findByEmployeeIdAndLeaveTypeIdAndYear(employeeId, leaveType.getId(), year)
                    .isPresent();
            if (!exists) {
                LeaveBalance balance = new LeaveBalance();
                balance.setTenantId(tenantId);
                balance.setEmployeeId(employeeId);
                balance.setLeaveTypeId(leaveType.getId());
                balance.setYear(year);
                balance.setTotalEntitlement(leaveType.getAnnualEntitlement());
                balance.setUsed(0);
                balance.setPending(0);
                balance.setCarryForward(0);
                leaveBalanceRepository.save(balance);
                log.debug("Created leave balance for employee={} leaveType={}", employeeId, leaveType.getCode());
            }
        }
        log.info("Leave balance initialisation complete for employee={}", employeeId);
    }

    // ---- Private helpers ----

    private Set<LocalDate> fetchHolidayDates(UUID companyId, LocalDate startDate, LocalDate endDate) {
        int startYear = startDate.getYear();
        int endYear = endDate.getYear();

        if (startYear == endYear) {
            return holidayCalendarRepository.findByCompanyIdAndYear(companyId, startYear)
                    .stream()
                    .map(h -> h.getHolidayDate())
                    .collect(Collectors.toSet());
        }

        // Span across years
        Set<LocalDate> allHolidays = holidayCalendarRepository.findByCompanyIdAndYear(companyId, startYear)
                .stream()
                .map(h -> h.getHolidayDate())
                .collect(Collectors.toSet());
        allHolidays.addAll(
                holidayCalendarRepository.findByCompanyIdAndYear(companyId, endYear)
                        .stream()
                        .map(h -> h.getHolidayDate())
                        .collect(Collectors.toSet())
        );
        return allHolidays;
    }

    private double calculateWorkingDays(LocalDate startDate, LocalDate endDate,
                                        com.hrms.leave.enums.LeaveDuration duration,
                                        Set<LocalDate> holidays) {
        long workingDays = startDate.datesUntil(endDate.plusDays(1))
                .filter(date -> !isWeekend(date))
                .filter(date -> !holidays.contains(date))
                .count();

        if (workingDays == 0) {
            return 0;
        }

        // For half-day requests, count only the first working day as 0.5
        if (duration == com.hrms.leave.enums.LeaveDuration.HALF_DAY_MORNING
                || duration == com.hrms.leave.enums.LeaveDuration.HALF_DAY_AFTERNOON) {
            return 0.5;
        }

        return (double) workingDays;
    }

    private boolean isWeekend(LocalDate date) {
        DayOfWeek day = date.getDayOfWeek();
        return day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY;
    }

    private LeaveRequestResponse toResponseWithTypeName(LeaveRequest request) {
        String leaveTypeName = leaveTypeRepository.findById(request.getLeaveTypeId())
                .map(LeaveType::getName)
                .orElse(null);
        LeaveRequestResponse base = leaveRequestMapper.toResponse(request);
        return new LeaveRequestResponse(
                base.id(),
                base.employeeId(),
                base.employeeName(),
                base.employeeCode(),
                base.departmentName(),
                base.leaveTypeId(),
                leaveTypeName,
                base.startDate(),
                base.endDate(),
                base.totalDays(),
                base.reason(),
                base.status(),
                base.approverComment(),
                base.approvedAt(),
                base.createdAt()
        );
    }
}
