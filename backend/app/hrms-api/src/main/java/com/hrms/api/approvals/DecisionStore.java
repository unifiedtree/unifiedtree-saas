package com.hrms.api.approvals;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * The JDBC side of approval Undo: what a request, and everything its decision
 * touches, looks like at one moment (a {@link Snapshot}); the checks that say a
 * decision has been used downstream; and the writes that put a request back
 * exactly as it was.
 *
 * <p>Every table here is an existing one (leave, WFH, attendance fixes, shift
 * changes, expense claims, balances, attendance records, shift assignments).
 * Nothing about their shape changes: rows are read as {@code to_jsonb} and put
 * back with {@code jsonb_populate_record}, so each column keeps its own type.
 * JPA-mapped rows get {@code version + 1} on every write, so a stale JPA copy
 * elsewhere fails its optimistic check instead of overwriting the Undo.
 * Every statement filters on {@code tenant_id} as well as row-level security.
 * Call everything inside a transaction.
 */
@Component
public class DecisionStore {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public DecisionStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /**
     * A request at one moment. {@code state} holds the request row under
     * "request" and, per kind, what its decision changes: the leave balance
     * ("balance": id, used, pending), the attendance record ("record"), or the
     * employee's shift assignments ("assignments").
     */
    public record Snapshot(UUID requestId, UUID employeeId, String status, Long version, ObjectNode state) {
        public JsonNode request() {
            return state.path("request");
        }
    }

    static final String LEAVE_TABLE = "leave_mgmt.leave_requests";
    static final String WFH_TABLE = "leave_mgmt.wfh_requests";
    static final String CORRECTION_TABLE = "attendance.regularization_requests";
    static final String SHIFT_TABLE = "attendance.shift_change_requests";
    static final String EXPENSE_TABLE = "expense_mgmt.expense_claims";

    static String tableOf(DecisionKind kind) {
        return switch (kind) {
            case LEAVE -> LEAVE_TABLE;
            case WFH -> WFH_TABLE;
            case CORRECTION -> CORRECTION_TABLE;
            case SHIFT_CHANGE -> SHIFT_TABLE;
            case EXPENSE -> EXPENSE_TABLE;
        };
    }

    // ── snapshots ────────────────────────────────────────────────────────────

    /**
     * The request and what its decision touches, or null when the request is
     * not in this tenant. With {@code lock}, every row read is locked
     * ({@code FOR UPDATE}) until the transaction ends.
     */
    public Snapshot snapshot(DecisionKind kind, UUID tenantId, UUID requestId, boolean lock) {
        ObjectNode request = row(tableOf(kind), tenantId, requestId, lock);
        if (request == null) return null;
        ObjectNode state = mapper.createObjectNode();
        state.set("request", request);
        UUID employeeId = uuid(request, "employee_id");
        switch (kind) {
            case LEAVE -> {
                LocalDate start = date(request, "start_date");
                UUID type = uuid(request, "leave_type_id");
                if (start != null && type != null) {
                    List<Map<String, Object>> rows = jdbc.queryForList(
                            "SELECT id, used, pending FROM leave_mgmt.leave_balances"
                                    + " WHERE tenant_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ?"
                                    + (lock ? " FOR UPDATE" : ""),
                            tenantId, employeeId, type, start.getYear());
                    if (!rows.isEmpty()) {
                        ObjectNode b = state.putObject("balance");
                        b.put("id", String.valueOf(rows.get(0).get("id")));
                        b.put("used", ((Number) rows.get(0).get("used")).doubleValue());
                        b.put("pending", ((Number) rows.get(0).get("pending")).doubleValue());
                    }
                }
            }
            case CORRECTION -> state.set("record", correctionRecord(tenantId, request, lock));
            case SHIFT_CHANGE -> {
                ArrayNode assignments = state.putArray("assignments");
                for (String json : jdbc.queryForList(
                        "SELECT to_jsonb(a)::text FROM attendance.employee_shift_assignments a"
                                + " WHERE a.tenant_id = ? AND a.employee_id = ? ORDER BY a.effective_from, a.id"
                                + (lock ? " FOR UPDATE" : ""),
                        String.class, tenantId, employeeId)) {
                    assignments.add(parse(json));
                }
            }
            default -> { /* WFH and expense: the request row is everything */ }
        }
        Long version = request.hasNonNull("version") ? request.get("version").asLong() : null;
        return new Snapshot(requestId, employeeId, text(request, "status"), version, state);
    }

