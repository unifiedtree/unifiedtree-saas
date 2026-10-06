package com.hrms.api.approvals;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The Approvals inbox, read straight from the request tables with JDBC
 * (AUDIT-ADDENDUM B): one query per kind for everything the caller may list,
 * with exactly that kind's list scope (see {@link InboxAccess}), then the
 * facts and warnings for the rows on the page, a few queries per kind for all
 * of them together (never one per row).
 *
 * <p>Every statement filters on {@code tenant_id} as well as row-level
 * security. Run each call inside a read-only transaction.
 */
@Component
public class InboxQueries {

    private final JdbcTemplate jdbc;
    /**
     * Company access: a company-scoped HR-level approver's tenant-wide sources
     * (leave, leave waiting for HR, work from home) cover their current company
     * only (COMPANY_ACCESS.md). Without the bean: the whole tenant, as before.
     */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.unifiedtree.rbac.company.CompanyAccessService companyAccess;

    public InboxQueries(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The row kind of a submitted timesheet week (the web's {@code ApprovalKind} 'TIMESHEET'); it has no Undo. */
    public static final String TIMESHEET = "TIMESHEET";

    /**
     * The row kind of a leave request a manager approved that waits for HR (PENDING_L2), decided with
     * POST /v1/leave/{id}/l2-decision; it has no Undo. Listed only when the caller asks for it
     * ({@code includeL2}), so a client that sends every LEAVE row to the single-step decision never gets one.
     */
    public static final String LEAVE_L2 = "LEAVE_L2";

    /** One inbox row, as the web's {@code InboxRow}. Facts and warnings are filled in for the page's rows. */
    public static final class Row {
        public final String kind;
        public final UUID requestId;
        public final UUID employeeId;
        public final String employeeName;
        public final String employeeCode;
        public final String departmentName;
        public final Instant createdAt;
        public String title;
        public final LocalDate fromDate;
        public final LocalDate toDate;
        public final Double days;
        public final BigDecimal amount;
        public final String currency;
        public final String reason;
        public final List<Fact> facts = new ArrayList<>();
        public final List<Warning> warnings = new ArrayList<>();
        public boolean canDecide;
        public final boolean rejectNeedsReason;
        // not sent: what enrichment needs
        final transient Map<String, Object> extra = new HashMap<>();

        Row(DecisionKind kind, UUID requestId, UUID employeeId, String employeeName, String employeeCode,
            String departmentName, Instant createdAt, String title, LocalDate fromDate, LocalDate toDate, Double days,
            BigDecimal amount, String currency, String reason) {
            this(kind.name(), InboxAccess.rejectNeedsReason(kind), requestId, employeeId, employeeName, employeeCode,
                    departmentName, createdAt, title, fromDate, toDate, days, amount, currency, reason);
        }

        Row(String kind, boolean rejectNeedsReason, UUID requestId, UUID employeeId, String employeeName,
                    String employeeCode, String departmentName, Instant createdAt, String title, LocalDate fromDate,
                    LocalDate toDate, Double days, BigDecimal amount, String currency, String reason) {
            this.kind = kind;
            this.requestId = requestId;
            this.employeeId = employeeId;
            this.employeeName = employeeName;
            this.employeeCode = employeeCode;
            this.departmentName = departmentName;
            this.createdAt = createdAt;
            this.title = title;
            this.fromDate = fromDate;
            this.toDate = toDate;
            this.days = days;
            this.amount = amount;
            this.currency = currency;
            this.reason = reason;
            this.rejectNeedsReason = rejectNeedsReason;
        }

        /** The undoable kind, or null for a row that has none (a timesheet week, a leave waiting for HR). */
        DecisionKind decisionKind() {
            return TIMESHEET.equals(kind) || LEAVE_L2.equals(kind) ? null : DecisionKind.valueOf(kind);
        }
    }

    public record Fact(String key, String label, String value) {
    }

    public record Warning(String key, String text) {
    }

    private static final String PERSON = """
            NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS employee_name,
            e.employee_code, d.name AS department_name, e.employment_status, e.first_name AS employee_first_name
            """;

    private static final String PERSON_JOIN = """
            LEFT JOIN hrms.employees e ON e.id = %1$s.employee_id AND e.tenant_id = %1$s.tenant_id
            LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
            """;

    /** The company a company-scoped HR-level approver's tenant-wide sources cover; null = the whole tenant. */
    private UUID onlyCompany() {
        return com.unifiedtree.rbac.company.CompanyAccessService.scopedViewCompanyId(companyAccess);
    }

    // ── sources ──────────────────────────────────────────────────────────────

    /**
     * Pending leave, as GET /v1/leave/approvals/pending lists it: the whole
     * tenant with hrms.leave.approve.l2, else requests whose approver, whose
     * requester's reporting manager or whose requester's department head is the
     * caller. The caller's own requests are left out.
     */
    public List<Row> leave(UUID tenantId, InboxAccess a) {
        String scope = a.leaveL2() ? "" : """
                   AND (lr.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?)
                """;
        List<Object> args = new ArrayList<>(List.of(tenantId, a.me()));
        if (!a.leaveL2()) args.addAll(List.of(a.me(), a.me(), a.me()));
        UUID only = a.leaveL2() ? onlyCompany() : null;
        if (only != null) {
            scope = " AND e.company_id = ?";
            args.add(only);
        }
        List<Row> out = new ArrayList<>();
        jdbc.query("SELECT lr.id, lr.employee_id, lr.created_at, lr.start_date, lr.end_date, lr.total_days, lr.reason,"
                        + " lr.duration, lt.name AS type_name, " + PERSON
                        + " FROM leave_mgmt.leave_requests lr " + PERSON_JOIN.formatted("lr")
                        + " LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id AND lt.tenant_id = lr.tenant_id"
                        + " WHERE lr.tenant_id = ? AND lr.status = 'PENDING' AND lr.employee_id <> ?" + scope,
                (RowCallbackHandler) rs -> {
                    Row r = row(rs, DecisionKind.LEAVE, rs.getTimestamp("created_at"),
                            firstNonBlank(rs.getString("type_name"), "Leave"),
                            rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                            rs.getDouble("total_days"), null, null, rs.getString("reason"));
                    r.extra.put("duration", rs.getString("duration"));
                    r.extra.put("typeName", rs.getString("type_name"));
                    out.add(r);
                }, args.toArray());
        return out;
    }

    /**
     * Leave waiting for HR, as GET /v1/leave/approvals/pending-l2 lists it: every PENDING_L2 request in the
     * tenant (the caller holds hrms.leave.approve.l2), without the caller's own. Facts: who approved it at the
     * first level, and their note. The first-level approver is kept for {@link InboxAccess#canDecideLeaveL2}.
     */
    public List<Row> leaveL2(UUID tenantId, InboxAccess a) {
        List<Row> out = new ArrayList<>();
        UUID only = onlyCompany();
        List<Object> args = new ArrayList<>(List.of(tenantId, a.me()));
        if (only != null) args.add(only);
        jdbc.query("SELECT lr.id, lr.employee_id, lr.created_at, lr.start_date, lr.end_date, lr.total_days, lr.reason,"
                        + " lr.duration, lr.approver_id, lr.decision_note, lt.name AS type_name,"
                        + " NULLIF(TRIM(COALESCE(l1.first_name, '') || ' ' || COALESCE(l1.last_name, '')), '') AS l1_name, " + PERSON
                        + " FROM leave_mgmt.leave_requests lr " + PERSON_JOIN.formatted("lr")
                        + " LEFT JOIN leave_mgmt.leave_types lt ON lt.id = lr.leave_type_id AND lt.tenant_id = lr.tenant_id"
                        + " LEFT JOIN hrms.employees l1 ON l1.id = lr.approver_id AND l1.tenant_id = lr.tenant_id"
                        + " WHERE lr.tenant_id = ? AND lr.status = 'PENDING_L2' AND lr.employee_id <> ?"
                        + (only != null ? " AND e.company_id = ?" : ""),
                (RowCallbackHandler) rs -> {
                    Timestamp at = rs.getTimestamp("created_at");
                    Row r = new Row(LEAVE_L2, false, rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                            rs.getString("employee_name"), rs.getString("employee_code"), rs.getString("department_name"),
                            at == null ? Instant.EPOCH : at.toInstant(), firstNonBlank(rs.getString("type_name"), "Leave"),
                            rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
                            rs.getDouble("total_days"), null, null, rs.getString("reason"));
                    r.extra.put("status", rs.getString("employment_status"));
                    r.extra.put("firstName", firstNonBlank(rs.getString("employee_first_name"), rs.getString("employee_name")));
                    r.extra.put("duration", rs.getString("duration"));
                    r.extra.put("typeName", rs.getString("type_name"));
                    r.extra.put("approverId", rs.getObject("approver_id", UUID.class));
                    r.facts.add(new Fact("managerApproved", "Approved by", firstNonBlank(rs.getString("l1_name"), "Their manager")));
                    String note = rs.getString("decision_note");
                    if (note != null && !note.isBlank()) r.facts.add(new Fact("managerNote", "Manager's note", note.trim()));
                    out.add(r);
                }, args.toArray());
        return out;
    }

    /** Pending work from home, as GET /v1/wfh/pending-approvals lists it (the leave rule), without the caller's own. */
    public List<Row> wfh(UUID tenantId, InboxAccess a) {
        String scope = a.leaveL2() ? "" : """
                   AND (w.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?)
                """;
        List<Object> args = new ArrayList<>(List.of(tenantId, a.me()));
        if (!a.leaveL2()) args.addAll(List.of(a.me(), a.me(), a.me()));
        UUID only = a.leaveL2() ? onlyCompany() : null;
        if (only != null) {
            scope = " AND e.company_id = ?";
            args.add(only);
        }
        List<Row> out = new ArrayList<>();
        jdbc.query("SELECT w.id, w.employee_id, w.created_at, w.from_date, w.to_date, w.reason, " + PERSON
                        + " FROM leave_mgmt.wfh_requests w " + PERSON_JOIN.formatted("w")
                        + " WHERE w.tenant_id = ? AND w.status = 'PENDING' AND w.employee_id <> ?" + scope,
                (RowCallbackHandler) rs -> {
                    LocalDate from = rs.getObject("from_date", LocalDate.class);
                    LocalDate to = rs.getObject("to_date", LocalDate.class);
                    double days = from != null && to != null ? to.toEpochDay() - from.toEpochDay() + 1 : 0;
                    out.add(row(rs, DecisionKind.WFH, rs.getTimestamp("created_at"), "Work from home", from, to, days,
                            null, null, rs.getString("reason")));
                }, args.toArray());
        return out;
    }

    /** Pending attendance fixes of the caller's team, as GET /v1/attendance/corrections/approvals?status=PENDING. */
    public List<Row> corrections(UUID tenantId, InboxAccess a, Set<UUID> team) {
        List<Row> out = new ArrayList<>();
        if (team.isEmpty()) return out;
        jdbc.query("SELECT rr.id, rr.employee_id, rr.created_at, rr.missing_for_date, rr.requested_check_in,"
                        + " rr.requested_check_out, rr.reason, " + PERSON
                        + " FROM attendance.regularization_requests rr " + PERSON_JOIN.formatted("rr")
                        + " WHERE rr.tenant_id = ? AND rr.status = 'PENDING' AND rr.employee_id <> ?"
                        + " AND rr.employee_id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> {
                    LocalDate day = rs.getObject("missing_for_date", LocalDate.class);
                    Row r = row(rs, DecisionKind.CORRECTION, rs.getTimestamp("created_at"), "Attendance fix", day, day,
                            null, null, null, rs.getString("reason"));
                    r.extra.put("askedIn", instant(rs.getTimestamp("requested_check_in")));
                    r.extra.put("askedOut", instant(rs.getTimestamp("requested_check_out")));
                    out.add(r);
                }, tenantId, a.me(), uuidArray(team));
        return out;
    }

    /**
     * Pending shift changes, as GET /v1/shifts/change-requests/pending: the
     * tenant with attendance.workforce.admin, else the team; requests whose
     * start date has passed are left out (they are expiring).
     */
    public List<Row> shiftChanges(UUID tenantId, InboxAccess a, Set<UUID> team, LocalDate today) {
        List<Row> out = new ArrayList<>();
        if (!a.workforceAdmin() && team.isEmpty()) return out;
        List<Object> args = new ArrayList<>(List.of(tenantId, today, a.me()));
        if (!a.workforceAdmin()) args.add(uuidArray(team));
        jdbc.query("SELECT scr.id, scr.employee_id, scr.created_at, scr.requested_effective_date, scr.reason,"
                        + " cur.name AS current_name, req.id AS requested_id, req.name AS requested_name,"
                        + " req.start_time, req.end_time, " + PERSON
                        + " FROM attendance.shift_change_requests scr " + PERSON_JOIN.formatted("scr")
                        + " LEFT JOIN attendance.shift_policies cur ON cur.id = scr.current_shift_policy_id AND cur.tenant_id = scr.tenant_id"
                        + " LEFT JOIN attendance.shift_policies req ON req.id = scr.requested_shift_policy_id AND req.tenant_id = scr.tenant_id"
                        + " WHERE scr.tenant_id = ? AND scr.status = 'PENDING'"
                        + " AND (scr.requested_effective_date IS NULL OR scr.requested_effective_date >= ?)"
                        + " AND scr.employee_id <> ?"
                        + (a.workforceAdmin() ? "" : " AND scr.employee_id = ANY(CAST(? AS uuid[]))"),
                (RowCallbackHandler) rs -> {
                    String current = rs.getString("current_name");
                    String requested = firstNonBlank(rs.getString("requested_name"), "a new shift");
                    String title = current != null ? "Shift change: " + current + " → " + requested : "Shift change to " + requested;
                    Row r = row(rs, DecisionKind.SHIFT_CHANGE, rs.getTimestamp("created_at"), title,
                            rs.getObject("requested_effective_date", LocalDate.class), null, null, null, null,
                            rs.getString("reason"));
                    r.extra.put("requestedId", rs.getObject("requested_id", UUID.class));
                    r.extra.put("requestedName", requested);
                    r.extra.put("start", rs.getObject("start_time", LocalTime.class));
                    r.extra.put("end", rs.getObject("end_time", LocalTime.class));
                    out.add(r);
                }, args.toArray());
        return out;
    }

    /**
     * Submitted expense claims, as GET /v1/expense/claims/approvals lists
     * them, but SUBMITTED only (approved claims waiting to be paid are not
     * waiting for a decision): the tenant with hrms.expense.reimbursement, else
     * claims routed to the caller.
     */
    public List<Row> expenses(UUID tenantId, InboxAccess a) {
        List<Object> args = new ArrayList<>(List.of(tenantId, a.me()));
        if (!a.reimbursement()) args.add(a.me());
        List<Row> out = new ArrayList<>();
        jdbc.query("SELECT c.id, c.employee_id, COALESCE(c.submitted_at, c.created_at) AS raised_at, c.title,"
                        + " c.total_amount, c.currency, c.notes, c.approver_id,"
                        + " (SELECT COUNT(*) FROM expense_mgmt.expense_items i WHERE i.claim_id = c.id AND i.tenant_id = c.tenant_id) AS item_count,"
                        + " (SELECT COUNT(*) FROM expense_mgmt.expense_items i WHERE i.claim_id = c.id AND i.tenant_id = c.tenant_id"
                        + "     AND i.receipt_url IS NOT NULL AND btrim(i.receipt_url) <> '') AS receipt_count, " + PERSON
                        + " FROM expense_mgmt.expense_claims c " + PERSON_JOIN.formatted("c")
                        + " WHERE c.tenant_id = ? AND c.status = 'SUBMITTED' AND c.employee_id <> ?"
                        + (a.reimbursement() ? "" : " AND c.approver_id = ?"),
                (RowCallbackHandler) rs -> {
                    Row r = row(rs, DecisionKind.EXPENSE, rs.getTimestamp("raised_at"),
                            firstNonBlank(rs.getString("title"), "Expense claim"), null, null, null,
                            rs.getBigDecimal("total_amount"), firstNonBlank(rs.getString("currency"), "INR"),
                            rs.getString("notes"));
                    r.extra.put("approverId", rs.getObject("approver_id", UUID.class));
                    r.extra.put("items", rs.getInt("item_count"));
                    r.extra.put("receipts", rs.getInt("receipt_count"));
                    out.add(r);
                }, args.toArray());
        return out;
    }

    /** Whether the submitted-weeks table (V143_65, BW-36) is there; never fails. */
    public boolean timesheetsReady() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT to_regclass('hrms.timesheet_weeks') IS NOT NULL", Boolean.class));
    }

