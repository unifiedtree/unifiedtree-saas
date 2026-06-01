package com.unifiedtree.saas.service;

import com.unifiedtree.saas.dto.SaasDtos.SignupRequest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Array;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Multi-statement writes for the SaaS portal. Lives in its own bean so the
 * {@code @Transactional} advice is applied via the proxy on each call --
 * self-invocation from {@link SaasService} would bypass the proxy and the
 * SET LOCAL app.tenant_id wouldn't be issued at connection lease.
 */
@Component
public class SaasWriter {

    private static final UUID SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OWNER_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000010");

    private final JdbcTemplate jdbc;

    public SaasWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Atomically create the tenant, reserve its subdomain, record requested
     * modules, and create the first admin user with SUPER_ADMIN role.
     *
     * <p>Caller MUST set TenantContext to {@code tenantId} BEFORE invoking
     * this method so the SET LOCAL on connection lease lets the RLS-protected
     * auth.user_credentials + rbac.user_roles inserts succeed.
     */
    @Transactional
    public void signup(UUID tenantId,
                       UUID accountId,
                       UUID adminUserId,
                       String subdomain,
                       String baseDomain,
                       String passwordHash,
                       List<String> requestedModules,
                       SignupRequest req) {
        try {
            UUID companyId = UUID.randomUUID();
            UUID branchId = UUID.randomUUID();
            UUID departmentId = UUID.randomUUID();
            UUID designationId = UUID.randomUUID();
            Array requestedArray = jdbc.execute(
                    (java.sql.Connection conn) -> conn.createArrayOf("text", requestedModules.toArray(new String[0])));
            Boolean firstWorkspace = jdbc.queryForObject("""
                    SELECT NOT EXISTS (
                        SELECT 1 FROM platform.account_workspaces
                         WHERE account_id = ?
                           AND status = 'ACTIVE'
                    )
                    """, Boolean.class, accountId);

            jdbc.update("""
                    INSERT INTO platform.accounts
                        (id, email, display_name, phone, password_hash, status,
                         failed_login_count, password_updated_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, now(), now(), now())
                    ON CONFLICT DO NOTHING
                    """,
                    accountId,
                    req.adminEmail().trim().toLowerCase(java.util.Locale.ROOT),
                    req.adminName().trim(),
                    nullIfBlank(req.adminMobile()),
                    passwordHash);

            jdbc.update("""
                    INSERT INTO platform.tenants
                        (id, subdomain, display_name, contact_email, contact_phone, admin_name,
                         owner_account_id, created_by_account_id,
                         status, plan_type, region, requested_modules, created_at, approved_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'STARTER', 'in', ?, now(), now())
                    """,
                    tenantId, subdomain, req.companyName().trim(),
                    req.adminEmail().trim().toLowerCase(java.util.Locale.ROOT),
                    nullIfBlank(req.adminMobile()),
                    req.adminName().trim(),
                    accountId,
                    accountId,
                    requestedArray);

            jdbc.update("""
                    INSERT INTO platform.tenant_domains
                        (id, tenant_id, domain, is_primary, created_at)
                    VALUES (?, ?, ?, TRUE, now())
                    """,
                    UUID.randomUUID(), tenantId, subdomain + "." + baseDomain);

            for (String moduleKey : requestedModules) {
                Boolean available = jdbc.query(
                        "SELECT is_available FROM platform.module_catalog WHERE key = ?",
                        rs -> rs.next() ? rs.getBoolean("is_available") : null,
                        moduleKey);
                if (available == null) {
                    continue;
                }
                if (available) {
                    jdbc.update("""
                            INSERT INTO platform.tenant_modules
                                (id, tenant_id, module_key, status, requested_at, approved_at, activated_at)
                            VALUES (?, ?, ?, 'ACTIVE', now(), now(), now())
                            ON CONFLICT (tenant_id, module_key) DO NOTHING
                            """, UUID.randomUUID(), tenantId, moduleKey);
                } else {
                    jdbc.update("""
                            INSERT INTO platform.tenant_modules
                                (id, tenant_id, module_key, status, requested_at)
                            VALUES (?, ?, ?, 'REQUESTED', now())
                            ON CONFLICT (tenant_id, module_key) DO NOTHING
                            """, UUID.randomUUID(), tenantId, moduleKey);
                }
            }

            createWorkspaceSeedData(tenantId, adminUserId, companyId, branchId, departmentId, designationId, req);

            // RLS-protected inserts: SET LOCAL app.tenant_id (set by the
            // TenantContext + TenantAwareDataSource pair) must match these rows.
            jdbc.update("""
                    INSERT INTO auth.user_credentials
                        (id, tenant_id, email, mobile_number, password_hash, employee_id, is_active,
                         is_biometric_enabled, failed_login_count,
                         created_at, updated_at, created_by, updated_by, version)
                    VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE, 0, now(), now(), 'signup', 'signup', 0)
                    """,
                    adminUserId, tenantId,
                    req.adminEmail().trim().toLowerCase(java.util.Locale.ROOT),
                    nullIfBlank(req.adminMobile()),
                    passwordHash,
                    adminUserId);

            jdbc.update("""
                    INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
                    VALUES (?, ?, ?, now(), ?)
                    """,
                    tenantId, adminUserId, SUPER_ADMIN_ROLE_ID, adminUserId);

            jdbc.update("""
                    INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by)
                    VALUES (?, ?, ?, now(), ?)
                    ON CONFLICT DO NOTHING
                    """,
                    tenantId, adminUserId, OWNER_ROLE_ID, adminUserId);

            jdbc.update("""
                    INSERT INTO platform.account_workspaces
                        (id, account_id, tenant_id, auth_user_id, role, default_workspace,
                         status, joined_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'OWNER', ?, 'ACTIVE', now(), now(), now())
                    ON CONFLICT (account_id, tenant_id) DO UPDATE
                        SET auth_user_id = EXCLUDED.auth_user_id,
                            role = 'OWNER',
                            default_workspace = account_workspaces.default_workspace OR EXCLUDED.default_workspace,
                            status = 'ACTIVE',
                            updated_at = now()
                    """,
                    UUID.randomUUID(), accountId, tenantId, adminUserId, Boolean.TRUE.equals(firstWorkspace));
        } catch (DataIntegrityViolationException e) {
            // Most likely the subdomain UNIQUE constraint or a duplicate email.
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Signup failed: " + rootMessage(e));
        }
    }