    /**
     * The attendance record a fix works on, found the way
     * AttendanceService.applyApprovedCorrection finds it: by the fix's record
     * id when it has one, else the employee's record for the day. Null when
     * there is none (an approval then creates one).
     */
    private JsonNode correctionRecord(UUID tenantId, JsonNode request, boolean lock) {
        UUID recordId = uuid(request, "record_id");
        List<String> rows;
        if (recordId != null) {
            rows = jdbc.queryForList("SELECT to_jsonb(r)::text FROM attendance.records r WHERE r.tenant_id = ? AND r.id = ?"
                    + (lock ? " FOR UPDATE" : ""), String.class, tenantId, recordId);
        } else {
            rows = jdbc.queryForList("SELECT to_jsonb(r)::text FROM attendance.records r"
                            + " WHERE r.tenant_id = ? AND r.employee_id = ? AND r.attendance_date = ?"
                            + " ORDER BY r.created_at LIMIT 1" + (lock ? " FOR UPDATE" : ""),
                    String.class, tenantId, uuid(request, "employee_id"), date(request, "missing_for_date"));
        }
        return rows.isEmpty() ? mapper.nullNode() : parse(rows.get(0));
    }

    private ObjectNode row(String table, UUID tenantId, UUID id, boolean lock) {
        List<String> rows = jdbc.queryForList("SELECT to_jsonb(t)::text FROM " + table + " t WHERE t.id = ? AND t.tenant_id = ?"
                + (lock ? " FOR UPDATE" : ""), String.class, id, tenantId);
        return rows.isEmpty() ? null : (ObjectNode) parse(rows.get(0));
    }

    // ── what the decision changed, in words ──────────────────────────────────

    /** "Casual leave · 28–29 Sep", "Shift change · General → Early", "Client visit · ₹4,860": the recent-decisions line. */
    public String summary(DecisionKind kind, UUID tenantId, Snapshot s) {
        JsonNode r = s.request();
        return switch (kind) {
            case LEAVE -> firstNonBlank(leaveTypeName(tenantId, uuid(r, "leave_type_id")), "Leave")
                    + " · " + DateText.shortRange(date(r, "start_date"), date(r, "end_date"));
            case WFH -> "Work from home · " + DateText.shortRange(date(r, "from_date"), date(r, "to_date"));
            case CORRECTION -> "Attendance fix · " + DateText.shortRange(date(r, "missing_for_date"), null);
            case SHIFT_CHANGE -> {
                String current = shiftName(tenantId, uuid(r, "current_shift_policy_id"));
                String requested = firstNonBlank(shiftName(tenantId, uuid(r, "requested_shift_policy_id")), "a new shift");
                yield "Shift change · " + (current != null ? current + " → " + requested : "to " + requested);
            }
            case EXPENSE -> firstNonBlank(text(r, "title"), "Expense claim") + " · "
                    + Money.format(text(r, "currency"), r.path("total_amount").decimalValue());
        };
    }

    /** "leave request for 5 Jul 2026 to 7 Jul 2026" and the like: {{requestText}} of the "decision undone" notification. */
    public String requestText(DecisionKind kind, UUID tenantId, JsonNode r) {
        return switch (kind) {
            case LEAVE -> "leave request " + DateText.longRange(date(r, "start_date"), date(r, "end_date"));
            case WFH -> "work-from-home request " + DateText.longRange(date(r, "from_date"), date(r, "to_date"));
            case CORRECTION -> "attendance correction for " + DateText.longDay(date(r, "missing_for_date"));
            case SHIFT_CHANGE -> {
                String requested = shiftName(tenantId, uuid(r, "requested_shift_policy_id"));
                yield requested != null ? "shift change to " + requested : "shift change request";
            }
            case EXPENSE -> {
                String title = text(r, "title");
                yield title != null && !title.isBlank() ? "expense claim \"" + title + "\"" : "expense claim";
            }
        };
    }