    /**
     * Submitted timesheet weeks of the caller's team, as GET
     * /v1/timesheets/approvals lists them (SUBMITTED, TeamEmployeeScope; HR and
     * admins: the company). Nothing before V143_65 is applied. Facts: the hours
     * logged.
     */
    public List<Row> timesheets(UUID tenantId, InboxAccess a, Set<UUID> team) {
        List<Row> out = new ArrayList<>();
        if (team.isEmpty() || !timesheetsReady()) return out;
        jdbc.query("SELECT w.id, w.employee_id, w.submitted_at, w.week_start, w.total_minutes, " + PERSON
                        + " FROM hrms.timesheet_weeks w " + PERSON_JOIN.formatted("w")
                        + " WHERE w.tenant_id = ? AND w.status = 'SUBMITTED' AND w.employee_id <> ?"
                        + " AND w.employee_id = ANY(CAST(? AS uuid[]))",
                (RowCallbackHandler) rs -> {
                    LocalDate start = rs.getObject("week_start", LocalDate.class);
                    Timestamp at = rs.getTimestamp("submitted_at");
                    Row r = new Row(TIMESHEET, false, rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                            rs.getString("employee_name"), rs.getString("employee_code"), rs.getString("department_name"),
                            at == null ? Instant.EPOCH : at.toInstant(), "Timesheet", start,
                            start == null ? null : start.plusDays(6), null, null, null, null);
                    r.extra.put("status", rs.getString("employment_status"));
                    r.extra.put("firstName", firstNonBlank(rs.getString("employee_first_name"), rs.getString("employee_name")));
                    r.facts.add(new Fact("hours", "Hours logged", hours(Duration.ofMinutes(rs.getInt("total_minutes")))));
                    out.add(r);
                }, tenantId, a.me(), uuidArray(team));
        return out;
    }

