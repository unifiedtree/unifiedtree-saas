package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest;
import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeDecisionRequest;
import com.hrms.attendance.dto.ShiftDtos.ShiftChangeRequestResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
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
 *
 * <p>"Until" (BW-31, V143.54): a request may carry {@code requested_end_date},
 * the last day on the new shift. Approving it assigns the new shift from the
 * start date, and the shift the person was on comes back the day after the end
 * date. No end date means permanent, as before. The column is read only where
 * it exists (a catalog check, which can't abort the caller's transaction), so
 * every read and a permanent request work as before while the migration is not
 * applied; asking for an end date then answers FEATURE_NOT_READY. The employee
 * can withdraw a request while it waits (BW-34): it becomes CANCELLED.
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
            rs.getString("employee_name"),
            rs.getString("employee_code"),
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
            rs.getObject("applied_effective_date", LocalDate.class),
            rs.getString("approver_name"),
            rs.getObject("requested_end_date", LocalDate.class));

    /** Today's SELECT; {@link #select()} adds the end date in front of FROM. */
    private static final String SELECT = """
            SELECT scr.id, scr.employee_id, scr.current_shift_policy_id,
                   COALESCE(NULLIF(concat_ws(' ', em.first_name, em.last_name), ''), emu.display_name, emu.email) AS employee_name,
                   em.employee_code AS employee_code,
                   cur.name AS current_shift_name,
                   scr.requested_shift_policy_id, req.name AS requested_shift_name,
                   scr.reason, scr.status, scr.approver_id, scr.decision_note,
                   scr.decided_at, scr.created_at,
                   scr.requested_effective_date, scr.applied_effective_date,
                   COALESCE(NULLIF(concat_ws(' ', ap.first_name, ap.last_name), ''), apu.display_name, apu.email) AS approver_name
            %s  FROM attendance.shift_change_requests scr
              LEFT JOIN attendance.shift_policies cur ON cur.id = scr.current_shift_policy_id
              LEFT JOIN attendance.shift_policies req ON req.id = scr.requested_shift_policy_id
              LEFT JOIN hrms.employees em ON em.id = scr.employee_id AND em.tenant_id = scr.tenant_id
              LEFT JOIN auth.user_credentials emu ON emu.employee_id = scr.employee_id AND emu.tenant_id = scr.tenant_id
              LEFT JOIN hrms.employees ap ON ap.id = scr.approver_id AND ap.tenant_id = scr.tenant_id
              LEFT JOIN auth.user_credentials apu ON apu.id = scr.approver_id AND apu.tenant_id = scr.tenant_id
            """;

    /** The row SELECT, with the end date where V143.54's column exists (else a NULL in its place). */
    private String select() {
        return SELECT.formatted(endDateColumnExists()
                ? "     , scr.requested_end_date\n"
                : "     , NULL::date AS requested_end_date\n");
    }

    /**
     * True when {@code attendance.shift_change_requests.requested_end_date}
     * (V143.54) exists. A catalog read: it never fails on a missing column, so
     * it can't abort the caller's transaction the way a failed SELECT would.
     * Asked every time rather than cached, so applying the migration by hand
     * takes effect without a restart.
     */
    boolean endDateColumnExists() {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM pg_attribute
                                WHERE attrelid = to_regclass('attendance.shift_change_requests')
                                  AND attname = 'requested_end_date' AND attnum > 0 AND NOT attisdropped)
                """, Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    @Transactional
    public ShiftChangeRequestResponse create(UUID employeeId, CreateShiftChangeRequest req) {
        UUID tenantId = TenantContext.getTenantId();
        if (employeeId == null || tenantId == null || req.requestedShiftPolicyId() == null) {
            throw new BusinessRuleException("employee, tenant and requested shift are required", "SHIFT_CHANGE_INVALID");
        }
        // "Until" needs V143.54's column. Without it the request is refused rather
        // than saved as a permanent change the employee didn't ask for.
        LocalDate endDate = req.endDate();
        if (endDate != null && !endDateColumnExists()) {
            throw new FeatureNotReady();
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
        if (endDate != null) {
            requireEndDateInWindow(startDate, endDate, today);
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
            if (endDate == null) {
                // A permanent change: exactly the row it always was.
                jdbc.update("""
                        INSERT INTO attendance.shift_change_requests
                            (id, tenant_id, employee_id, current_shift_policy_id, requested_shift_policy_id,
                             reason, status, requested_effective_date)
                        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
                        """, id, tenantId, employeeId, currentShiftId, req.requestedShiftPolicyId(),
                        reason, startDate);
            } else {
                // Guarded: if the column vanished since the check, still never a permanent change.
                FeatureNotReady.run(() -> jdbc.update("""
                        INSERT INTO attendance.shift_change_requests
                            (id, tenant_id, employee_id, current_shift_policy_id, requested_shift_policy_id,
                             reason, status, requested_effective_date, requested_end_date)
                        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
                        """, id, tenantId, employeeId, currentShiftId, req.requestedShiftPolicyId(),
                        reason, startDate, endDate));
            }
        } catch (DuplicateKeyException ex) {
            throw pendingExists();
        }
        log.info("Shift-change request {} created: employee={} -> shift={} from {} until {}",
                id, employeeId, req.requestedShiftPolicyId(), startDate, endDate);

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
        return jdbc.query(select() + " WHERE scr.tenant_id = ? AND scr.employee_id = ? ORDER BY scr.created_at DESC",
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
        return jdbc.query(select() + """
                 WHERE scr.tenant_id = ? AND scr.status = 'PENDING'
                   AND (scr.requested_effective_date IS NULL OR scr.requested_effective_date >= ?)
                 ORDER BY scr.created_at DESC
                """, MAPPER, tenantId, today());
    }

    /** Longest look-back the "Already decided" list serves. */
    public static final int MAX_DECIDED_DAYS = 365;
    /** Most rows the "Already decided" list returns. */
    public static final int MAX_DECIDED_ROWS = 200;

    /**
     * Requests approved or rejected (including the ones that expired) in the
     * last {@code days} days, newest decision first, with who decided and
     * their note. Feeds HR's "Already decided" list; the caller narrows it to
     * the approver's team.
     */
    @Transactional(readOnly = true)
    public List<ShiftChangeRequestResponse> listDecided(int days) {
        UUID tenantId = TenantContext.getTenantId();
        int window = Math.max(1, Math.min(days, MAX_DECIDED_DAYS));
        return jdbc.query(select() + """
                 WHERE scr.tenant_id = ? AND scr.status IN ('APPROVED', 'REJECTED')
                   AND scr.decided_at >= now() - make_interval(days => ?)
                 ORDER BY scr.decided_at DESC, scr.created_at DESC
                 LIMIT\s""" + MAX_DECIDED_ROWS  /* \s: a text block drops the trailing space, which made "LIMIT200" */, MAPPER, tenantId, window);
    }

    /**
     * {@link #listDecided(int)} for a range of days instead of the days-back
     * window (calendar everywhere, 7 Oct 2026): requests approved or rejected
     * whose effective date (the one applied, else the one asked for) is in
     * [from, to], newest decision first, at most {@link #MAX_DECIDED_ROWS}.
     */
    @Transactional(readOnly = true)
    public List<ShiftChangeRequestResponse> listDecided(java.time.LocalDate from, java.time.LocalDate to) {
        UUID tenantId = TenantContext.getTenantId();
        return jdbc.query(select() + """
                 WHERE scr.tenant_id = ? AND scr.status IN ('APPROVED', 'REJECTED')
                   AND COALESCE(scr.applied_effective_date, scr.requested_effective_date) BETWEEN ? AND ?
                 ORDER BY scr.decided_at DESC, scr.created_at DESC
                 LIMIT\s""" + MAX_DECIDED_ROWS, MAPPER, tenantId, from, to);
    }

    /**
     * The note kept with the assignment an approval creates, shown in the
     * employee's shift history: the employee's reason, cut to the column's 500
     * characters.
     */
    static String assignmentNote(String reason) {
        String base = "Approved shift change request";
        if (reason == null || reason.isBlank()) return base;
        String note = base + ": " + reason.trim();
        return note.length() > 500 ? note.substring(0, 500) : note;
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
        // A temporary change (BW-31): its last day, and the shift to go back to after it.
        LocalDate endDate = existing.requestedEndDate();
        UUID backTo = null;
        if (decision.approved()) {
            startDate = requested != null ? requested : today;
            LocalDate scheduled = shiftService.nextAssignmentStartAfter(existing.employeeId(), startDate);
            if (scheduled != null) {
                throw new BusinessRuleException(
                        "This employee's shift is already scheduled to change on %s, after the requested start %s. Reject this request, or ask the employee to apply again for a date on or after %s."
                                .formatted(fmt(scheduled), fmt(startDate), fmt(scheduled)),
                        "SHIFT_CHANGE_DATE_CONFLICT");
            }
            if (endDate != null) {
                if (endDate.isBefore(startDate)) {
                    throw new BusinessRuleException(
                            "This request ends on %s, before it would start (%s). Reject it, and ask the employee to apply again."
                                    .formatted(fmt(endDate), fmt(startDate)),
                            "SHIFT_CHANGE_END_BEFORE_START");
                }
                // Nothing is scheduled after the start (checked above), so the shift
                // in force on the start day is the one the person would be on after
                // the end date too.
                backTo = shiftService.shiftPolicyIdOn(existing.employeeId(), startDate);
                if (backTo != null && !backTo.equals(existing.requestedShiftPolicyId()) && !shiftIsActive(tenantId, backTo)) {
                    throw new BusinessRuleException(
                            "This employee's current shift has been archived, so they can't go back to it on %s. Reject this request, or restore that shift first."
                                    .formatted(fmt(endDate.plusDays(1))),
                            "SHIFT_CHANGE_RESTORE_INACTIVE");
                }
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
                    new AssignShiftRequest(existing.requestedShiftPolicyId(), startDate, assignmentNote(existing.reason())));
            if (endDate != null) {
                applyEnd(existing, startDate, endDate, backTo);
            }
        }
        log.info("Shift-change request {} {} by {} (starts {}, until {})", requestId, newStatus, approverId, startDate,
                decision.approved() ? endDate : null);

        ShiftChangeRequestResponse result = getById(requestId);
        publishDecided(tenantId, existing, decision.approved(), decision.comment(), startDate);
        return result;
    }

    /**
     * The end of an approved temporary change. With a shift to go back to, it is
     * assigned from the day after the end date, which closes the new assignment
     * on the end date (the same close-and-open every reassignment does). Someone
     * who had no shift before the change has none again after it: the new
     * assignment just ends on the end date. Runs in {@link #decide}'s
     * transaction, so a failure here undoes the whole approval.
     */
    private void applyEnd(ShiftChangeRequestResponse request, LocalDate startDate, LocalDate endDate, UUID backTo) {
        if (backTo == null) {
            shiftService.endAssignment(request.employeeId(), request.requestedShiftPolicyId(), startDate, endDate);
        } else if (!backTo.equals(request.requestedShiftPolicyId())) {
            shiftService.assignShift(request.employeeId(),
                    new AssignShiftRequest(backTo, endDate.plusDays(1), backNote(endDate)));
        }
        // backTo == the requested shift: the person is on it before and after, so nothing ends.
    }

    /** The note on the assignment that brings the previous shift back, shown in the shift history. */
    static String backNote(LocalDate endDate) {
        return "Back from a temporary shift change that ended on " + fmt(endDate);
    }

    private boolean shiftIsActive(UUID tenantId, UUID shiftPolicyId) {
        List<Boolean> active = jdbc.queryForList(
                "SELECT is_active FROM attendance.shift_policies WHERE id = ? AND tenant_id = ?",
                Boolean.class, shiftPolicyId, tenantId);
        return !active.isEmpty() && Boolean.TRUE.equals(active.get(0));
    }

    /**
     * The employee withdraws their own request while it is still waiting
     * (BW-34). It becomes CANCELLED, stays in their list, leaves the approvers'
     * queue, and frees them to send another. Nothing else changes: no shift was
     * assigned while it waited.
     */
    @Transactional
    public ShiftChangeRequestResponse withdraw(UUID requestId, UUID employeeId) {
        UUID tenantId = TenantContext.getTenantId();
        ShiftChangeRequestResponse existing = getById(requestId);
        if (existing == null) {
            throw new ResourceNotFoundException("ShiftChangeRequest", requestId);
        }
        if (employeeId == null || !employeeId.equals(existing.employeeId())) {
            throw new BusinessRuleException("You can withdraw only your own shift change request.", "SHIFT_CHANGE_NOT_YOURS");
        }
        if (!"PENDING".equals(existing.status())) {
            throw new BusinessRuleException("Only a request that is still waiting can be withdrawn.", "SHIFT_CHANGE_NOT_PENDING");
        }
        // status = 'PENDING' in the WHERE: an approver deciding at the same moment wins or loses as a whole.
        int updated = jdbc.update("""
                UPDATE attendance.shift_change_requests
                   SET status = 'CANCELLED', decided_at = now(), updated_at = now()
                 WHERE id = ? AND tenant_id = ? AND employee_id = ? AND status = 'PENDING'
                """, requestId, tenantId, employeeId);
        if (updated == 0) {
            throw new BusinessRuleException("This request has already been decided.", "SHIFT_CHANGE_NOT_PENDING");
        }
        log.info("Shift-change request {} withdrawn by employee {}", requestId, employeeId);
        return getById(requestId);
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
                ? jdbc.query(select() + """
                         WHERE scr.tenant_id = ? AND scr.status = 'PENDING' AND scr.requested_effective_date < ?
                         FOR UPDATE OF scr SKIP LOCKED
                        """, MAPPER, tenantId, today())
                : jdbc.query(select() + """
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

    /**
     * "Until" needs a start date, comes on or after it, and stays within a year
     * of today: like a far-future start, a typo'd end date would put an
     * assignment far ahead that blocks every earlier reassignment.
     */
    private static void requireEndDateInWindow(LocalDate startDate, LocalDate endDate, LocalDate today) {
        if (startDate == null) {
            throw new BusinessRuleException("Choose the first day on the new shift as well as the last.",
                    "SHIFT_CHANGE_END_NEEDS_START");
        }
        if (endDate.isBefore(startDate)) {
            throw new BusinessRuleException("The last day can't be before the first day.", "SHIFT_CHANGE_END_BEFORE_START");
        }
        if (endDate.isAfter(today.plusYears(1))) {
            throw new BusinessRuleException("Choose a last day within the next 12 months.", "SHIFT_CHANGE_END_TOO_FAR");
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
                select() + " WHERE scr.id = ? AND scr.tenant_id = ?", MAPPER, id, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
