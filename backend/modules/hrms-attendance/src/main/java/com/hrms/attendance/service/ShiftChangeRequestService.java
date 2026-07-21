package com.hrms.attendance.service;

import com.hrms.attendance.dto.ShiftDtos.CreateShiftChangeRequest;
import com.hrms.attendance.dto.ShiftDtos.EmployeeShiftResponse;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Shift-change request → HR-approve flow, backed by
 * {@code attendance.shift_change_requests} (created by
 * {@code ShiftChangeRequestSchemaBootstrap} — Flyway is off here). Raw
 * JdbcTemplate rather than a JPA entity so schema validation can't fail if the
 * table doesn't exist yet. Every query filters by tenant_id explicitly.
 *
 * <p>On approval the requested shift is actually assigned via
 * {@link EmployeeShiftService#assignShift}. Both submit + decision fan out
 * notifications through the standard event listener.
 */
@Service
public class ShiftChangeRequestService {

    private static final Logger log = LoggerFactory.getLogger(ShiftChangeRequestService.class);

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
            rs.getTimestamp("created_at") == null ? null : rs.getTimestamp("created_at").toInstant());

    private static final String SELECT = """
            SELECT scr.id, scr.employee_id, scr.current_shift_policy_id,
                   cur.name AS current_shift_name,
                   scr.requested_shift_policy_id, req.name AS requested_shift_name,
                   scr.reason, scr.status, scr.approver_id, scr.decision_note,
                   scr.decided_at, scr.created_at
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
        EmployeeShiftResponse current = shiftService.getCurrentShift(employeeId);
        UUID currentShiftId = current != null ? current.shiftPolicyId() : null;
        if (req.requestedShiftPolicyId().equals(currentShiftId)) {
            throw new BusinessRuleException("You are already on that shift.", "SHIFT_CHANGE_SAME");
        }
        // Block a second pending request for the same employee.
        Integer pending = jdbc.queryForObject(
                "SELECT COUNT(*) FROM attendance.shift_change_requests "
                        + "WHERE tenant_id = ? AND employee_id = ? AND status = 'PENDING'",
                Integer.class, tenantId, employeeId);
        if (pending != null && pending > 0) {
            throw new BusinessRuleException("You already have a pending shift change request.", "SHIFT_CHANGE_PENDING_EXISTS");
        }

        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.shift_change_requests
                    (id, tenant_id, employee_id, current_shift_policy_id, requested_shift_policy_id, reason, status)
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
                """, id, tenantId, employeeId, currentShiftId, req.requestedShiftPolicyId(), req.reason());
        log.info("Shift-change request {} created: employee={} -> shift={}", id, employeeId, req.requestedShiftPolicyId());

        ShiftChangeRequestResponse saved = getById(id);
        try {
            eventPublisher.publishEvent(new ShiftChangeSubmittedEvent(
                    id, employeeId, tenantId, saved != null ? saved.requestedShiftName() : null));
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

    @Transactional(readOnly = true)
    public List<ShiftChangeRequestResponse> listPending() {
        UUID tenantId = TenantContext.getTenantId();
        return jdbc.query(SELECT + " WHERE scr.tenant_id = ? AND scr.status = 'PENDING' ORDER BY scr.created_at DESC",
                MAPPER, tenantId);
    }

    @Transactional
    public ShiftChangeRequestResponse decide(UUID requestId, UUID approverId, ShiftChangeDecisionRequest decision) {
        UUID tenantId = TenantContext.getTenantId();
        ShiftChangeRequestResponse existing = getById(requestId);
        if (existing == null) {
            throw new ResourceNotFoundException("ShiftChangeRequest", requestId);
        }
        if (!"PENDING".equals(existing.status())) {
            throw new BusinessRuleException("Request is not pending (current: " + existing.status() + ")", "SHIFT_CHANGE_NOT_PENDING");
        }
        String newStatus = decision.approved() ? "APPROVED" : "REJECTED";
        jdbc.update("""
                UPDATE attendance.shift_change_requests
                   SET status = ?, approver_id = ?, decision_note = ?, decided_at = now(), updated_at = now()
                 WHERE id = ? AND tenant_id = ?
                """, newStatus, approverId, decision.comment(), requestId, tenantId);

        // On approval, actually move the employee to the requested shift.
        if (decision.approved()) {
            shiftService.assignShift(existing.employeeId(),
                    new com.hrms.attendance.dto.ShiftDtos.AssignShiftRequest(existing.requestedShiftPolicyId(), null));
        }
        log.info("Shift-change request {} {} by {}", requestId, newStatus, approverId);

        ShiftChangeRequestResponse updated = getById(requestId);
        try {
            eventPublisher.publishEvent(new ShiftChangeDecidedEvent(
                    requestId, existing.employeeId(), tenantId, decision.approved(),
                    existing.requestedShiftName(), decision.comment()));
        } catch (Exception ex) {
            log.warn("Failed to publish ShiftChangeDecidedEvent for {}: {}", requestId, ex.getMessage());
        }
        return updated;
    }

    private ShiftChangeRequestResponse getById(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        List<ShiftChangeRequestResponse> rows = jdbc.query(
                SELECT + " WHERE scr.id = ? AND scr.tenant_id = ?", MAPPER, id, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