    private static Row row(ResultSet rs, DecisionKind kind, Timestamp raisedAt, String title, LocalDate from, LocalDate to,
                           Double days, BigDecimal amount, String currency, String reason) throws SQLException {
        Row r = new Row(kind, rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                rs.getString("employee_name"), rs.getString("employee_code"), rs.getString("department_name"),
                raisedAt == null ? Instant.EPOCH : raisedAt.toInstant(), title, from, to, days, amount, currency, reason);
        r.extra.put("status", rs.getString("employment_status"));
        r.extra.put("firstName", firstNonBlank(rs.getString("employee_first_name"), rs.getString("employee_name")));
        return r;
    }

    // ── facts and warnings for the page's rows ───────────────────────────────

    /**
     * Leave: balance after, others out (the requester's department, else the
     * people who share their manager, limited to what the caller may see), and
     * warnings for others out, the last of the balance, locked payroll and a
     * requester on notice.
     */
    public void enrichLeave(UUID tenantId, List<Row> rows, Set<UUID> visible) {
        if (rows.isEmpty()) return;
        String ids = uuidArray(rows.stream().map(r -> r.requestId).toList());
        Map<UUID, Double> available = new HashMap<>();
        jdbc.query("""
                SELECT lr.id, lb.total_entitlement + lb.carry_forward - lb.used - lb.pending AS available
                  FROM leave_mgmt.leave_requests lr
                  JOIN leave_mgmt.leave_balances lb ON lb.tenant_id = lr.tenant_id AND lb.employee_id = lr.employee_id
                       AND lb.leave_type_id = lr.leave_type_id AND lb.year = CAST(EXTRACT(YEAR FROM lr.start_date) AS int)
                 WHERE lr.tenant_id = ? AND lr.id = ANY(CAST(? AS uuid[]))
                """, (RowCallbackHandler) rs -> available.put(rs.getObject("id", UUID.class), rs.getDouble("available")),
                tenantId, ids);
        Map<UUID, List<String>> othersOut = colleaguesAway(tenantId, ids, "leave_mgmt.leave_requests", "start_date", "end_date",
                false, visible);
        Map<UUID, String> locked = lockedPayroll(tenantId, ids, "leave_mgmt.leave_requests", "start_date", "end_date");
        for (Row r : rows) {
            Double left = available.get(r.requestId);
            if (left != null) {
                r.facts.add(new Fact("balanceAfter", "Balance after", dayCount(left)));
                if (Math.abs(left) < 0.0001) {
                    r.warnings.add(new Warning("lastOfBalance", "This uses the last of their "
                            + firstNonBlank((String) r.extra.get("typeName"), "leave") + "."));
                }
            }
            if ("HALF_DAY_MORNING".equals(r.extra.get("duration"))) r.facts.add(new Fact("halfDay", "Half day", "Morning"));
            if ("HALF_DAY_AFTERNOON".equals(r.extra.get("duration"))) r.facts.add(new Fact("halfDay", "Half day", "Afternoon"));
            List<String> away = othersOut.getOrDefault(r.requestId, List.of());
            r.facts.add(new Fact("othersOut", "Others out", away.isEmpty() ? "None" : names(away)));
            if (!away.isEmpty()) {
                r.warnings.add(new Warning("othersOut", names(away) + (away.size() == 1 ? " is" : " are") + " also on leave then."));
            }
            String month = locked.get(r.requestId);
            if (month != null) r.warnings.add(new Warning("payrollLocked", "Payroll for " + month + " is already locked."));
            if ("NOTICE_PERIOD".equals(r.extra.get("status"))) {
                r.warnings.add(new Warning("onNotice", firstNonBlank((String) r.extra.get("firstName"), "They") + " is serving notice."));
            }
        }
    }