    private void createWorkspaceSeedData(UUID tenantId,
                                         UUID adminUserId,
                                         UUID companyId,
                                         UUID branchId,
                                         UUID departmentId,
                                         UUID designationId,
                                         SignupRequest req) {
        String companyName = req.companyName().trim();
        String country = defaultText(req.country(), "India");
        String timezone = defaultText(req.timezone(), "Asia/Kolkata");
        String currency = defaultText(req.currency(), "INR");
        String[] adminName = splitName(req.adminName());
        LocalDate today = LocalDate.now();

        jdbc.update("""
                INSERT INTO org.companies
                    (id, tenant_id, name, legal_name, industry, country, timezone, currency,
                     employee_count_cached, is_active, created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, TRUE, now(), now(), 'signup', 'signup', 0)
                """,
                companyId, tenantId, companyName, companyName, nullIfBlank(req.industry()), country, timezone, currency);

        jdbc.update("""
                INSERT INTO org.branches
                    (id, tenant_id, company_id, name, code, country, geo_fence_radius_meters,
                     employee_count_cached, is_headquarters, is_active, created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, 'Head Office', 'HQ', ?, 100, 1, TRUE, TRUE, now(), now(), 'signup', 'signup', 0)
                """,
                branchId, tenantId, companyId, country);

        jdbc.update("""
                INSERT INTO hrms.departments
                    (id, tenant_id, company_id, name, code, employee_count_cached, is_active,
                     created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, 'Administration', 'ADMIN', 1, TRUE, now(), now(), 'signup', 'signup', 0)
                """,
                departmentId, tenantId, companyId);

        jdbc.update("""
                INSERT INTO hrms.designations
                    (id, tenant_id, company_id, title, grade, department_id, headcount_cached, is_active,
                     created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, 'Company Administrator', 'L1', ?, 1, TRUE, now(), now(), 'signup', 'signup', 0)
                """,
                designationId, tenantId, companyId, departmentId);

        jdbc.update("""
                INSERT INTO hrms.employees
                    (id, tenant_id, company_id, employee_code, first_name, last_name, email, phone,
                     department_id, designation_id, branch_id, employment_type, employment_status,
                     date_of_joining, confirmation_date, job_title, is_face_enrolled, is_active,
                     created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, 'ADM001', ?, ?, ?, ?, ?, ?, ?, 'FULL_TIME', 'ACTIVE',
                        ?, ?, 'Company Administrator', FALSE, TRUE,
                        now(), now(), 'signup', 'signup', 0)
                """,
                adminUserId, tenantId, companyId, adminName[0], adminName[1],
                req.adminEmail().trim().toLowerCase(java.util.Locale.ROOT),
                nullIfBlank(req.adminMobile()), departmentId, designationId, branchId, today, today);

        jdbc.update("""
                UPDATE org.branches
                   SET manager_employee_id = ?, updated_at = now()
                 WHERE id = ? AND tenant_id = ?
                """, adminUserId, branchId, tenantId);

        jdbc.update("""
                UPDATE hrms.departments
                   SET department_head_employee_id = ?, updated_at = now()
                 WHERE id = ? AND tenant_id = ?
                """, adminUserId, departmentId, tenantId);

        UUID shiftPolicyId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO attendance.shift_policies
                    (id, tenant_id, company_id, name, shift_type, start_time, end_time,
                     grace_period_minutes, working_hours_per_day, is_active,
                     created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, 'Standard 9-6', 'FIXED', '09:00', '18:00',
                        30, 8.0, TRUE, now(), now(), 'signup', 'signup', 0)
                """,
                shiftPolicyId, tenantId, companyId);

        jdbc.update("""
                INSERT INTO attendance.employee_shift_assignments
                    (id, tenant_id, employee_id, shift_policy_id, effective_from,
                     created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, ?, ?, ?, now(), now(), 'signup', 'signup', 0)
                """,
                UUID.randomUUID(), tenantId, adminUserId, shiftPolicyId, today);

        int year = today.getYear();
        for (LeaveTypeSeed leaveType : List.of(
                new LeaveTypeSeed(UUID.randomUUID(), "Annual Leave", "ANNUAL", 21),
                new LeaveTypeSeed(UUID.randomUUID(), "Sick Leave", "SICK", 12),
                new LeaveTypeSeed(UUID.randomUUID(), "Casual Leave", "CASUAL", 6))) {
            jdbc.update("""
                    INSERT INTO leave_mgmt.leave_types
                        (id, tenant_id, company_id, name, code, annual_entitlement, is_paid_leave,
                         category, description, is_active, created_at, updated_at, created_by, updated_by, version)
                    VALUES (?, ?, ?, ?, ?, ?, TRUE, 'PAID', ?, TRUE, now(), now(), 'signup', 'signup', 0)
                    """,
                    leaveType.id(), tenantId, companyId, leaveType.name(), leaveType.code(),
                    leaveType.days(), leaveType.name());

            jdbc.update("""
                    INSERT INTO leave_mgmt.leave_balances
                        (id, tenant_id, employee_id, leave_type_id, year, total_entitlement,
                         accrued, used, pending, created_at, updated_at, created_by, updated_by, version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, now(), now(), 'signup', 'signup', 0)
                    """,
                    UUID.randomUUID(), tenantId, adminUserId, leaveType.id(), year,
                    leaveType.days(), leaveType.days());
        }
    }

    @Transactional
    public void approve(UUID tenantId, UUID approverUserId, List<String> approvedModules) {
        int updated = jdbc.update("""
                UPDATE platform.tenants
                   SET status = 'ACTIVE',
                       approved_at = now(),
                       approved_by = ?
                 WHERE id = ?
                   AND status IN ('PENDING_APPROVAL','REJECTED','SUSPENDED')
                """, approverUserId, tenantId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Tenant not found or not in an approvable state");
        }
        Instant now = Instant.now();
        for (String moduleKey : approvedModules) {
            // Upsert: if the module was requested, flip it to ACTIVE. If not
            // requested but the admin explicitly approves it, insert it.
            jdbc.update("""
                    INSERT INTO platform.tenant_modules
                        (id, tenant_id, module_key, status, requested_at, approved_at, approved_by, activated_at)
                    VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
                    ON CONFLICT (tenant_id, module_key)
                    DO UPDATE SET status = 'ACTIVE',
                                  approved_at = EXCLUDED.approved_at,
                                  approved_by = EXCLUDED.approved_by,
                                  activated_at = EXCLUDED.activated_at
                    """,
                    UUID.randomUUID(), tenantId, moduleKey,
                    Timestamp.from(now), Timestamp.from(now), approverUserId, Timestamp.from(now));
        }
    }

    @Transactional
    public void reject(UUID tenantId, UUID rejectorUserId, String reason) {
        int updated = jdbc.update("""
                UPDATE platform.tenants
                   SET status = 'REJECTED',
                       rejected_at = now(),
                       rejected_by = ?,
                       rejection_reason = ?
                 WHERE id = ?
                   AND status = 'PENDING_APPROVAL'
                """, rejectorUserId, reason, tenantId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Tenant not found or not in a rejectable state");
        }
        jdbc.update("""
                UPDATE platform.tenant_modules
                   SET status = 'EXPIRED'
                 WHERE tenant_id = ?
                   AND status IN ('REQUESTED','APPROVED')
                """, tenantId);
    }

    private static String nullIfBlank(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String defaultText(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    private static String[] splitName(String fullName) {
        String[] parts = fullName == null ? new String[0] : fullName.trim().split("\\s+", 2);
        String first = parts.length > 0 && !parts[0].isBlank() ? parts[0] : "Admin";
        String last = parts.length > 1 && !parts[1].isBlank() ? parts[1] : "User";
        return new String[]{first, last};
    }

    private record LeaveTypeSeed(UUID id, String name, String code, int days) {}

    private static String rootMessage(Throwable t) {
        Throwable cur = t;
        while (cur.getCause() != null && cur.getCause() != cur) cur = cur.getCause();
        return cur.getMessage() != null ? cur.getMessage().split("\n")[0] : "duplicate value";
    }
}
