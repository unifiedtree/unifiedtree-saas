package com.hrms.api.workforce;

import com.hrms.api.attendance.ApproverPath;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The timesheet by project and "Submit week" (V143.53 redesign, BW-36; tables
 * of V143_65). All additive to the time entries people log today:
 * <ul>
 *   <li>an optional project on an entry ({@code hrms.time_entries.project_id});
 *       a description alone still works;</li>
 *   <li>a person submits a week ({@code hrms.timesheet_weeks}); someone holding
 *       {@code hrms.timesheet.approve} approves or rejects it, for the people in
 *       their team scope (HR and admins: the company; a manager: their team);</li>
 *   <li>entries in a SUBMITTED or APPROVED week are locked; a REJECTED week opens
 *       again. Weeks nobody submitted are never locked, as before.</li>
 * </ul>
 * Without V143_65 every new part answers FEATURE_NOT_READY, while the entries
 * themselves keep working exactly as today (no project, nothing locked).
 */
@Service
public class TimesheetService {

    static final String SUBMITTED = "SUBMITTED";
    static final String APPROVED = "APPROVED";
    static final String REJECTED = "REJECTED";
    /** Weeks whose entries can't be changed. */
    static final Set<String> LOCKING = Set.of(SUBMITTED, APPROVED);
    static final int NOTE_MAX = 500;
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final TeamEmployeeScope teamScope;
    private final ApproverPath approvers;

    public TimesheetService(JdbcTemplate jdbc, TeamEmployeeScope teamScope, ApproverPath approvers) {
        this.jdbc = jdbc;
        this.teamScope = teamScope;
        this.approvers = approvers;
    }

    /** A submitted week (the shared contract's TimesheetWeek, plus the person's code and department). */
    public record Week(UUID id, UUID employeeId, String employeeName, LocalDate weekStart, String status, int totalMinutes,
                       Instant submittedAt, Instant decidedAt, String decidedByName, String note,
                       String employeeCode, String departmentName) {}

    // ── rules (package-visible for tests) ────────────────────────────────────

    /** The Monday of the week {@code day} falls in. */
    static LocalDate monday(LocalDate day) {
        return day.with(DayOfWeek.MONDAY);
    }

    /** Why a week can't be submitted (before looking at the database), or null. */
    static BusinessRuleException submitRefusal(LocalDate weekStart, LocalDate today) {
        if (weekStart == null || weekStart.getDayOfWeek() != DayOfWeek.MONDAY)
            return new BusinessRuleException("A timesheet week starts on a Monday.", "TIMESHEET_WEEK_START_INVALID");
        if (weekStart.isAfter(monday(today)))
            return new BusinessRuleException("You can submit a week once it has started.", "TIMESHEET_WEEK_FUTURE");
        return null;
    }

    /** The answer when a week that exists already is submitted again; null when it may be (a rejected week). */
    static HrmsException resubmitRefusal(String currentStatus) {
        if (SUBMITTED.equals(currentStatus))
            return new HrmsException("This week is already submitted and waiting for approval.", HttpStatus.CONFLICT, "TIMESHEET_WEEK_ALREADY_SUBMITTED");
        if (APPROVED.equals(currentStatus))
            return new HrmsException("This week is already approved.", HttpStatus.CONFLICT, "TIMESHEET_WEEK_ALREADY_APPROVED");
        return null;
    }

    /** "38.5h", "40h". */
    static String hours(int minutes) {
        double h = Math.round(minutes / 60.0 * 10.0) / 10.0;
        return (h == Math.rint(h) ? String.valueOf((long) h) : String.valueOf(h)) + "h";
    }

    // ── catalog checks (never fail, safe inside a transaction) ───────────────

