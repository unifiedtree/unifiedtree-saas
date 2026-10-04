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
import com.unifiedtree.notifications.events.WfhCancelledEvent;
import com.unifiedtree.notifications.events.WfhDecidedEvent;
import com.unifiedtree.notifications.events.WfhRequestSubmittedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.hrms.leave.dto.WfhBatchRequest;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
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
    private final ApplicationEventPublisher eventPublisher;

    public WfhService(WfhRequestRepository repository,
                      ApplicationEventPublisher eventPublisher) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Takes a per-person lock for {@link #applyBatch}, so a double-clicked send
     * can't slip two overlapping batches past the overlap check. Optional: the
     * batch still works (as single requests always have) without it.
     */
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setJdbcTemplate(org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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

        // In-process notification fan-out → notif.notifications (see
        // DomainEventListener). AFTER_COMMIT, so a rollback here leaves no
        // phantom notification. Wrapped so a fan-out failure never fails apply.
        try {
            eventPublisher.publishEvent(new WfhRequestSubmittedEvent(
                    saved.getId(), employeeId, approverId, saved.getTenantId(),
                    saved.getFromDate(), saved.getToDate()));
        } catch (Exception ex) {
            log.warn("Failed to publish WfhRequestSubmittedEvent for {}: {}", saved.getId(), ex.getMessage());
        }
        return toResponse(saved);
    }

    /**
     * Several days from home in one send (BW-35). The days are split into runs
     * of consecutive calendar days, and each run is stored as one request, as if
     * sent on its own: the same rules, the same approver and the same overlap
     * check. Everything happens in one transaction, so either every day is
     * requested or none is, and the approver gets one notification for the lot.
     * A batch that is a single run is announced exactly like a single request.
     *
     * @param dates      the days asked for, in any order (repeats are ignored)
     * @param approverId resolved by the controller (ApproverChainService), never null
     * @return the requests created, earliest first
     */
    @Transactional
    public List<WfhRequestResponse> applyBatch(UUID employeeId, Collection<LocalDate> dates,
                                               String reason, UUID approverId) {
        if (employeeId == null) {
            throw new BusinessRuleException("Employee id is required", "EMPLOYEE_REQUIRED");
        }
        List<LocalDate> days = dates == null ? List.of()
                : dates.stream().filter(Objects::nonNull).distinct().sorted().toList();
        if (days.isEmpty()) {
            throw new BusinessRuleException("Pick at least one day", "INVALID_DATES");
        }
        if (days.size() > WfhBatchRequest.MAX_DAYS) {
            throw new BusinessRuleException("Pick at most 31 days in one request.", "WFH_TOO_MANY_DAYS");
        }
        // The single request's planning horizon, for every run.
        if (days.get(days.size() - 1).isAfter(LocalDate.now(java.time.ZoneOffset.UTC).plusDays(365))) {
            throw new BusinessRuleException(
                    "Start date must be within one year from today.",
                    "WFH_START_TOO_FAR");
        }
        if (approverId == null) {
            throw new BusinessRuleException(
                    "No approver available — assign this employee a reporting manager, "
                            + "set a department head, or add an HR manager before applying for WFH",
                    "NO_APPROVER_AVAILABLE");
        }
        lockRequestsOf(employeeId);

        List<LocalDate[]> runs = runsOf(days);
        for (LocalDate[] run : runs) {
            List<WfhRequest> overlaps = repository
                    .findByEmployeeIdAndStatusInAndFromDateLessThanEqualAndToDateGreaterThanEqual(
                            employeeId,
                            List.of(ApprovalStatus.PENDING, ApprovalStatus.APPROVED),
                            run[1],
                            run[0]);
            if (!overlaps.isEmpty()) {
                throw new BusinessRuleException(
                        "You already have a WFH request that overlaps " + describe(run) + ".",
                        "WFH_OVERLAP");
            }
        }

        List<WfhRequest> saved = new ArrayList<>();
        for (LocalDate[] run : runs) {
            WfhRequest entity = new WfhRequest();
            entity.setTenantId(TenantContext.getTenantId());
            entity.setEmployeeId(employeeId);
            entity.setFromDate(run[0]);
            entity.setToDate(run[1]);
            entity.setReason(reason);
            entity.setStatus(ApprovalStatus.PENDING);
            entity.setApproverId(approverId);
            saved.add(repository.save(entity));
        }
        log.info("WFH batch requested employee={} approver={} days={} requests={}",
                employeeId, approverId, days.size(), saved.size());

        // One notification for the whole send (AFTER_COMMIT; a fan-out failure never fails the send).
        try {
            WfhRequest first = saved.get(0);
            if (saved.size() == 1) {
                eventPublisher.publishEvent(new WfhRequestSubmittedEvent(
                        first.getId(), employeeId, approverId, first.getTenantId(),
                        first.getFromDate(), first.getToDate()));
            } else {
                eventPublisher.publishEvent(new BatchSubmitted(
                        saved.stream().map(WfhRequest::getId).toList(), employeeId, approverId,
                        first.getTenantId(), runs));
            }
        } catch (Exception ex) {
            log.warn("Failed to publish the WFH batch notification for employee {}: {}", employeeId, ex.getMessage());
        }
        return saved.stream().map(this::toResponse).toList();
    }

    /**
     * Published once when a batch makes more than one request. The approver is
     * told about every day in one notification (the API's WfhBatchNotificationListener,
     * with the usual "wfh.submitted" wording).
     *
     * @param requestIds the requests created, earliest first
     * @param runs       each request's first and last day, in the same order
     */
    public record BatchSubmitted(List<UUID> requestIds, UUID employeeId, UUID approverId, UUID tenantId,
                                 List<LocalDate[]> runs) {}

    /** Sorted, distinct days → runs of consecutive calendar days, each as {first, last}. */
    public static List<LocalDate[]> runsOf(List<LocalDate> sortedDistinctDays) {
        List<LocalDate[]> runs = new ArrayList<>();
        LocalDate start = null;
        LocalDate end = null;
        for (LocalDate d : sortedDistinctDays) {
            if (start != null && d.equals(end.plusDays(1))) {
                end = d;
                continue;
            }
            if (start != null) runs.add(new LocalDate[] {start, end});
            start = d;
            end = d;
        }
        if (start != null) runs.add(new LocalDate[] {start, end});
        return runs;
    }

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    /** "30 Sep 2026", or "30 Sep 2026 to 2 Oct 2026". */
    public static String describe(LocalDate[] run) {
        return run[0].equals(run[1]) ? DAY.format(run[0]) : DAY.format(run[0]) + " to " + DAY.format(run[1]);
    }

    /** One batch per person at a time (released at commit); skipped when JDBC isn't wired. */
    private void lockRequestsOf(UUID employeeId) {
        if (jdbc == null) return;
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> null, "wfh-batch:" + employeeId);
    }

    /** The employee who filed a WFH request, or null if it isn't in this tenant. */
    @Transactional(readOnly = true)
    public UUID requesterOf(UUID requestId) {
        return repository.findById(requestId).map(WfhRequest::getEmployeeId).orElse(null);
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
        // B4 CRIT FIX (audit 2026-08-15): assertNotSelfApproval — mirror the
        // LeaveService guard. Without this, a WFH request whose approver was
        // set to the employee (stale reporting_manager_id, or a corrupt row)
        // could be self-approved, giving unlimited work-from-anywhere.
        if (approverId != null && approverId.equals(entity.getEmployeeId())) {
            throw new BusinessRuleException(
                    "You cannot approve or reject your own WFH request.",
                    "WFH_SELF_APPROVAL");
        }
        entity.setStatus(decision);
        entity.setApproverId(approverId);
        entity.setDecidedAt(Instant.now());
        entity.setDecisionNote(comment);
        WfhRequest saved = repository.save(entity);
        log.info("WFH decided id={} decision={} approver={}", saved.getId(), decision, approverId);

        try {
            eventPublisher.publishEvent(new WfhDecidedEvent(
                    saved.getId(), saved.getEmployeeId(), saved.getTenantId(),
                    decision == ApprovalStatus.APPROVED,
                    saved.getFromDate(), saved.getToDate(), comment));
        } catch (Exception ex) {
            log.warn("Failed to publish WfhDecidedEvent for {}: {}", saved.getId(), ex.getMessage());
        }
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
        WfhRequest saved = repository.save(entity);
        log.info("WFH cancelled id={} by employee={}", saved.getId(), employeeId);

        try {
            eventPublisher.publishEvent(new WfhCancelledEvent(
                    saved.getId(), employeeId, saved.getApproverId(), saved.getTenantId(),
                    saved.getFromDate(), saved.getToDate()));
        } catch (Exception ex) {
            log.warn("Failed to publish WfhCancelledEvent for {}: {}", saved.getId(), ex.getMessage());
        }
    }

    @Transactional(readOnly = true)
    public PageResponse<WfhRequestResponse> getMyRequests(UUID employeeId, Pageable pageable) {
        Page<WfhRequest> page = repository.findByEmployeeIdOrderByFromDateDesc(employeeId, pageable);
        return PageResponse.from(page, this::toResponse);
    }

    /** Tenant-wide pending WFH queue for admin/HR. RLS scopes to the caller's tenant. */
    @Transactional(readOnly = true)
    public PageResponse<WfhRequestResponse> getAllPending(Pageable pageable) {
        Page<WfhRequest> page = repository.findAllPending(pageable);
        return PageResponse.from(page, this::toResponse);
    }

    /** {@link #getAllPending(Pageable)} as {@code approverEmployeeId}'s queue: without their own requests. Null leaves nothing out. */
    @Transactional(readOnly = true)
    public PageResponse<WfhRequestResponse> getAllPending(UUID approverEmployeeId, Pageable pageable) {
        if (approverEmployeeId == null) return getAllPending(pageable);
        Page<WfhRequest> page = repository.findAllPendingExcept(approverEmployeeId, pageable);
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
                w.getCreatedAt(),
                null);      // approverName — filled in by WfhController.enrich*
    }
}