    /** Attendance fix: what was asked, what was punched, the hours if approved, and a locked payroll. */
    public void enrichCorrections(UUID tenantId, List<Row> rows) {
        if (rows.isEmpty()) return;
        String ids = uuidArray(rows.stream().map(r -> r.requestId).toList());
        Map<UUID, Object[]> punched = new HashMap<>();
        jdbc.query("""
                SELECT rr.id, r.check_in_at, r.check_out_at, r.check_in_method
                  FROM attendance.regularization_requests rr
                  LEFT JOIN LATERAL (
                        SELECT x.check_in_at, x.check_out_at, x.check_in_method FROM attendance.records x
                         WHERE x.tenant_id = rr.tenant_id
                           AND ((rr.record_id IS NOT NULL AND x.id = rr.record_id)
                             OR (rr.record_id IS NULL AND x.employee_id = rr.employee_id AND x.attendance_date = rr.missing_for_date))
                         ORDER BY x.created_at LIMIT 1) r ON TRUE
                 WHERE rr.tenant_id = ? AND rr.id = ANY(CAST(? AS uuid[]))
                """, (RowCallbackHandler) rs -> punched.put(rs.getObject("id", UUID.class), new Object[]{
                        instant(rs.getTimestamp("check_in_at")), instant(rs.getTimestamp("check_out_at")),
                        rs.getString("check_in_method")}),
                tenantId, ids);
        Map<UUID, String> locked = lockedPayroll(tenantId, ids, "attendance.regularization_requests", "missing_for_date", "missing_for_date");
        for (Row r : rows) {
            Instant askedIn = (Instant) r.extra.get("askedIn");
            Instant askedOut = (Instant) r.extra.get("askedOut");
            Object[] p = punched.getOrDefault(r.requestId, new Object[3]);
            Instant in = (Instant) p[0];
            Instant out = (Instant) p[1];
            r.title = correctionTitle(askedIn, askedOut, in);
            r.facts.add(new Fact("askedFor", "Asked for", inOut(askedIn, askedOut)));
            String punch = in == null && out == null ? "No punch"
                    : inOut(in, out) + (in != null && p[2] != null ? " · " + methodLabel((String) p[2]) : "");
            r.facts.add(new Fact("punched", "Punched", punch));
            Instant effIn = askedIn != null ? askedIn : in;
            Instant effOut = askedOut != null ? askedOut : out;
            if (effIn != null && effOut != null && effOut.isAfter(effIn)) {
                r.facts.add(new Fact("hoursIfApproved", "Hours if approved", hours(Duration.between(effIn, effOut))));
            }
            String month = locked.get(r.requestId);
            if (month != null) r.warnings.add(new Warning("payrollLocked", "Payroll for " + month + " is already locked."));
        }
    }