    public String leaveTypeName(UUID tenantId, UUID leaveTypeId) {
        if (leaveTypeId == null) return null;
        List<String> rows = jdbc.queryForList("SELECT name FROM leave_mgmt.leave_types WHERE id = ? AND tenant_id = ?",
                String.class, leaveTypeId, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public String shiftName(UUID tenantId, UUID shiftPolicyId) {
        if (shiftPolicyId == null) return null;
        List<String> rows = jdbc.queryForList("SELECT name FROM attendance.shift_policies WHERE id = ? AND tenant_id = ?",
                String.class, shiftPolicyId, tenantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** "Priya Rao"; null when the employee isn't found. */
    public String employeeName(UUID tenantId, UUID employeeId) {
        if (employeeId == null) return null;
        List<String> rows = jdbc.queryForList(
                "SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                String.class, employeeId, tenantId);
        return rows.isEmpty() || rows.get(0) == null || rows.get(0).isBlank() ? null : rows.get(0);
    }

    // ── what has used a decision since ───────────────────────────────────────

    /**
     * The first LOCKED or PAID payroll run of the employee's company whose
     * period overlaps {@code from}..{@code to}, as "Sep 2026"; null when none.
     */
    public String lockedPayrollMonth(UUID tenantId, UUID employeeId, LocalDate from, LocalDate to) {
        if (from == null) return null;
        LocalDate last = to != null ? to : from;
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT r.period_year, r.period_month
                  FROM payroll.runs r
                  JOIN hrms.employees e ON e.company_id = r.company_id AND e.tenant_id = r.tenant_id
                 WHERE r.tenant_id = ? AND e.id = ? AND r.status IN ('LOCKED', 'PAID')
                   AND r.period_start <= ? AND r.period_end >= ?
                 ORDER BY r.period_start
                 LIMIT 1
                """, tenantId, employeeId, last, from);
        if (rows.isEmpty()) return null;
        int year = ((Number) rows.get(0).get("period_year")).intValue();
        int month = ((Number) rows.get(0).get("period_month")).intValue();
        return DateText.month(year, month);
    }

    /** The first day in {@code from}..{@code to} the employee checked in as work from home; null when none. */
    public LocalDate firstWfhPunch(UUID tenantId, UUID employeeId, LocalDate from, LocalDate to) {
        List<LocalDate> rows = jdbc.queryForList("""
                SELECT attendance_date FROM attendance.records
                 WHERE tenant_id = ? AND employee_id = ? AND attendance_date BETWEEN ? AND ?
                   AND check_in_at IS NOT NULL AND attendance_type IN ('WFH', 'WORK_FROM_HOME')
                 ORDER BY attendance_date LIMIT 1
                """, LocalDate.class, tenantId, employeeId, from, to != null ? to : from);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** True when an overtime decision has been made on this attendance record. */
    public boolean overtimeDecided(UUID tenantId, UUID recordId) {
        if (recordId == null) return false;
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM attendance.overtime_decisions WHERE tenant_id = ? AND record_id = ?",
                Integer.class, tenantId, recordId);
        return n != null && n > 0;
    }

    /** True when the employee checked in on {@code day}. */
    public boolean checkedIn(UUID tenantId, UUID employeeId, LocalDate day) {
        Integer n = jdbc.queryForObject("""
                SELECT COUNT(*) FROM attendance.records
                 WHERE tenant_id = ? AND employee_id = ? AND attendance_date = ? AND check_in_at IS NOT NULL
                """, Integer.class, tenantId, employeeId, day);
        return n != null && n > 0;
    }

    /** True when the employee has a pending shift change request other than {@code requestId}. */
    public boolean otherPendingShiftChange(UUID tenantId, UUID employeeId, UUID requestId) {
        Integer n = jdbc.queryForObject("""
                SELECT COUNT(*) FROM attendance.shift_change_requests
                 WHERE tenant_id = ? AND employee_id = ? AND status = 'PENDING' AND id <> ?
                """, Integer.class, tenantId, employeeId, requestId);
        return n != null && n > 0;
    }

    /** True when the claim sits in a reimbursement batch that isn't cancelled. */
    public boolean inReimbursementBatch(UUID tenantId, UUID claimId) {
        Integer n = jdbc.queryForObject("""
                SELECT COUNT(*) FROM expense_mgmt.reimbursement_batch_items bi
                  JOIN expense_mgmt.reimbursement_batches b ON b.id = bi.batch_id AND b.tenant_id = bi.tenant_id
                 WHERE bi.tenant_id = ? AND bi.claim_id = ? AND b.status <> 'CANCELLED'
                """, Integer.class, tenantId, claimId);
        return n != null && n > 0;
    }

    // ── putting things back ──────────────────────────────────────────────────

    /** The columns each kind's decide method sets; Undo puts exactly these back. */
    static final Map<DecisionKind, List<String>> DECISION_COLUMNS = Map.of(
            DecisionKind.LEAVE, List.of("status", "approver_id", "decision_note", "decision_at",
                    "l2_approver_id", "l2_approver_comment", "l2_approved_at"),
            DecisionKind.WFH, List.of("status", "approver_id", "decided_at", "decision_note"),
            DecisionKind.CORRECTION, List.of("status", "approver_id", "decision_at", "decision_note", "record_id"),
            DecisionKind.SHIFT_CHANGE, List.of("status", "approver_id", "decision_note", "decided_at", "applied_effective_date"),
            DecisionKind.EXPENSE, List.of("status", "approver_id", "approved_at", "approver_comment"));

    /** Tables with a JPA {@code version} column (all but the JDBC-only shift change requests). */
    static boolean versioned(DecisionKind kind) {
        return kind != DecisionKind.SHIFT_CHANGE;
    }

    /** Puts the request's decision columns back as they were before the decision. Returns the rows changed (1). */
    public int restoreRequest(DecisionKind kind, UUID tenantId, UUID requestId, JsonNode priorRequest) {
        String table = tableOf(kind);
        StringBuilder set = new StringBuilder();
        for (String column : DECISION_COLUMNS.get(kind)) {
            if (!set.isEmpty()) set.append(", ");
            set.append(column).append(" = p.").append(column);
        }
        set.append(versioned(kind) ? ", version = t.version + 1, updated_at = now()" : ", updated_at = now()");
        return jdbc.update("UPDATE " + table + " t SET " + set
                        + " FROM jsonb_populate_record(NULL::" + table + ", CAST(? AS jsonb)) p"
                        + " WHERE t.id = ? AND t.tenant_id = ?",
                json(priorRequest), requestId, tenantId);
    }

    /** Takes the decision's change off the balance: {@code used -= dUsed}, {@code pending -= dPending}. */
    public int adjustLeaveBalance(UUID tenantId, UUID balanceId, double usedDelta, double pendingDelta) {
        return jdbc.update("""
                UPDATE leave_mgmt.leave_balances
                   SET used = used - ?, pending = pending - ?, version = version + 1, updated_at = now()
                 WHERE id = ? AND tenant_id = ?
                """, usedDelta, pendingDelta, balanceId, tenantId);
    }

    /** Columns of attendance.records an approval may have changed; everything but identity, day and bookkeeping. */
    static final List<String> RECORD_COLUMNS = List.of(
            "check_in_at", "check_out_at", "attendance_type", "attendance_status", "check_in_method", "check_out_method",
            "check_in_latitude", "check_in_longitude", "check_out_latitude", "check_out_longitude",
            "check_in_location_name", "check_out_location_name", "check_in_zone_name", "check_out_zone_name",
            "branch_id", "company_id", "department_id", "face_confidence_score", "late_by_minutes", "overtime_minutes",
            "work_hours", "manual_entry", "manual_entry_reason", "is_regularized", "regularization_reason",
            "managed_by_employee_id", "client_event_id", "device_id", "remarks", "check_in_outside_geofence",
            "check_in_distance_m", "overtime_reason");

    /** Puts an attendance record back as it was before the approval. */
    public int restoreRecord(UUID tenantId, JsonNode priorRecord) {
        StringBuilder set = new StringBuilder();
        for (String column : RECORD_COLUMNS) {
            if (!priorRecord.has(column)) continue; // a column added after the snapshot keeps its value
            if (!set.isEmpty()) set.append(", ");
            set.append(column).append(" = p.").append(column);
        }
        set.append(", version = t.version + 1, updated_at = now()");
        return jdbc.update("UPDATE attendance.records t SET " + set
                        + " FROM jsonb_populate_record(NULL::attendance.records, CAST(? AS jsonb)) p"
                        + " WHERE t.id = ? AND t.attendance_date = ? AND t.tenant_id = ?",
                json(priorRecord), uuid(priorRecord, "id"), date(priorRecord, "attendance_date"), tenantId);
    }

    /** Removes the attendance record an approval created (there was none before it). */
    public int deleteRecord(UUID tenantId, UUID recordId, LocalDate day) {
        return jdbc.update("DELETE FROM attendance.records WHERE id = ? AND attendance_date = ? AND tenant_id = ?",
                recordId, day, tenantId);
    }

    /**
     * Notes the Undo in the day's attendance activity log, with the existing
     * MANUAL_OVERRIDE type (a new type would need a change to the log's check
     * constraint).
     */
    public void logCorrectionUndone(UUID tenantId, JsonNode record, UUID actorEmployeeId, String note) {
        jdbc.update("""
                INSERT INTO attendance.event_logs (id, tenant_id, employee_id, record_id, company_id, department_id, branch_id,
                    event_at, event_date, event_type, attendance_status, actor_employee_id, note)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, now(), ?, 'MANUAL_OVERRIDE', ?, ?, ?)
                """, tenantId, uuid(record, "employee_id"), uuid(record, "id"), uuid(record, "company_id"),
                uuid(record, "department_id"), uuid(record, "branch_id"), date(record, "attendance_date"),
                text(record, "attendance_status"), actorEmployeeId, note);
    }

    /**
     * Puts the employee's shift assignments back as they were before the
     * approval: rows the approval added are removed, rows it changed get their
     * old values back, rows it removed come back.
     */
    public void restoreAssignments(UUID tenantId, JsonNode before, JsonNode after) {
        Map<String, JsonNode> prior = byId(before);
        Map<String, JsonNode> post = byId(after);
        for (Map.Entry<String, JsonNode> e : post.entrySet()) {
            if (!prior.containsKey(e.getKey())) {
                jdbc.update("DELETE FROM attendance.employee_shift_assignments WHERE id = ? AND tenant_id = ?",
                        UUID.fromString(e.getKey()), tenantId);
            }
        }
        for (Map.Entry<String, JsonNode> e : prior.entrySet()) {
            JsonNode was = e.getValue();
            if (post.containsKey(e.getKey())) {
                if (sameAssignment(was, post.get(e.getKey()))) continue;
                jdbc.update("""
                        UPDATE attendance.employee_shift_assignments t
                           SET shift_policy_id = p.shift_policy_id, effective_from = p.effective_from,
                               effective_to = p.effective_to, note = p.note, version = t.version + 1, updated_at = now()
                          FROM jsonb_populate_record(NULL::attendance.employee_shift_assignments, CAST(? AS jsonb)) p
                         WHERE t.id = ? AND t.tenant_id = ?
                        """, json(was), UUID.fromString(e.getKey()), tenantId);
            } else {
                jdbc.update("""
                        INSERT INTO attendance.employee_shift_assignments
                        SELECT * FROM jsonb_populate_record(NULL::attendance.employee_shift_assignments, CAST(? AS jsonb))
                        """, json(was));
            }
        }
    }

    private static boolean sameAssignment(JsonNode a, JsonNode b) {
        return Objects.equals(text(a, "shift_policy_id"), text(b, "shift_policy_id"))
                && Objects.equals(text(a, "effective_from"), text(b, "effective_from"))
                && Objects.equals(text(a, "effective_to"), text(b, "effective_to"))
                && Objects.equals(text(a, "note"), text(b, "note"));
    }

    static Map<String, JsonNode> byId(JsonNode assignments) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        if (assignments != null && assignments.isArray()) {
            for (JsonNode a : assignments) out.put(a.path("id").asText(), a);
        }
        return out;
    }

    /** Each assignment's id and version, to tell whether anything changed since a snapshot. */
    static Map<String, Long> versions(JsonNode assignments) {
        Map<String, Long> out = new HashMap<>();
        for (Map.Entry<String, JsonNode> e : byId(assignments).entrySet()) {
            out.put(e.getKey(), e.getValue().path("version").asLong());
        }
        return out;
    }

    // ── JSON helpers ─────────────────────────────────────────────────────────

    JsonNode parse(String json) {
        try {
            return mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not read a stored row", e);
        }
    }

    String json(JsonNode node) {
        try {
            return mapper.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not write a row", e);
        }
    }

    static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    static UUID uuid(JsonNode n, String field) {
        String s = text(n, field);
        return s == null || s.isBlank() ? null : UUID.fromString(s);
    }

    static LocalDate date(JsonNode n, String field) {
        String s = text(n, field);
        return s == null || s.isBlank() ? null : LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a : b;
    }
}