    /** V143_65's columns are there (a project on an entry, a project code). */
    boolean projectsReady() {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('hrms.time_entries') AND attname = 'project_id' AND NOT attisdropped)
                   AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('hrms.projects') AND attname = 'code' AND NOT attisdropped)
                """, Boolean.class));
    }

    /** V143_65's weeks table is there. */
    boolean weeksReady() {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass('hrms.timesheet_weeks') IS NOT NULL", Boolean.class));
    }

    // ── entries (used by TimeEntryController) ────────────────────────────────

    /** Refuses a change to entries on these days when their week is submitted or approved. Nothing is locked without the table. */
    void assertWeeksOpen(UUID employeeId, Collection<LocalDate> days) {
        if (days == null || days.isEmpty() || !weeksReady()) return;
        Set<LocalDate> weeks = new HashSet<>();
        days.forEach(d -> { if (d != null) weeks.add(monday(d)); });
        if (weeks.isEmpty()) return;
        List<Object> args = new ArrayList<>();
        args.add(TenantContext.requireTenantId());
        args.add(employeeId);
        args.addAll(weeks);
        List<String> locked = jdbc.queryForList("SELECT status FROM hrms.timesheet_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start IN ("
                + in(weeks.size()) + ") AND status IN ('SUBMITTED', 'APPROVED')", String.class, args.toArray());
        if (!locked.isEmpty()) {
            throw new BusinessRuleException(locked.contains(APPROVED)
                    ? "This week's timesheet is approved, so its entries can't be changed."
                    : "This week's timesheet is submitted and waiting for approval, so its entries can't be changed.",
                    "TIMESHEET_WEEK_LOCKED");
        }
    }

    /** The Mondays of this person's locked weeks between the two days; empty without the table. */
    Set<LocalDate> lockedWeeks(UUID employeeId, LocalDate from, LocalDate to) {
        if (!weeksReady()) return Set.of();
        return new HashSet<>(jdbc.queryForList("SELECT week_start FROM hrms.timesheet_weeks WHERE tenant_id = ? AND employee_id = ? "
                        + "AND week_start BETWEEN ? AND ? AND status IN ('SUBMITTED', 'APPROVED')", LocalDate.class,
                TenantContext.requireTenantId(), employeeId, monday(from), to));
    }

    /**
     * A project may go on this person's entry: it is their company's and ACTIVE
     * (or it is already the entry's project, so an edit can keep it).
     */
    void requireProject(UUID employeeId, UUID projectId, UUID currentProjectId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT p.status, (p.company_id = e.company_id) AS same_company
                  FROM hrms.projects p
                  JOIN hrms.employees e ON e.id = ? AND e.tenant_id = p.tenant_id
                 WHERE p.id = ? AND p.tenant_id = ?
                """, employeeId, projectId, TenantContext.requireTenantId());
        if (rows.isEmpty() || !Boolean.TRUE.equals(rows.get(0).get("same_company"))) {
            throw new BusinessRuleException("Choose one of your company's projects.", "TIME_PROJECT_INVALID");
        }
        if (!"ACTIVE".equals(rows.get(0).get("status")) && !projectId.equals(currentProjectId)) {
            throw new BusinessRuleException("This project is closed. Choose an active one.", "TIME_PROJECT_CLOSED");
        }
    }

    /** GET /v1/ess/timesheets/projects: the active projects of the person's company (name and code only). */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> projects(UUID employeeId) {
        UUID tenant = TenantContext.requireTenantId();
        return FeatureNotReady.guard(() -> jdbc.queryForList("""
                SELECT p.id, p.name, p.code
                  FROM hrms.projects p
                 WHERE p.tenant_id = ? AND p.status = 'ACTIVE'
                   AND p.company_id = (SELECT company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?)
                 ORDER BY lower(p.name)
                """, tenant, employeeId, tenant));
    }

    // ── weeks: the person's own ──────────────────────────────────────────────

    /** GET /v1/ess/timesheets/weeks: the person's submitted weeks between two days, newest first. */
    @Transactional(readOnly = true)
    public List<Week> myWeeks(UUID employeeId, LocalDate from, LocalDate to) {
        if (from == null || to == null || to.isBefore(from) || to.isAfter(from.plusDays(366)))
            throw new BusinessRuleException("Choose a date range of at most one year", "TIME_RANGE_INVALID");
        return FeatureNotReady.guard(() -> jdbc.query(WEEK_SELECT + " WHERE w.tenant_id = ? AND w.employee_id = ? AND w.week_start BETWEEN ? AND ? ORDER BY w.week_start DESC",
                WEEK, TenantContext.requireTenantId(), employeeId, monday(from), to));
    }

    /**
     * POST /v1/ess/timesheets/weeks/{monday}/submit. Takes the lock on the
     * person's employee row that their entry changes take too, so a week is never
     * submitted while one of its entries is being changed. A rejected week may be
     * submitted again.
     */
    @Transactional
    public Week submit(UUID employeeId, LocalDate weekStart, UUID byUserId) {
        BusinessRuleException refused = submitRefusal(weekStart, LocalDate.now(IST));
        if (refused != null) throw refused;
        UUID tenant = TenantContext.requireTenantId();
        jdbc.queryForList("SELECT id FROM hrms.employees WHERE id = ? AND tenant_id = ? FOR UPDATE", UUID.class, employeeId, tenant);
        return FeatureNotReady.guard(() -> {
            List<Map<String, Object>> existing = jdbc.queryForList(
                    "SELECT id, status FROM hrms.timesheet_weeks WHERE tenant_id = ? AND employee_id = ? AND week_start = ? FOR UPDATE",
                    tenant, employeeId, weekStart);
            if (!existing.isEmpty()) {
                HrmsException again = resubmitRefusal((String) existing.get(0).get("status"));
                if (again != null) throw again;
            }
            Integer total = jdbc.queryForObject("SELECT COALESCE(sum(minutes), 0)::integer FROM hrms.time_entries "
                    + "WHERE tenant_id = ? AND employee_id = ? AND work_date BETWEEN ? AND ?", Integer.class,
                    tenant, employeeId, weekStart, weekStart.plusDays(6));
            if (total == null || total <= 0) {
                throw new BusinessRuleException("Log some time in this week before you submit it.", "TIMESHEET_WEEK_EMPTY");
            }
            UUID id;
            if (existing.isEmpty()) {
                id = UUID.randomUUID();
                jdbc.update("""
                        INSERT INTO hrms.timesheet_weeks (id, tenant_id, employee_id, company_id, week_start, status, total_minutes,
                                                          submitted_at, submitted_by_user_id)
                        SELECT ?, ?, ?, e.company_id, ?, 'SUBMITTED', ?, now(), ? FROM hrms.employees e WHERE e.id = ? AND e.tenant_id = ?
                        """, id, tenant, employeeId, weekStart, total, byUserId, employeeId, tenant);
            } else {
                id = (UUID) existing.get(0).get("id");
                jdbc.update("""
                        UPDATE hrms.timesheet_weeks
                           SET status = 'SUBMITTED', total_minutes = ?, submitted_at = now(), submitted_by_user_id = ?,
                               decided_at = NULL, decided_by_user_id = NULL, decided_by_employee_id = NULL,
                               decided_by_name = NULL, note = NULL, updated_at = now()
                         WHERE id = ? AND tenant_id = ?
                        """, total, byUserId, id, tenant);
            }
            return week(id);
        });
    }

    // ── weeks: the approver's ────────────────────────────────────────────────

    /**
     * GET /v1/timesheets/approvals: the weeks of the people in the caller's team
     * scope, newest submission first. {@code status}: SUBMITTED (default),
     * APPROVED, REJECTED or ALL.
     */
    @Transactional(readOnly = true)
    public PageResponse<Week> approvals(Jwt jwt, String status, int page, int size) {
        int p = Math.max(0, page), s = Math.max(1, Math.min(100, size));
        String st = status == null ? SUBMITTED : status.trim().toUpperCase();
        boolean all = "ALL".equals(st);
        if (!all && !SUBMITTED.equals(st) && !APPROVED.equals(st) && !REJECTED.equals(st)) st = SUBMITTED;
        List<UUID> team = teamIds(jwt);
        if (team.isEmpty()) return new PageResponse<>(List.of(), p, s, 0, 0, true);
        final String statusFilter = st;
        return FeatureNotReady.guard(() -> {
            List<Object> args = new ArrayList<>();
            args.add(TenantContext.requireTenantId());
            args.addAll(team);
            String where = " WHERE w.tenant_id = ? AND w.employee_id IN (" + in(team.size()) + ")" + (all ? "" : " AND w.status = ?");
            if (!all) args.add(statusFilter);
            Long total = jdbc.queryForObject("SELECT count(*) FROM hrms.timesheet_weeks w" + where, Long.class, args.toArray());
            List<Object> pageArgs = new ArrayList<>(args);
            pageArgs.add(s);
            pageArgs.add((long) p * s);
            List<Week> rows = jdbc.query(WEEK_SELECT + where + " ORDER BY w.submitted_at DESC, w.id LIMIT ? OFFSET ?", WEEK, pageArgs.toArray());
            long t = total == null ? 0 : total;
            int pages = (int) ((t + s - 1) / s);
            return new PageResponse<>(rows, p, s, t, pages, p + 1 >= pages);
        });
    }

    /** GET /v1/timesheets/weeks/{id}/entries: the week's entries, for an approver whose team the person is in. */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> entriesOfWeek(Jwt jwt, UUID weekId) {
        return FeatureNotReady.guard(() -> {
            Week w = week(weekId);
            assertCanSee(jwt, w.employeeId());
            return jdbc.queryForList("""
                    SELECT t.id, t.work_date AS "workDate", t.description, t.minutes, t.project_id AS "projectId",
                           p.name AS "projectName", p.code AS "projectCode"
                      FROM hrms.time_entries t
                      LEFT JOIN hrms.projects p ON p.id = t.project_id AND p.tenant_id = t.tenant_id
                     WHERE t.tenant_id = ? AND t.employee_id = ? AND t.work_date BETWEEN ? AND ?
                     ORDER BY t.work_date, t.created_at
                    """, TenantContext.requireTenantId(), w.employeeId(), w.weekStart(), w.weekStart().plusDays(6));
        });
    }

    /**
     * POST /v1/timesheets/weeks/{id}/decision. Only a SUBMITTED week, never your
     * own, and only for someone in your team scope. An approved week stays
     * locked; a rejected one opens for edits again.
     */
    @Transactional
    public Week decide(Jwt jwt, UUID weekId, String statusIn, String comment, String byName) {
        String decision = statusIn == null ? "" : statusIn.trim().toUpperCase();
        if (!APPROVED.equals(decision) && !REJECTED.equals(decision))
            throw new BusinessRuleException("Choose Approve or Reject.", "TIMESHEET_DECISION_INVALID");
        String note = comment == null || comment.isBlank() ? null : comment.trim();
        if (note != null && note.length() > NOTE_MAX)
            throw new BusinessRuleException("Keep the note under " + NOTE_MAX + " characters.", "TIMESHEET_NOTE_TOO_LONG");
        UUID tenant = TenantContext.requireTenantId();
        return FeatureNotReady.guard(() -> {
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT employee_id, status FROM hrms.timesheet_weeks WHERE id = ? AND tenant_id = ? FOR UPDATE", weekId, tenant);
            if (rows.isEmpty()) throw new ResourceNotFoundException("Timesheet week", weekId);
            UUID employeeId = (UUID) rows.get(0).get("employee_id");
            UUID caller = callerEmployeeId(jwt);
            if (employeeId.equals(caller))
                throw new BusinessRuleException("You can't approve or reject your own timesheet.", "SELF_APPROVAL_NOT_ALLOWED");
            assertCanSee(jwt, employeeId);
            String current = (String) rows.get(0).get("status");
            if (!SUBMITTED.equals(current))
                throw new HrmsException("This week was already " + (APPROVED.equals(current) ? "approved" : "rejected") + ".",
                        HttpStatus.CONFLICT, "TIMESHEET_WEEK_NOT_SUBMITTED");
            UUID userId = null;
            try { userId = UUID.fromString(jwt.getSubject()); } catch (Exception ignored) { /* non-UUID subject */ }
            String name = byName == null ? null : byName.length() > 200 ? byName.substring(0, 200) : byName;
            jdbc.update("""
                    UPDATE hrms.timesheet_weeks
                       SET status = ?, decided_at = now(), decided_by_user_id = ?, decided_by_employee_id = ?,
                           decided_by_name = ?, note = ?, updated_at = now()
                     WHERE id = ? AND tenant_id = ?
                    """, decision, userId, caller, name, note, weekId, tenant);
            return week(weekId);
        });
    }

    /** Who a submitted week goes to (the notification path): their employee id, or null. */
    UUID approverOf(UUID employeeId) {
        return approvers.approversOf(List.of(employeeId)).get(employeeId);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static final String WEEK_SELECT = """
            SELECT w.id, w.employee_id, w.week_start, w.status, w.total_minutes, w.submitted_at, w.decided_at,
                   w.decided_by_name, w.note, e.first_name, e.last_name, e.employee_code, d.name AS department_name
              FROM hrms.timesheet_weeks w
              JOIN hrms.employees e ON e.id = w.employee_id AND e.tenant_id = w.tenant_id
              LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
            """;

    private static final RowMapper<Week> WEEK = (rs, i) -> {
        Timestamp decided = rs.getTimestamp("decided_at");
        return new Week((UUID) rs.getObject("id"), (UUID) rs.getObject("employee_id"),
                joinName(rs.getString("first_name"), rs.getString("last_name")),
                rs.getDate("week_start").toLocalDate(), rs.getString("status"), rs.getInt("total_minutes"),
                rs.getTimestamp("submitted_at").toInstant(), decided != null ? decided.toInstant() : null,
                rs.getString("decided_by_name"), rs.getString("note"), rs.getString("employee_code"),
                rs.getString("department_name"));
    };

    private Week week(UUID id) {
        List<Week> rows = jdbc.query(WEEK_SELECT + " WHERE w.id = ? AND w.tenant_id = ?", WEEK, id, TenantContext.requireTenantId());
        if (rows.isEmpty()) throw new ResourceNotFoundException("Timesheet week", id);
        return rows.get(0);
    }

    /** The people whose weeks the caller may see and decide: their team scope (HR and admins: the company). */
    private List<UUID> teamIds(Jwt jwt) {
        try {
            return teamScope.resolve(jwt, null).stream().map(Employee::getId).toList();
        } catch (IllegalArgumentException noEmployeeRecord) {
            return List.of();
        }
    }

    private void assertCanSee(Jwt jwt, UUID employeeId) {
        if (!teamIds(jwt).contains(employeeId)) throw new AccessDeniedException("This timesheet is not from your team.");
    }

    static UUID callerEmployeeId(Jwt jwt) {
        String e = jwt.getClaimAsString("employee_id");
        return UUID.fromString(e != null ? e : jwt.getSubject());
    }

    static String joinName(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (first != null && !first.isBlank() && !"null".equalsIgnoreCase(first.trim())) sb.append(first.trim());
        if (last != null && !last.isBlank() && !"null".equalsIgnoreCase(last.trim())) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(last.trim());
        }
        return sb.toString();
    }

    private static String in(int n) {
        return String.join(",", Collections.nCopies(n, "?"));
    }
}