    /** Work from home: days already approved this month ("N days", no allowance) and others away that day. */
    public void enrichWfh(UUID tenantId, List<Row> rows, Set<UUID> visible) {
        if (rows.isEmpty()) return;
        String ids = uuidArray(rows.stream().map(r -> r.requestId).toList());
        Map<UUID, Integer> thisMonth = new HashMap<>();
        jdbc.query("""
                SELECT w.id, COALESCE(SUM(GREATEST(0,
                           LEAST(a.to_date, CAST(date_trunc('month', w.from_date) + interval '1 month - 1 day' AS date))
                         - GREATEST(a.from_date, CAST(date_trunc('month', w.from_date) AS date)) + 1)), 0) AS days
                  FROM leave_mgmt.wfh_requests w
                  LEFT JOIN leave_mgmt.wfh_requests a ON a.tenant_id = w.tenant_id AND a.employee_id = w.employee_id
                       AND a.status = 'APPROVED'
                       AND a.from_date <= CAST(date_trunc('month', w.from_date) + interval '1 month - 1 day' AS date)
                       AND a.to_date >= CAST(date_trunc('month', w.from_date) AS date)
                 WHERE w.tenant_id = ? AND w.id = ANY(CAST(? AS uuid[]))
                 GROUP BY w.id
                """, (RowCallbackHandler) rs -> thisMonth.put(rs.getObject("id", UUID.class), rs.getInt("days")),
                tenantId, ids);
        Map<UUID, List<String>> away = colleaguesAway(tenantId, ids, "leave_mgmt.wfh_requests", "from_date", "from_date", true, visible);
        for (Row r : rows) {
            int n = thisMonth.getOrDefault(r.requestId, 0);
            r.facts.add(new Fact("wfhThisMonth", "WFH this month", n == 0 ? "None yet" : n + (n == 1 ? " day" : " days")));
            List<String> others = away.getOrDefault(r.requestId, List.of());
            r.facts.add(new Fact("othersAway", "Others away that day",
                    others.isEmpty() ? "None" : others.size() + (others.size() == 1 ? " person" : " people")));
        }
    }

