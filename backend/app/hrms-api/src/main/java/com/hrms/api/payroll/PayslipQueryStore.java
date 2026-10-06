package com.hrms.api.payroll;

import com.hrms.core.exception.FeatureNotReady;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * JDBC access to {@code payroll.payslip_queries} (V143.58, "Ask payroll") and
 * the few existing rows the questions depend on. Every statement filters on the
 * tenant; the caller has bound it for row-level security in its transaction.
 *
 * <p>Statements on the new table go through {@link FeatureNotReady}: while the
 * migration isn't applied they answer 503 FEATURE_NOT_READY instead of a 500.
 */
@Repository
public class PayslipQueryStore {

    private final JdbcTemplate jdbc;

    public PayslipQueryStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** A question as the pages show it (the employee's own list and the payroll team's queue). */
    public record QueryRow(UUID id, UUID runId, String period, int periodMonth, int periodYear,
                           UUID employeeId, String employeeName, String employeeCode,
                           UUID companyId, String companyName, String message, String status,
                           String answer, String answeredByName, String answeredAt,
                           String createdAt, UUID raisedByUserId) {}

    /** The run behind a payslip the employee may ask about. */
    public record OwnPayslip(UUID runId, UUID companyId, int periodMonth, int periodYear) {}

    // ── existing tables ───────────────────────────────────────────────────────

