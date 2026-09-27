package com.hrms.api.onboarding;

import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The New hires overview (redesign BW-69): each onboarding with the new hire's
 * name, department and joining date, the checklist's name and its task
 * counts, plus the page's counts, in one query and for every company (the page
 * used to look names up person by person and take departments from the first
 * company only).
 *
 * <p>Scope is the list's rule: people who manage onboarding
 * ({@code hrms.onboarding.instance.write}) see every onboarding in the
 * workspace; everyone else sees only their own.
 */
@Service
public class OnboardingOverviewService {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    public OnboardingOverviewService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param tasksDone    tasks marked done or skipped
     * @param tasksOverdue pending tasks whose due date is before today (India time)
     * @param nextDueOn    the earliest due date among pending tasks
     */
    public record Row(UUID instanceId, UUID employeeId, String employeeName, String employeeCode,
                      UUID companyId, UUID departmentId, String departmentName, LocalDate dateOfJoining,
                      UUID templateId, String templateName, String status, Instant startedAt, Instant completedAt,
                      long tasksTotal, long tasksDone, long tasksOverdue, LocalDate nextDueOn) {}

    /**
     * Counts over every onboarding in scope (the status filter does not change them).
     * @param joiningThisMonth onboardings whose new hire joins this calendar month (India time)
     * @param tasksOverdue     overdue tasks across onboardings that are in progress
     */
    public record Counts(long all, long inProgress, long onHold, long completed, long joiningThisMonth, long tasksOverdue) {}

    public record Overview(Counts counts, List<Row> rows) {}

    /**
     * @param onlyEmployeeId null for the whole workspace (HR), else the caller's own onboardings only
     * @param status         optional: IN_PROGRESS, ON_HOLD or COMPLETED (rows only)
     * @param companyId      optional: the new hire's company
     */
    @Transactional(readOnly = true)
    public Overview overview(UUID onlyEmployeeId, String status, UUID companyId, LocalDate today) {
        UUID tenant = TenantContext.requireTenantId();
        List<Object> args = new ArrayList<>();
        args.add(today);
        args.add(tenant);
        StringBuilder where = new StringBuilder(" WHERE i.tenant_id = ?");
        if (onlyEmployeeId != null) { where.append(" AND i.employee_id = ?"); args.add(onlyEmployeeId); }
        if (companyId != null) { where.append(" AND e.company_id = ?"); args.add(companyId); }

        List<Row> all = jdbc.query("""
                SELECT i.id, i.employee_id, concat_ws(' ', e.first_name, e.last_name) AS employee_name, e.employee_code,
                       e.company_id, e.department_id, d.name AS department_name, e.date_of_joining,
                       i.template_id, t.name AS template_name, i.status, i.started_at, i.completed_at,
                       count(it.id) AS tasks_total,
                       count(it.id) FILTER (WHERE it.status IN ('COMPLETED', 'SKIPPED')) AS tasks_done,
                       count(it.id) FILTER (WHERE it.status = 'PENDING' AND it.due_on < ?) AS tasks_overdue,
                       min(it.due_on) FILTER (WHERE it.status = 'PENDING') AS next_due_on
                  FROM hrms.onboarding_instances i
                  LEFT JOIN hrms.employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
                  LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                  LEFT JOIN hrms.onboarding_templates t ON t.id = i.template_id AND t.tenant_id = i.tenant_id
                  LEFT JOIN hrms.onboarding_instance_tasks it ON it.instance_id = i.id AND it.tenant_id = i.tenant_id
                """ + where + """
                 GROUP BY i.id, e.id, d.name, t.name
                 ORDER BY i.created_at DESC
                """, (rs, n) -> new Row(
                rs.getObject("id", UUID.class), rs.getObject("employee_id", UUID.class),
                blankToNull(rs.getString("employee_name")), rs.getString("employee_code"),
                rs.getObject("company_id", UUID.class), rs.getObject("department_id", UUID.class),
                rs.getString("department_name"), rs.getObject("date_of_joining", LocalDate.class),
                rs.getObject("template_id", UUID.class), rs.getString("template_name"), rs.getString("status"),
                instant(rs.getTimestamp("started_at")), instant(rs.getTimestamp("completed_at")),
                rs.getLong("tasks_total"), rs.getLong("tasks_done"), rs.getLong("tasks_overdue"),
                rs.getObject("next_due_on", LocalDate.class)), args.toArray());

        return new Overview(count(all, today), status == null || status.isBlank()
                ? all : all.stream().filter(r -> status.equals(r.status())).toList());
    }

    static Counts count(List<Row> rows, LocalDate today) {
        long inProgress = 0, onHold = 0, completed = 0, joining = 0, overdue = 0;
        for (Row r : rows) {
            switch (r.status() == null ? "" : r.status()) {
                case "IN_PROGRESS" -> { inProgress++; overdue += r.tasksOverdue(); }
                case "ON_HOLD" -> onHold++;
                case "COMPLETED" -> completed++;
                default -> { }
            }
            LocalDate doj = r.dateOfJoining();
            if (doj != null && doj.getYear() == today.getYear() && doj.getMonth() == today.getMonth()) joining++;
        }
        return new Counts(rows.size(), inProgress, onHold, completed, joining, overdue);
    }

    /** Onboardings started from each template, by template id (the templates list's "Used by N hires"). */
    @Transactional(readOnly = true)
    public Map<UUID, Long> usageByTemplate() {
        UUID tenant = TenantContext.requireTenantId();
        Map<UUID, Long> out = new java.util.HashMap<>();
        jdbc.query("SELECT template_id, count(*) AS n FROM hrms.onboarding_instances WHERE tenant_id = ? AND template_id IS NOT NULL GROUP BY template_id",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> out.put(rs.getObject("template_id", UUID.class), rs.getLong("n")), tenant);
        return out;
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