    /**
     * Shift change: the new timing, when it starts, how many of the caller's
     * team are on that shift today, and warnings when another change is
     * already scheduled after it (approving would be refused) or it starts
     * today (it expires if not decided).
     */
    public void enrichShiftChanges(UUID tenantId, List<Row> rows, Set<UUID> team, LocalDate today) {
        if (rows.isEmpty()) return;
        String ids = uuidArray(rows.stream().map(r -> r.requestId).toList());
        Map<UUID, Integer> onShift = new HashMap<>();
        if (!team.isEmpty()) {
            jdbc.query("""
                    SELECT a.shift_policy_id, COUNT(DISTINCT a.employee_id) AS people
                      FROM attendance.employee_shift_assignments a
                     WHERE a.tenant_id = ? AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)
                       AND a.employee_id = ANY(CAST(? AS uuid[]))
                     GROUP BY a.shift_policy_id
                    """, (RowCallbackHandler) rs -> onShift.put(rs.getObject("shift_policy_id", UUID.class), rs.getInt("people")),
                    tenantId, today, today, uuidArray(team));
        }
        Map<UUID, LocalDate> scheduled = new HashMap<>();
        jdbc.query("""
                SELECT scr.id, MIN(a.effective_from) AS next_change
                  FROM attendance.shift_change_requests scr
                  JOIN attendance.employee_shift_assignments a ON a.tenant_id = scr.tenant_id AND a.employee_id = scr.employee_id
                       AND a.effective_from > COALESCE(scr.requested_effective_date, ?)
                 WHERE scr.tenant_id = ? AND scr.id = ANY(CAST(? AS uuid[]))
                 GROUP BY scr.id
                """, (RowCallbackHandler) rs -> scheduled.put(rs.getObject("id", UUID.class), rs.getObject("next_change", LocalDate.class)),
                today, tenantId, ids);
        for (Row r : rows) {
            LocalTime start = (LocalTime) r.extra.get("start");
            LocalTime end = (LocalTime) r.extra.get("end");
            if (start != null && end != null) {
                r.facts.add(new Fact("newTiming", "New timing", DateText.time(start) + " – " + DateText.time(end)));
            }
            r.facts.add(new Fact("startsOn", "Starts", r.fromDate != null ? DateText.longDay(r.fromDate) : "When approved"));
            int people = onShift.getOrDefault((UUID) r.extra.get("requestedId"), 0);
            r.facts.add(new Fact("onNewShift", "On " + r.extra.get("requestedName") + " now",
                    people == 0 ? "No one in your team" : people + (people == 1 ? " person" : " people")));
            LocalDate next = scheduled.get(r.requestId);
            if (next != null) {
                r.warnings.add(new Warning("dateConflict", "Their shift is already scheduled to change on "
                        + DateText.longDay(next) + ", so this can't be approved as it is."));
            }
            if (today.equals(r.fromDate)) {
                r.warnings.add(new Warning("startsToday", "It starts today. If it isn't decided today, it expires."));
            }
        }
    }

