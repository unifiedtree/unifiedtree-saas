package com.unifiedtree.notifications.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Tenant-scoped reads for the notification fan-out.
 *
 * <h2>Why this class exists at all</h2>
 *
 * {@code DomainEventListener} runs at {@code AFTER_COMMIT}. At that point the
 * originating transaction has committed but its {@code ConnectionHolder} is
 * still bound to the thread, so a plain {@code JdbcTemplate} call reuses that
 * same connection — and the COMMIT already discarded the
 * {@code SET LOCAL app.tenant_id} that {@code TenantAwareDataSource} put there.
 * Every RLS-protected table (hrms.employees, hrms.departments, rbac.user_roles,
 * auth.user_credentials — all four are FORCE ROW LEVEL SECURITY) then matches
 * {@code tenant_id = NULL} and returns zero rows, silently.
 *
 * <p>The visible damage in production was:
 * <ul>
 *   <li>every leave / WFH / correction / shift alert read
 *       <em>"An employee requested ..."</em> instead of the person's name,
 *       because the name lookup came back null; and</li>
 *   <li>attendance-correction alerts were dropped entirely — the approver
 *       lookup returned null and the listener skips the notification when it
 *       cannot resolve a recipient.</li>
 * </ul>
 *
 * <p>{@code REQUIRES_NEW} is the fix: it suspends the completing transaction and
 * pulls a <em>fresh</em> connection, which sends the tenant id through
 * {@code TenantAwareDataSource#getConnection} again. This is the same mechanism
 * {@link AppNotificationService#create} already relies on to write its rows —
 * these reads simply needed to follow it.
 *
 * <p>All methods are best-effort and return null on failure: a notification with
 * a slightly generic body is far better than a failed leave application.
 */
@Service
public class NotificationLookupService {

    private static final Logger log = LoggerFactory.getLogger(NotificationLookupService.class);

    private final JdbcTemplate jdbc;

    public NotificationLookupService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Full name of an employee, or null when unknown / not visible. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public String employeeName(UUID employeeId, UUID tenantId) {
        if (employeeId == null || tenantId == null) return null;
        try {
            String name = jdbc.query("""
                    SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
                      FROM hrms.employees
                     WHERE id = ? AND tenant_id = ?
                     LIMIT 1
                    """, rs -> rs.next() ? rs.getString(1) : null, employeeId, tenantId);
            // An employee row with both name columns blank trims to "", which
            // would render as a leading space in "  requested Casual Leave".
            return (name == null || name.isBlank()) ? null : name;
        } catch (Exception ex) {
            log.warn("employeeName lookup failed for {} (tenant={}): {}",
                    employeeId, tenantId, ex.toString());
            return null;
        }
    }

    /** Reporting manager, falling back to the department head. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public UUID directApprover(UUID employeeId, UUID tenantId) {
        if (employeeId == null || tenantId == null) return null;
        try {
            return jdbc.query("""
                    SELECT COALESCE(e.reporting_manager_id, d.department_head_employee_id)
                      FROM hrms.employees e
                      LEFT JOIN hrms.departments d
                        ON d.id = e.department_id AND d.tenant_id = e.tenant_id
                     WHERE e.id = ? AND e.tenant_id = ?
                     LIMIT 1
                    """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null, employeeId, tenantId);
        } catch (Exception ex) {
            log.warn("directApprover lookup failed for {}: {}", employeeId, ex.toString());
            return null;
        }
    }

    /** Longest-serving active holder of a role — the terminal approver fallback. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public UUID firstEmployeeWithRole(UUID tenantId, UUID roleId) {
        if (tenantId == null || roleId == null) return null;
        try {
            return jdbc.query("""
                    SELECT uc.employee_id
                      FROM rbac.user_roles ur
                      JOIN auth.user_credentials uc ON uc.id = ur.user_id
                     WHERE ur.tenant_id = ?
                       AND ur.role_id = ?
                       AND uc.employee_id IS NOT NULL
                       AND uc.is_active = TRUE
                     ORDER BY uc.created_at
                     LIMIT 1
                    """, rs -> rs.next() ? rs.getObject(1, UUID.class) : null, tenantId, roleId);
        } catch (Exception ex) {
            log.warn("role-holder lookup failed (role={}, tenant={}): {}", roleId, tenantId, ex.toString());
            return null;
        }
    }
}