    /**
     * The caller's own LOCKED or PAID payslip for a run, or empty: another
     * person's run, a draft, or a run without a payslip for them (the same rule
     * as GET /payslips/me/{runId}).
     */
    public Optional<OwnPayslip> ownPayslip(UUID tenantId, UUID employeeId, UUID runId) {
        List<OwnPayslip> rows = jdbc.query("""
            SELECT r.id, r.company_id, r.period_month, r.period_year
              FROM payroll.runs r
             WHERE r.tenant_id = ? AND r.id = ? AND r.status IN ('LOCKED','PAID')
               AND EXISTS (SELECT 1 FROM payroll.payslip_lines l
                            WHERE l.tenant_id = r.tenant_id AND l.run_id = r.id AND l.employee_id = ?)
            """, (rs, i) -> new OwnPayslip(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                rs.getInt("period_month"), rs.getInt("period_year")), tenantId, runId, employeeId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** A person's name as notifications show it ("Priya Rao"); null when unknown. */
    public String employeeName(UUID tenantId, UUID employeeId) {
        if (employeeId == null) return null;
        List<String> rows = jdbc.query("""
            SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') FROM hrms.employees
             WHERE tenant_id = ? AND id = ?
            """, (rs, i) -> rs.getString(1), tenantId, employeeId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** A signed-in account's name (display name, else their employee name); null when neither is set. */
    public String accountName(UUID tenantId, UUID userId) {
        if (userId == null) return null;
        List<String> rows = jdbc.query("""
            SELECT COALESCE(NULLIF(btrim(u.display_name), ''),
                            NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''))
              FROM auth.user_credentials u
              LEFT JOIN hrms.employees e ON e.id = u.employee_id
             WHERE u.tenant_id = ? AND u.id = ?
            """, (rs, i) -> rs.getString(1), tenantId, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * Employees whose sign-in may answer payslip questions: {@code permission}
     * through one of their roles or a per-person grant, and not taken away by a
     * per-person deny (the same effective set PermissionChecker uses). Active
     * accounts only, without {@code except}, at most {@code limit}.
     */
    /**
     * Employees granted, in {@code forEmployee}'s company, a role that carries
     * {@code permission} (COMPANY_ACCESS.md), without {@code except}. Empty
     * before the grants table exists.
     */
    public List<UUID> employeesGranted(UUID tenantId, String permission, UUID forEmployee, UUID except) {
        if (!com.unifiedtree.security.tenant.CompanyGrants.ready(jdbc)) return List.of();
        UUID company = com.unifiedtree.security.tenant.CompanyGrants.companyOf(jdbc, forEmployee);
        return com.unifiedtree.security.tenant.CompanyGrants.employeesGrantedPermission(jdbc, tenantId, permission, company)
                .stream().filter(id -> !id.equals(except)).toList();
    }

    public List<UUID> employeesHolding(UUID tenantId, String permission, UUID except, int limit) {
        Boolean overrides = jdbc.queryForObject("""
            SELECT CASE WHEN to_regclass('rbac.user_permission_overrides') IS NULL THEN false
                        ELSE has_table_privilege('rbac.user_permission_overrides', 'SELECT') END
            """, Boolean.class);
        boolean withOverrides = Boolean.TRUE.equals(overrides);
        StringBuilder sql = new StringBuilder("""
            SELECT uc.employee_id
              FROM auth.user_credentials uc
             WHERE uc.tenant_id = ? AND uc.is_active = TRUE AND uc.employee_id IS NOT NULL
               AND (EXISTS (SELECT 1 FROM rbac.user_roles ur
                              JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id
                             WHERE ur.tenant_id = uc.tenant_id AND ur.user_id = uc.id AND rp.permission_code = ?)
            """);
        List<Object> args = new ArrayList<>(List.of(tenantId, permission));
        if (withOverrides) {
            sql.append("""
                    OR EXISTS (SELECT 1 FROM rbac.user_permission_overrides o
                                WHERE o.tenant_id = uc.tenant_id AND o.user_id = uc.id AND o.permission_code = ?
                                  AND o.effect = 'GRANT' AND (o.expires_at IS NULL OR o.expires_at > now()))
                """);
            args.add(permission);
        }
        sql.append(")");
        if (withOverrides) {
            sql.append("""
                 AND NOT EXISTS (SELECT 1 FROM rbac.user_permission_overrides d
                                  WHERE d.tenant_id = uc.tenant_id AND d.user_id = uc.id AND d.permission_code = ?
                                    AND d.effect = 'DENY' AND (d.expires_at IS NULL OR d.expires_at > now()))
                """);
            args.add(permission);
        }
        if (except != null) {
            sql.append(" AND uc.employee_id <> ?");
            args.add(except);
        }
        sql.append(" GROUP BY uc.employee_id ORDER BY min(uc.created_at) LIMIT ?");
        args.add(limit);
        return jdbc.queryForList(sql.toString(), UUID.class, args.toArray());
    }

    // ── payroll.payslip_queries (V143.58) ─────────────────────────────────────

    private static final String SELECT = """
        SELECT q.id, q.run_id, q.employee_id, q.company_id, q.message, q.status, q.answer,
               q.answered_at, q.created_at, q.raised_by_user_id,
               r.period_month, r.period_year,
               NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '') AS employee_name, e.employee_code,
               c.name AS company_name,
               COALESCE(NULLIF(btrim(au.display_name), ''),
                        NULLIF(btrim(concat_ws(' ', ae.first_name, ae.last_name)), '')) AS answered_by_name
          FROM payroll.payslip_queries q
          JOIN payroll.runs r ON r.id = q.run_id
          LEFT JOIN hrms.employees e ON e.id = q.employee_id
          LEFT JOIN org.companies c ON c.id = q.company_id
          LEFT JOIN auth.user_credentials au ON au.id = q.answered_by_user_id
          LEFT JOIN hrms.employees ae ON ae.id = COALESCE(q.answered_by_employee_id, au.employee_id)
        """;

    private static final RowMapper<QueryRow> ROW = (rs, i) -> new QueryRow(
            rs.getObject("id", UUID.class), rs.getObject("run_id", UUID.class),
            PayrollInsights.periodLabel(rs.getInt("period_month"), rs.getInt("period_year")),
            rs.getInt("period_month"), rs.getInt("period_year"),
            rs.getObject("employee_id", UUID.class), rs.getString("employee_name"), rs.getString("employee_code"),
            rs.getObject("company_id", UUID.class), rs.getString("company_name"),
            rs.getString("message"), rs.getString("status"), rs.getString("answer"),
            rs.getString("answered_by_name"), ts(rs.getTimestamp("answered_at")), ts(rs.getTimestamp("created_at")),
            rs.getObject("raised_by_user_id", UUID.class));

    public UUID insert(UUID tenantId, OwnPayslip slip, UUID employeeId, String message, UUID raisedByUserId) {
        return FeatureNotReady.guard(() -> jdbc.queryForObject("""
            INSERT INTO payroll.payslip_queries (tenant_id, run_id, employee_id, company_id, message, raised_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            """, UUID.class, tenantId, slip.runId(), employeeId, slip.companyId(), message, raisedByUserId));
    }

    public Optional<QueryRow> find(UUID tenantId, UUID id) {
        List<QueryRow> rows = FeatureNotReady.guard(() ->
                jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.id = ?", ROW, tenantId, id));
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** The employee's own questions, newest first; one run's only when {@code runId} is given. */
    public List<QueryRow> listForEmployee(UUID tenantId, UUID employeeId, UUID runId, int limit) {
        return FeatureNotReady.guard(() -> runId == null
                ? jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.employee_id = ? ORDER BY q.created_at DESC LIMIT ?",
                        ROW, tenantId, employeeId, limit)
                : jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.employee_id = ? AND q.run_id = ?"
                        + " ORDER BY q.created_at DESC LIMIT ?", ROW, tenantId, employeeId, runId, limit));
    }

    /**
     * The payroll team's queue: the workspace's questions, newest first, optionally one status. Without a
     * status, questions taken off the queue ("Remove", CLOSED) are left out; status CLOSED lists them.
     */
    public List<QueryRow> list(UUID tenantId, String status, int limit) {
        return FeatureNotReady.guard(() -> status == null
                ? jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.status <> 'CLOSED' ORDER BY q.created_at DESC LIMIT ?",
                        ROW, tenantId, limit)
                : jdbc.query(SELECT + " WHERE q.tenant_id = ? AND q.status = ? ORDER BY q.created_at DESC LIMIT ?",
                        ROW, tenantId, status, limit));
    }

    /** Answers an OPEN question; false when it was already answered (or isn't there). */
    public boolean answer(UUID tenantId, UUID id, String answer, UUID userId, UUID employeeId) {
        Integer n = FeatureNotReady.guard(() -> jdbc.update("""
            UPDATE payroll.payslip_queries
               SET status = 'ANSWERED', answer = ?, answered_by_user_id = ?, answered_by_employee_id = ?,
                   answered_at = now(), updated_at = now()
             WHERE tenant_id = ? AND id = ? AND status = 'OPEN'
            """, answer, userId, employeeId, tenantId, id));
        return n != null && n > 0;
    }

    /** Takes an ANSWERED question off the queue (status CLOSED); false when it isn't ANSWERED (or isn't there). */
    public boolean close(UUID tenantId, UUID id) {
        Integer n = FeatureNotReady.guard(() -> jdbc.update("""
            UPDATE payroll.payslip_queries
               SET status = 'CLOSED', updated_at = now()
             WHERE tenant_id = ? AND id = ? AND status = 'ANSWERED'
            """, tenantId, id));
        return n != null && n > 0;
    }

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }
}