    /** Expense: receipts attached, the company's per-claim caps, and warnings for missing receipts or a cap passed. */
    public void enrichExpenses(UUID tenantId, List<Row> rows) {
        if (rows.isEmpty()) return;
        String ids = uuidArray(rows.stream().map(r -> r.requestId).toList());
        Map<UUID, List<Object[]>> caps = new HashMap<>();
        jdbc.query("""
                SELECT c.id, i.category, SUM(i.amount) AS subtotal,
                       (SELECT MIN(p.max_amount_per_claim) FROM expense_mgmt.expense_policies p
                         WHERE p.tenant_id = c.tenant_id AND p.company_id = c.company_id AND p.is_active = TRUE
                           AND p.category = i.category AND p.max_amount_per_claim IS NOT NULL) AS cap
                  FROM expense_mgmt.expense_claims c
                  JOIN expense_mgmt.expense_items i ON i.claim_id = c.id AND i.tenant_id = c.tenant_id
                 WHERE c.tenant_id = ? AND c.id = ANY(CAST(? AS uuid[]))
                 GROUP BY c.id, c.tenant_id, c.company_id, i.category
                """, (RowCallbackHandler) rs -> caps.computeIfAbsent(rs.getObject("id", UUID.class), k -> new ArrayList<>())
                        .add(new Object[]{rs.getString("category"), rs.getBigDecimal("subtotal"), rs.getBigDecimal("cap")}),
                tenantId, ids);
        for (Row r : rows) {
            int items = (Integer) r.extra.getOrDefault("items", 0);
            int receipts = (Integer) r.extra.getOrDefault("receipts", 0);
            if (items > 0) {
                r.facts.add(new Fact("receipts", "Receipts", receipts >= items ? "All attached"
                        : receipts == 0 ? "None attached" : receipts + " of " + items + " attached"));
                if (receipts < items) {
                    int missing = items - receipts;
                    r.warnings.add(new Warning("missingReceipts", missing + (missing == 1 ? " receipt is" : " receipts are") + " missing."));
                }
            }
            List<Object[]> lines = caps.getOrDefault(r.requestId, List.of());
            boolean anyCap = lines.stream().anyMatch(l -> l[2] != null);
            if (anyCap) {
                List<Object[]> over = lines.stream()
                        .filter(l -> l[2] != null && ((BigDecimal) l[1]).compareTo((BigDecimal) l[2]) > 0).toList();
                r.facts.add(new Fact("policyCheck", "Policy check", over.isEmpty() ? "Within limits" : "Over a limit"));
                for (Object[] l : over) {
                    r.warnings.add(new Warning("overCap", category((String) l[0]) + " comes to "
                            + Money.format(r.currency, (BigDecimal) l[1]) + ", over the company's "
                            + Money.format(r.currency, (BigDecimal) l[2]) + " limit per claim."));
                }
            }
        }
    }

    // ── shared lookups ───────────────────────────────────────────────────────

    /**
     * For each request, the first names of the requester's colleagues (same
     * department, else the same reporting manager) who are away on approved
     * leave, and with {@code withWfh} approved work from home, during the
     * request's days; only people in {@code visible} (null: everyone).
     */
    private Map<UUID, List<String>> colleaguesAway(UUID tenantId, String ids, String table, String fromColumn, String toColumn,
                                                   boolean withWfh, Set<UUID> visible) {
        String wfh = withWfh ? """
                  OR EXISTS (SELECT 1 FROM leave_mgmt.wfh_requests ow WHERE ow.tenant_id = q.tenant_id AND ow.employee_id = oe.id
                             AND ow.status = 'APPROVED' AND ow.from_date <= q.%2$s AND ow.to_date >= q.%1$s)
                """.formatted(fromColumn, toColumn) : "";
        String sql = """
                SELECT q.id, oe.id AS colleague_id, oe.first_name
                  FROM %3$s q
                  JOIN hrms.employees e ON e.id = q.employee_id AND e.tenant_id = q.tenant_id
                  JOIN hrms.employees oe ON oe.tenant_id = e.tenant_id AND oe.id <> e.id
                       AND ((e.department_id IS NOT NULL AND oe.department_id = e.department_id)
                         OR (e.department_id IS NULL AND e.reporting_manager_id IS NOT NULL
                             AND oe.reporting_manager_id = e.reporting_manager_id))
                 WHERE q.tenant_id = ? AND q.id = ANY(CAST(? AS uuid[]))
                   AND (EXISTS (SELECT 1 FROM leave_mgmt.leave_requests ol WHERE ol.tenant_id = q.tenant_id AND ol.employee_id = oe.id
                                AND ol.status = 'APPROVED' AND ol.start_date <= q.%2$s AND ol.end_date >= q.%1$s)
                %4$s)
                 ORDER BY oe.first_name
                """.formatted(fromColumn, toColumn, table, wfh);
        Map<UUID, List<String>> out = new LinkedHashMap<>();
        jdbc.query(sql, (RowCallbackHandler) rs -> {
            UUID colleague = rs.getObject("colleague_id", UUID.class);
            if (visible != null && !visible.contains(colleague)) return;
            out.computeIfAbsent(rs.getObject("id", UUID.class), k -> new ArrayList<>())
                    .add(firstNonBlank(rs.getString("first_name"), "Someone"));
        }, tenantId, ids);
        return out;
    }

