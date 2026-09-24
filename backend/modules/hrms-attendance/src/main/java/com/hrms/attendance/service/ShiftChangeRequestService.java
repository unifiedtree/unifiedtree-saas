package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.notifications.events.ShiftChangeDecidedEvent;
import com.unifiedtree.notifications.events.ShiftChangeSubmittedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Shift-change request → HR-approve flow, backed by
 * {@code attendance.shift_change_requests} (V142/V143; also created by
 * {@code ShiftChangeRequestSchemaBootstrap} on databases where Flyway is off).
 * Raw JdbcTemplate rather than a JPA entity so schema validation can't fail if
 * the table doesn't exist yet. Every query filters by tenant_id explicitly.
 *
 * <p>The employee chooses the date the new shift starts. On approval the
 * requested shift is assigned from that date via
 * {@link EmployeeShiftService#assignShift} — never from whatever day the
 * approver happens to act. A request still pending after its start date has
 * expired: it is rejected automatically (nightly by
 * {@code ShiftChangeRequestExpiryJob}, and on the spot whenever someone acts on
 * it) and the employee applies again. Both submit + decision fan out
 * notifications through the standard event listener.
 */
@Service
public class ShiftChangeRequestService {

    private static final Logger log = LoggerFactory.getLogger(ShiftChangeRequestService.class);

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final int REASON_MIN = 10;
    private static final int REASON_MAX = 500;

    private final JdbcTemplate jdbc;
    private final EmployeeShiftService shiftService;
    private final ApplicationEventPublisher eventPublisher;

    public ShiftChangeRequestService(JdbcTemplate jdbc,
                                     EmployeeShiftService shiftService,
                                     ApplicationEventPublisher eventPublisher) {
        this.jdbc = jdbc;
        this.shiftService = shiftService;
        this.eventPublisher = eventPublisher;
    }

    /**
     * Thrown when someone approves a request whose start date has passed. The
     * request is rejected in the same transaction, which must COMMIT — see the
     * {@code noRollbackFor} on {@link #decide}.
     */
    public static class RequestExpiredException extends BusinessRuleException {
        public RequestExpiredException(String message) {
            super(message, "SHIFT_CHANGE_EXPIRED");
        }
    }

    private static final RowMapper<ShiftChangeRequestResponse> MAPPER = (rs, n) -> new ShiftChangeRequestResponse(
            rs.getObject("id", UUID.class),
            rs.getObject("employee_id", UUID.class),
            rs.getObject("current_shift_policy_id", UUID.class),
            rs.getString("current_shift_name"),
            rs.getObject("requested_shift_policy_id", UUID.class),
            rs.getString("requested_shift_name"),
            rs.getString("reason"),
            rs.getString("status"),
            rs.getObject("approver_id", UUID.class),
            rs.getString("decision_note"),
            rs.getTimestamp("decided_at") == null ? null : rs.getTimestamp("decided_at").toInstant(),
            rs.getTimestamp("created_at") == null ? null : rs.getTimestamp("created_at").toInstant(),
            rs.getObject("requested_effective_date", LocalDate.class),
            rs.getObject("applied_effective_date", LocalDate.class));

    private static final String SELECT = """
            SELECT scr.id, scr.employee_id, scr.current_shift_policy_id,
                   cur.name AS current_shift_name,
                   scr.requested_shift_policy_id, req.name AS requested_shift_name,
                   scr.reason, scr.status, scr.approver_id, scr.decision_note,
                   scr.decided_at, scr.created_at,
                   scr.requested_effective_date, scr.applied_effective_date
              FROM attendance.shift_change_requests scr
              LEFT JOIN attendance.shift_policies cur ON cur.id = scr.current_shift_policy_id
              LEFT JOIN attendance.shift_policies req ON req.id = scr.requested_shift_policy_id
            """;

    @Transactional
    public ShiftChangeRequestResponse create(UUID employeeId, CreateShiftChangeRequest req) {
        UUID tenantId = TenantContext.getTenantId();
        if (employeeId == null || tenantId == null || req.requestedShiftPolicyId() == null) {
            throw new BusinessRuleException("employee, tenant and requested shift are required", "SHIFT_CHANGE_INVALID");
        }
        String reason = req.reason() == null ? "" : req.reason().trim();
        if (reason.length() < REASON_MIN) {
            throw new BusinessRuleException(
                    "Please give a reason of at least %d characters.".formatted(REASON_MIN), "SHIFT_CHANGE_REASON_INVALID");
        }
        if (reason.length() > REASON_MAX) {
            throw new BusinessRuleException(
                    "Please keep the reason under %d characters.".formatted(REASON_MAX), "SHIFT_CHANGE_REASON_INVALID");
        }
        LocalDate today = today();
        // Null only from app builds that predate the date field; such a request
        // starts on the day it is approved.
        LocalDate startDate = req.effectiveDate();
        if (startDate != null) {
            requireStartDateInWindow(startDate, today);
            LocalDate scheduled = shiftService.nextAssignmentStartAfter(employeeId, startDate);
            if (scheduled != null) {
                throw new BusinessRuleException(
                        "Your shift is already scheduled to change on %s. Choose that date or a later one."
                                .formatted(fmt(scheduled)),
                        "SHIFT_CHANGE_DATE_CONFLICT");
            }
        }
        // Measure the request against the shift in force on the day it would
        // start: a request for next month is compared with next month's shift.
        LocalDate baselineDay = startDate != null ? startDate : today;
        UUID currentShiftId = shiftService.shiftPolicyIdOn(employeeId, baselineDay);
        if (req.requestedShiftPolicyId().equals(currentShiftId)) {
            throw new BusinessRuleException(baselineDay.equals(today)
                    ? "You are already on that shift."
                    : "You will already be on that shift on %s.".formatted(fmt(baselineDay)),
                    "SHIFT_CHANGE_SAME");
        }
        // An expired request of theirs must not block a fresh one; reject it
        // now rather than wait for the nightly run.
        expirePassed(tenantId, employeeId);
        // Block a second pending request for the same employee. The partial
        // unique index uq_scr_one_pending_per_employee (V143) backs this up
        // when two submits race past the count.
        Integer pending = jdbc.queryForObject(
                "SELECT COUNT(*) FROM attendance.shift_change_requests "
                        + "WHERE tenant_id = ? AND employee_id = ? AND status = 'PENDING'",
                Integer.class, tenantId, employeeId);
        if (pending != null && pending > 0) {
            throw pendingExists();
        }

        UUID id = UUID.randomUUID();
        try {
            jdbc.update("""
                    INSERT INTO attendance.shift_change_requests
                        (id, tenant_id, employee_id, current_shift_policy_id, requested_shift_policy_id,
                         reason, status, requested_effective_date)
                    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, id, tenantId, employeeId, currentShiftId, req.requestedShiftPolicyId(),
                    reason, startDate);
        } catch (DuplicateKeyException ex) {
            throw pendingExists();
        }
        log.info("Shift-change request {} created: employee={} -> shift={} from {}",
                id, employeeId, req.requestedShiftPolicyId(), startDate);

        ShiftChangeRequestResponse saved = getById(id);
        try {
            eventPublisher.publishEvent(new ShiftChangeSubmittedEvent(
                    id, employeeId, tenantId, saved != null ? saved.requestedShiftName() : null, startDate));
        } catch (Exception ex) {
            log.warn("Failed to publish ShiftChangeSubmittedEvent for {}: {}", id, ex.getMessage());
        }
        return saved;
    }

    @Transactional(readOnly = true)
    public List<ShiftChangeRequestResponse> listMine(UUID employeeId) {
        UUID tenantId = TenantContext.getTenantId();
        return jdbc.query(SELECT + " WHERE scr.tenant_id = ? AND scr.employee_id = ? ORDER BY scr.created_at DESC",
                MAPPER, tenantId, employeeId);
    }

    /** The employee who raised a request, or null if it doesn't exist in this tenant. */
    @Transactional(readOnly = true)
    public UUID requesterOf(UUID requestId) {
        ShiftChangeRequestResponse r = getById(requestId);
        return r == null ? null : r.employeeId();
    }

    /** Pending requests an approver can still act on — expired ones are left for the expiry run. */
    @Transactional(readOnly = true)
    public List<ShiftChangeRequestResponse> listPending() {
        UUID tenantId = TenantContext.getTenantId();
        return jdbc.query(SELECT + """
                 WHERE scr.tenant_id = ? AND scr.status = 'PENDING'
                   AND (scr.requested_effective_date IS NULL OR scr.requested_effective_date >= ?)
                 ORDER BY scr.created_at DESC
                """, MAPPER, tenantId, today());
    }

    /**
     * noRollbackFor: approving an expired request rejects it and then reports
     * SHIFT_CHANGE_EXPIRED — the rejection must survive the exception.
     */
    @Transactional(noRollbackFor = RequestExpiredException.class)
    public ShiftChangeRequestResponse decide(UUID requestId, UUID approverId, ShiftChangeDecisionRequest decision) {
        UUID tenantId = TenantContext.getTenantId();
        ShiftChangeRequestResponse existing = getById(requestId);
        if (existing == null) {
            throw new ResourceNotFoundException("ShiftChangeRequest", requestId);
        }
        // Same rule as leave: whoever resolves the approver chain can end up
        // holding their own request, and must not be able to decide it.
        if (approverId != null && approverId.equals(existing.employeeId())) {
            throw new BusinessRuleException("You cannot approve or reject your own shift change request",
                    "SELF_APPROVAL_NOT_ALLOWED");
        }
        if (!"PENDING".equals(existing.status())) {
            throw new BusinessRuleException("Request is not pending (current: " + existing.status() + ")", "SHIFT_CHANGE_NOT_PENDING");
        }
        LocalDate today = today();
        LocalDate requested = existing.requestedEffectiveDate();
        if (decision.approved() && requested != null && requested.isBefore(today)) {
            expire(tenantId, existing);
            throw new RequestExpiredException(
                    "This request expired: its start date (%s) passed before it was approved, so it has been rejected. The employee can apply again with a new date."
                            .formatted(fmt(requested)));
        }
        // The employee's date; a request from an older app build has none and
        // starts on the day it is approved, as those requests always did.
        LocalDate startDate = null;
        if (decision.approved()) {
            startDate = requested != null ? requested : today;
            LocalDate scheduled = shiftService.nextAssignmentStartAfter(existing.employeeId(), startDate);
            if (scheduled != null) {
                throw new BusinessRuleException(
                        "This employee's shift is already scheduled to change on %s, after the requested start %s. Reject this request, or ask the employee to apply again for a date on or after %s."
                                .formatted(fmt(scheduled), fmt(startDate), fmt(scheduled)),
                        "SHIFT_CHANGE_DATE_CONFLICT");
            }
        }
        String newStatus = decision.approved() ? "APPROVED" : "REJECTED";
        // status = 'PENDING' in the WHERE: of two approvers acting at once only
        // one may win. An approve and a reject racing used to leave the shift
        // assigned on a request that reads REJECTED.
        int updated = jdbc.update("""
                UPDATE attendance.shift_change_requests
                   SET status = ?, approver_id = ?, decision_note = ?, applied_effective_date = ?,
                       decided_at = now(), updated_at = now()
                 WHERE id = ? AND tenant_id = ? AND status = 'PENDING'
                """, newStatus, approverId, decision.comment(), startDate, requestId, tenantId);
        if (updated == 0) {
            throw new BusinessRuleException("This request has already been decided.", "SHIFT_CHANGE_NOT_PENDING");
        }

        // On approval, move the employee to the requested shift from the start date.
        if (decision.approved()) {
            shiftService.assignShift(existing.employeeId(),
                    new AssignShiftRequest(existing.requestedShiftPolicyId(), startDate));
        }
        log.info("Shift-change request {} {} by {} (starts {})", requestId, newStatus, approverId, startDate);

        ShiftChangeRequestResponse result = getById(requestId);
        publishDecided(tenantId, existing, decision.approved(), decision.comment(), startDate);
        return result;
    }

    /**
     * Rejects every request in this tenant still pending after its start date,
     * telling each employee to apply again. Called by the nightly expiry job
     * with the tenant bound (no request thread, so RLS needs the GUC here).
     */
    @Transactional
    public int expirePassedForTenant(UUID tenantId) {
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
        return expirePassed(tenantId, null);
    }

    /** Expire this tenant's passed pending requests — all of them, or one employee's. */
    private int expirePassed(UUID tenantId, UUID employeeId) {
        List<ShiftChangeRequestResponse> stale = employeeId == null
                ? jdbc.query(SELECT + """
                         WHERE scr.tenant_id = ? AND scr.status = 'PENDING' AND scr.requested_effective_date < ?
                         FOR UPDATE OF scr SKIP LOCKED
                        """, MAPPER, tenantId, today())
                : jdbc.query(SELECT + """
                         WHERE scr.tenant_id = ? AND scr.employee_id = ? AND scr.status = 'PENDING'
                           AND scr.requested_effective_date < ?
                         FOR UPDATE OF scr SKIP LOCKED
                        """, MAPPER, tenantId, employeeId, today());
        int expired = 0;
        for (ShiftChangeRequestResponse r : stale) {
            if (expire(tenantId, r)) expired++;
        }
        return expired;
    }

    private boolean expire(UUID tenantId, ShiftChangeRequestResponse r) {
        String note = "Expired: the start date (%s) passed before this request was approved. Please apply again with a new date."
                .formatted(fmt(r.requestedEffectiveDate()));
        int updated = jdbc.update("""
                UPDATE attendance.shift_change_requests
                   SET status = 'REJECTED', decision_note = ?, decided_at = now(), updated_at = now()
                 WHERE id = ? AND tenant_id = ? AND status = 'PENDING'
                """, note, r.id(), tenantId);
        if (updated == 0) return false;
        log.info("Shift-change request {} expired (start date {} passed while pending)", r.id(), r.requestedEffectiveDate());
        publishDecided(tenantId, r, false, note, null);
        return true;
    }

    private void publishDecided(UUID tenantId, ShiftChangeRequestResponse r, boolean approved, String comment,
                                LocalDate startDate) {
        try {
            eventPublisher.publishEvent(new ShiftChangeDecidedEvent(
                    r.id(), r.employeeId(), tenantId, approved, r.requestedShiftName(), comment, startDate));
        } catch (Exception ex) {
            log.warn("Failed to publish ShiftChangeDecidedEvent for {}: {}", r.id(), ex.getMessage());
        }
    }

    /**
     * Today or later, and within a year. A far-future typo (2062 for 2026)
     * would otherwise open an assignment that blocks every later reassignment
     * of this employee until that date.
     */
    private static void requireStartDateInWindow(LocalDate date, LocalDate today) {
        if (date.isBefore(today)) {
            throw new BusinessRuleException("The start date cannot be in the past.", "SHIFT_CHANGE_DATE_PAST");
        }
        if (date.isAfter(today.plusYears(1))) {
            throw new BusinessRuleException("Choose a start date within the next 12 months.", "SHIFT_CHANGE_DATE_TOO_FAR");
        }
    }

    private static BusinessRuleException pendingExists() {
        return new BusinessRuleException("You already have a pending shift change request.", "SHIFT_CHANGE_PENDING_EXISTS");
    }

    private static LocalDate today() {
        return LocalDate.now(IST);
    }

    private static String fmt(LocalDate d) {
        return DATE_FMT.format(d);
    }

    private ShiftChangeRequestResponse getById(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        List<ShiftChangeRequestResponse> rows = jdbc.query(
                SELECT + " WHERE scr.id = ? AND scr.tenant_id = ?", MAPPER, id, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