    /** For each request, the first LOCKED or PAID payroll month of the requester's company over its days, as "Sep 2026". */
    private Map<UUID, String> lockedPayroll(UUID tenantId, String ids, String table, String fromColumn, String toColumn) {
        Map<UUID, String> out = new HashMap<>();
        jdbc.query("""
                SELECT DISTINCT ON (q.id) q.id, r.period_year, r.period_month
                  FROM %3$s q
                  JOIN hrms.employees e ON e.id = q.employee_id AND e.tenant_id = q.tenant_id
                  JOIN payroll.runs r ON r.tenant_id = q.tenant_id AND r.company_id = e.company_id
                       AND r.status IN ('LOCKED', 'PAID') AND r.period_start <= q.%2$s AND r.period_end >= q.%1$s
                 WHERE q.tenant_id = ? AND q.id = ANY(CAST(? AS uuid[]))
                 ORDER BY q.id, r.period_start
                """.formatted(fromColumn, toColumn, table),
                (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class),
                        DateText.month(rs.getInt("period_year"), rs.getInt("period_month"))),
                tenantId, ids);
        return out;
    }

    // ── text ─────────────────────────────────────────────────────────────────

    static String correctionTitle(Instant askedIn, Instant askedOut, Instant punchedIn) {
        if (askedIn != null && askedOut == null) return "Missed punch-in";
        if (askedOut != null && askedIn == null) return "Missed punch-out";
        return punchedIn != null ? "Time fix" : "Missed punches";
    }

    static String inOut(Instant in, Instant out) {
        if (in == null && out == null) return "—";
        if (out == null) return "In " + DateText.time(in);
        if (in == null) return "Out " + DateText.time(out);
        return "In " + DateText.time(in) + " · Out " + DateText.time(out);
    }

    static String hours(Duration d) {
        long minutes = d.toMinutes();
        return (minutes / 60) + "h " + (minutes % 60) + "m";
    }

    /** "Face", "Mobile", "Web", "Manual"…: how a punch was made. */
    static String methodLabel(String method) {
        if (method == null) return "";
        return switch (method) {
            case "FACE_RECOGNITION" -> "Face";
            case "MOBILE_GPS", "GPS", "GEO_FENCE" -> "Mobile";
            case "WEB" -> "Web";
            case "MANUAL", "MANAGER_OVERRIDE" -> "Manual";
            case "BIOMETRIC_FINGERPRINT", "BIOMETRIC_DEVICE" -> "Biometric";
            case "KIOSK" -> "Kiosk";
            case "PIN" -> "PIN";
            default -> method.charAt(0) + method.substring(1).toLowerCase(Locale.ROOT).replace('_', ' ');
        };
    }

    /** "1 day", "0.5 days", "4 days". */
    static String dayCount(double days) {
        double rounded = Math.round(days * 100.0) / 100.0;
        String n = rounded == Math.rint(rounded) ? String.valueOf((long) rounded) : String.valueOf(rounded);
        return n + (rounded == 1.0 ? " day" : " days");
    }

    /** "Arjun", "Arjun and Mala", "Arjun, Mala and Ravi", "Arjun, Mala and 3 others". */
    static String names(List<String> names) {
        if (names.size() == 1) return names.get(0);
        if (names.size() == 2) return names.get(0) + " and " + names.get(1);
        if (names.size() == 3) return names.get(0) + ", " + names.get(1) + " and " + names.get(2);
        return names.get(0) + ", " + names.get(1) + " and " + (names.size() - 2) + " others";
    }

    static String category(String code) {
        if (code == null || code.isBlank()) return "This category";
        String s = code.toLowerCase(Locale.ROOT).replace('_', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /** A Postgres uuid[] literal: "{a,b,c}". */
    static String uuidArray(Collection<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a : b;
    }
}
