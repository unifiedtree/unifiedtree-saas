package com.hrms.api.saas;

import com.hrms.api.saas.SaasDtos.ApprovalRequest;
import com.hrms.api.saas.SaasDtos.PlatformLoginResponse;
import com.hrms.api.saas.SaasDtos.RejectionRequest;
import com.hrms.api.saas.SaasDtos.SignupRequest;
import com.hrms.api.saas.SaasDtos.SignupResponse;
import com.hrms.api.saas.SaasDtos.SubdomainCheckResponse;
import com.hrms.api.saas.SaasDtos.TenantRequestSummary;
import com.hrms.api.saas.SaasDtos.WorkspaceStatusResponse;
import com.hrms.auth.util.JwtTokenProvider;
import com.hrms.core.enums.Role;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class SaasPlatformService {

    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");
    private static final List<String> DEFAULT_MODULES = List.of("hrms", "attendance");
    private static final List<String> DEFAULT_ADMIN_ROLES = List.of("COMPANY_ADMIN", "HR_MANAGER", "EMPLOYEE");

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final String baseDomain;
    private final long accessTokenExpiryMinutes;

    public SaasPlatformService(JdbcTemplate jdbc,
                               PasswordEncoder passwordEncoder,
                               JwtTokenProvider jwtTokenProvider,
                               @Value("${unifiedtree.base-domain:unifiedtree.com}") String baseDomain,
                               @Value("${hrms.jwt.access-token-expiry-minutes:15}") long accessTokenExpiryMinutes) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
        this.baseDomain = baseDomain;
        this.accessTokenExpiryMinutes = accessTokenExpiryMinutes;
    }

    public SubdomainCheckResponse checkSubdomain(String requested) {
        String subdomain = normalizeSubdomain(requested);
        boolean exists = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM tenant_domains WHERE subdomain = ?)",
                Boolean.class,
                subdomain));
        return new SubdomainCheckResponse(
                subdomain,
                !exists,
                exists ? "This workspace address is already reserved." : "Available");
    }

    @Transactional
    public SignupResponse createSignupRequest(SignupRequest request) {
        String subdomain = normalizeSubdomain(request.subdomain());
        if (!checkSubdomain(subdomain).available()) {
            throw new BusinessRuleException("Workspace address is already reserved.", "SUBDOMAIN_TAKEN");
        }

        List<String> requestedModules = normalizeModules(request.requestedModules());
        UUID tenantId = UUID.randomUUID();
        UUID companyId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID departmentId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID employeeId = userId;
        String fullDomain = workspaceDomain(subdomain);
        NameParts adminName = splitName(request.adminName());
        String mobile = normalizeMobile(request.adminMobile());

        jdbc.update("""
                INSERT INTO tenants (id, name, slug, status, admin_name, admin_email, admin_mobile, approved_at, approved_by)
                VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, now(), ?)
                """, tenantId, request.companyName().trim(), subdomain, request.adminName().trim(),
                request.adminEmail().trim().toLowerCase(Locale.ROOT), mobile, userId);

        jdbc.update("""
                INSERT INTO tenant_domains (tenant_id, subdomain, full_domain, status)
                VALUES (?, ?, ?, 'ACTIVE')
                """, tenantId, subdomain, fullDomain);

        jdbc.update("""
                INSERT INTO companies (id, tenant_id, name, domain, subscription_tier, max_employees,
                                       industry, country, timezone, currency, is_active)
                VALUES (?, ?, ?, ?, 'STARTER', 0, ?, ?, ?, ?, true)
                """, companyId, tenantId, request.companyName().trim(), subdomain,
                blankToNull(request.industry()), defaultText(request.country(), "India"),
                defaultText(request.timezone(), "Asia/Kolkata"), defaultText(request.currency(), "INR"));

        jdbc.update("""
                INSERT INTO branches (id, tenant_id, company_id, name, code, country,
                                      geo_fence_radius_meters, is_headquarters, is_active)
                VALUES (?, ?, ?, 'Head Office', 'HQ', ?, 100, true, true)
                """, branchId, tenantId, companyId, defaultText(request.country(), "India"));

        jdbc.update("""
                INSERT INTO departments (id, tenant_id, company_id, name, code, is_active)
                VALUES (?, ?, ?, 'Administration', 'ADMIN', true)
                """, departmentId, tenantId, companyId);

        jdbc.update("""
                INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, phone,
                                       company_id, department_id, branch_id, employment_type,
                                       employment_status, date_of_joining, job_title, is_face_enrolled)
                VALUES (?, ?, 'ADM001', ?, ?, ?, ?, ?, ?, ?, 'FULL_TIME', 'ACTIVE', ?, 'Company Administrator', false)
                """, employeeId, tenantId, adminName.firstName(), adminName.lastName(),
                request.adminEmail().trim().toLowerCase(Locale.ROOT), mobile, companyId, departmentId, branchId,
                LocalDate.now());

        jdbc.update("""
                INSERT INTO user_credentials (id, tenant_id, email, mobile_number, password_hash,
                                              employee_id, is_active, is_biometric_enabled, password_changed_at)
                VALUES (?, ?, ?, ?, ?, ?, true, false, now())
                """, userId, tenantId, request.adminEmail().trim().toLowerCase(Locale.ROOT), mobile,
                passwordEncoder.encode(request.password()), employeeId);

        for (String role : DEFAULT_ADMIN_ROLES) {
            jdbc.update("INSERT INTO user_roles (user_credential_id, role) VALUES (?, ?)", userId, role);
        }

        for (String module : requestedModules) {
            jdbc.update("""
                    INSERT INTO tenant_module_requests (tenant_id, module_key, status, decided_at, decided_by)
                    VALUES (?, ?, 'APPROVED', now(), ?)
                    ON CONFLICT (tenant_id, module_key) DO NOTHING
                    """, tenantId, module, userId);
            jdbc.update("""
                    INSERT INTO tenant_modules (tenant_id, module_key, status, activated_by, activated_at)
                    VALUES (?, ?, 'ACTIVE', ?, now())
                    ON CONFLICT (tenant_id, module_key) DO NOTHING
                    """, tenantId, module, userId);
        }

        createDefaultShiftAndLeaveData(tenantId, companyId, employeeId);
        audit(tenantId, userId, "SIGNUP_REQUESTED", null, "ACTIVE",
                "Instant approval enabled. Modules: " + String.join(",", requestedModules));

        return new SignupResponse(
                tenantId,
                companyId,
                "ACTIVE",
                subdomain,
                "https://" + fullDomain,
                requestedModules,
                "Workspace created and instantly activated.");
    }

    public WorkspaceStatusResponse workspaceStatus(String tenantIdHeader, String subdomainHeader, String host) {
        UUID tenantId = resolveTenantId(tenantIdHeader, subdomainHeader, host);
        TenantRow tenant = tenantRow(tenantId);
        return new WorkspaceStatusResponse(
                tenant.id(),
                tenant.name(),
                tenant.slug(),
                tenant.status(),
                modulesForTenant(tenant.id(), "tenant_module_requests", true),
                modulesForTenant(tenant.id(), "tenant_modules", false));
    }

    public UUID resolveTenantId(String tenantIdHeader, String subdomainHeader, String host) {
        if (tenantIdHeader != null && !tenantIdHeader.isBlank()) {
            return UUID.fromString(tenantIdHeader.trim());
        }
        String subdomain = subdomainHeader != null && !subdomainHeader.isBlank()
                ? normalizeSubdomain(subdomainHeader)
                : extractSubdomain(host);
        if (subdomain == null) {
            throw new BusinessRuleException("Tenant workspace could not be resolved.", "TENANT_NOT_RESOLVED");
        }
        try {
            return jdbc.queryForObject("""
                    SELECT tenant_id FROM tenant_domains WHERE subdomain = ?
                    """, UUID.class, subdomain);
        } catch (EmptyResultDataAccessException ex) {
            throw new ResourceNotFoundException("Workspace not found: " + subdomain);
        }
    }

    @Transactional
    public PlatformLoginResponse platformLogin(String email, String password) {
        PlatformAdminRow admin;
        try {
            admin = jdbc.queryForObject("""
                    SELECT id, email, name, password_hash, is_active
                    FROM platform_admins
                    WHERE lower(email) = lower(?)
                    """, (rs, rowNum) -> new PlatformAdminRow(
                    rs.getObject("id", UUID.class),
                    rs.getString("email"),
                    rs.getString("name"),
                    rs.getString("password_hash"),
                    rs.getBoolean("is_active")), email);
        } catch (EmptyResultDataAccessException ex) {
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }

        if (!admin.active() || !passwordEncoder.matches(password, admin.passwordHash())) {
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }

        jdbc.update("UPDATE platform_admins SET last_login_at = now(), failed_login_attempts = 0 WHERE id = ?", admin.id());
        String token = jwtTokenProvider.generateAccessToken(
                admin.id(), PLATFORM_TENANT_ID, List.of(Role.SUPER_ADMIN), admin.email());
        return new PlatformLoginResponse(
                token,
                accessTokenExpiryMinutes * 60,
                admin.id(),
                admin.email(),
                admin.name(),
                List.of(Role.SUPER_ADMIN.name()));
    }

    public List<TenantRequestSummary> tenantRequests(String status) {
        String normalizedStatus = status == null || status.isBlank() ? null : status.trim().toUpperCase(Locale.ROOT);
        List<TenantRequestSummary> tenants = jdbc.query("""
                SELECT t.id, t.name, t.slug, t.status, t.admin_name, t.admin_email, t.admin_mobile,
                       t.requested_at, t.approved_at, t.rejected_at, t.rejection_reason,
                       d.full_domain
                FROM tenants t
                LEFT JOIN tenant_domains d ON d.tenant_id = t.id AND d.is_primary = true
                WHERE (? IS NULL OR t.status = ?)
                ORDER BY t.requested_at DESC
                """, (rs, rowNum) -> {
            UUID tenantId = rs.getObject("id", UUID.class);
            return new TenantRequestSummary(
                    tenantId,
                    rs.getString("name"),
                    rs.getString("slug"),
                    rs.getString("full_domain"),
                    rs.getString("status"),
                    rs.getString("admin_name"),
                    rs.getString("admin_email"),
                    rs.getString("admin_mobile"),
                    modulesForTenant(tenantId, "tenant_module_requests", true),
                    modulesForTenant(tenantId, "tenant_modules", false),
                    instant(rs.getTimestamp("requested_at")),
                    instant(rs.getTimestamp("approved_at")),
                    instant(rs.getTimestamp("rejected_at")),
                    rs.getString("rejection_reason"));
        }, normalizedStatus, normalizedStatus);
        return tenants;
    }

    @Transactional
    public TenantRequestSummary approveTenant(UUID tenantId, UUID actorId, ApprovalRequest request) {
        TenantRow tenant = tenantRow(tenantId);
        List<String> requested = modulesForTenant(tenantId, "tenant_module_requests", true);
        List<String> approved = normalizeModules(
                request.approvedModules() == null || request.approvedModules().isEmpty()
                        ? requested
                        : request.approvedModules());
        if (approved.isEmpty()) {
            throw new BusinessRuleException("At least one module must be approved.", "NO_MODULES_APPROVED");
        }

        jdbc.update("""
                UPDATE tenants
                SET status = 'ACTIVE', approved_at = now(), approved_by = ?, rejected_at = NULL,
                    rejected_by = NULL, rejection_reason = NULL, updated_at = now()
                WHERE id = ?
                """, actorId, tenantId);
        jdbc.update("UPDATE tenant_domains SET status = 'ACTIVE', updated_at = now() WHERE tenant_id = ?", tenantId);

        for (String module : requested) {
            boolean shouldApprove = approved.contains(module);
            jdbc.update("""
                    UPDATE tenant_module_requests
                    SET status = ?, decided_at = now(), decided_by = ?, rejection_reason = ?
                    WHERE tenant_id = ? AND module_key = ?
                    """, shouldApprove ? "APPROVED" : "REJECTED", actorId,
                    shouldApprove ? null : "Not included in this approval.", tenantId, module);
            if (shouldApprove) {
                jdbc.update("""
                        INSERT INTO tenant_modules (tenant_id, module_key, status, activated_by)
                        VALUES (?, ?, 'ACTIVE', ?)
                        ON CONFLICT (tenant_id, module_key)
                        DO UPDATE SET status = 'ACTIVE', activated_at = now(), activated_by = EXCLUDED.activated_by,
                                      deactivated_at = NULL
                        """, tenantId, module, actorId);
            }
        }

        audit(tenantId, actorId, "APPROVED", tenant.status(), "ACTIVE",
                request.note() == null ? "Approved modules: " + String.join(",", approved) : request.note());
        return tenantRequests("ACTIVE").stream()
                .filter(row -> row.tenantId().equals(tenantId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
    }

    @Transactional
    public TenantRequestSummary rejectTenant(UUID tenantId, UUID actorId, RejectionRequest request) {
        TenantRow tenant = tenantRow(tenantId);
        jdbc.update("""
                UPDATE tenants
                SET status = 'REJECTED', rejected_at = now(), rejected_by = ?,
                    rejection_reason = ?, updated_at = now()
                WHERE id = ?
                """, actorId, request.reason(), tenantId);
        jdbc.update("UPDATE tenant_domains SET status = 'DISABLED', updated_at = now() WHERE tenant_id = ?", tenantId);
        jdbc.update("""
                UPDATE tenant_module_requests
                SET status = 'REJECTED', decided_at = now(), decided_by = ?, rejection_reason = ?
                WHERE tenant_id = ? AND status = 'PENDING'
                """, actorId, request.reason(), tenantId);
        jdbc.update("DELETE FROM tenant_modules WHERE tenant_id = ?", tenantId);
        audit(tenantId, actorId, "REJECTED", tenant.status(), "REJECTED", request.reason());
        return tenantRequests("REJECTED").stream()
                .filter(row -> row.tenantId().equals(tenantId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
    }

    public boolean hasActiveModule(UUID tenantId, String moduleKey) {
        Boolean active = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM tenant_modules
                    WHERE tenant_id = ? AND module_key = ? AND status = 'ACTIVE'
                )
                """, Boolean.class, tenantId, moduleKey);
        return Boolean.TRUE.equals(active);
    }

    private void createDefaultShiftAndLeaveData(UUID tenantId, UUID companyId, UUID employeeId) {
        jdbc.update("""
                INSERT INTO shift_policies (tenant_id, company_id, name, shift_type, start_time, end_time,
                                            grace_period_minutes, working_hours_per_day, is_active)
                VALUES (?, ?, 'Standard 9-6', 'FIXED', '09:00', '18:00', 30, 8.0, true)
                """, tenantId, companyId);

        List<LeaveTypeSeed> leaveTypes = List.of(
                new LeaveTypeSeed(UUID.randomUUID(), "Annual Leave", "ANNUAL", 21),
                new LeaveTypeSeed(UUID.randomUUID(), "Sick Leave", "SICK", 12),
                new LeaveTypeSeed(UUID.randomUUID(), "Casual Leave", "CASUAL", 6)
        );
        int year = LocalDate.now().getYear();
        for (LeaveTypeSeed leaveType : leaveTypes) {
            jdbc.update("""
                    INSERT INTO leave_types (id, tenant_id, company_id, name, code, annual_entitlement,
                                             is_paid_leave, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, true, true)
                    """, leaveType.id(), tenantId, companyId, leaveType.name(), leaveType.code(), leaveType.days());
            jdbc.update("""
                    INSERT INTO leave_balances (tenant_id, employee_id, leave_type_id, year, total_entitlement, used, pending)
                    VALUES (?, ?, ?, ?, ?, 0, 0)
                    """, tenantId, employeeId, leaveType.id(), year, leaveType.days());
        }
    }

    private TenantRow tenantRow(UUID tenantId) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, name, slug, status FROM tenants WHERE id = ?
                    """, (rs, rowNum) -> new TenantRow(
                    rs.getObject("id", UUID.class),
                    rs.getString("name"),
                    rs.getString("slug"),
                    rs.getString("status")), tenantId);
        } catch (EmptyResultDataAccessException ex) {
            throw new ResourceNotFoundException("Tenant", tenantId);
        }
    }

    private List<String> modulesForTenant(UUID tenantId, String table, boolean requests) {
        String sql = requests
                ? "SELECT module_key FROM tenant_module_requests WHERE tenant_id = ? ORDER BY module_key"
                : "SELECT module_key FROM tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY module_key";
        return jdbc.queryForList(sql, String.class, tenantId);
    }

    private void audit(UUID tenantId, UUID actorId, String action, String oldStatus, String newStatus, String note) {
        jdbc.update("""
                INSERT INTO tenant_approval_audit (tenant_id, actor_id, action, old_status, new_status, note)
                VALUES (?, ?, ?, ?, ?, ?)
                """, tenantId, actorId, action, oldStatus, newStatus, note);
    }

    private List<String> normalizeModules(List<String> modules) {
        List<String> source = modules == null || modules.isEmpty() ? DEFAULT_MODULES : modules;
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String module : source) {
            if (module == null || module.isBlank()) continue;
            String key = module.trim().toLowerCase(Locale.ROOT);
            Boolean exists = jdbc.queryForObject(
                    "SELECT EXISTS (SELECT 1 FROM module_catalog WHERE module_key = ? AND is_active = true)",
                    Boolean.class,
                    key);
            if (Boolean.TRUE.equals(exists)) {
                normalized.add(key);
            }
        }
        return new ArrayList<>(normalized);
    }

    private String normalizeSubdomain(String value) {
        if (value == null || value.isBlank()) {
            throw new BusinessRuleException("Workspace address is required.", "SUBDOMAIN_REQUIRED");
        }
        String subdomain = value.trim()
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9-]", "-")
                .replaceAll("-+", "-")
                .replaceAll("^-|-$", "");
        if (!subdomain.matches("^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$")) {
            throw new BusinessRuleException(
                    "Workspace address must be 3-50 characters using letters, numbers, and hyphens.",
                    "SUBDOMAIN_INVALID");
        }
        if (List.of("www", "api", "admin", "app", "mail", "support").contains(subdomain)) {
            throw new BusinessRuleException("This workspace address is reserved.", "SUBDOMAIN_RESERVED");
        }
        return subdomain;
    }

    private String workspaceDomain(String subdomain) {
        return subdomain + "." + baseDomain.replaceFirst("^https?://", "").replaceAll("/$", "");
    }

    private String extractSubdomain(String host) {
        if (host == null || host.isBlank()) return null;
        String cleanHost = host.split(":")[0].toLowerCase(Locale.ROOT);
        if (cleanHost.equals("localhost") || cleanHost.equals(baseDomain)) return null;
        String suffix = "." + baseDomain.replaceFirst("^https?://", "").split(":")[0].toLowerCase(Locale.ROOT);
        if (cleanHost.endsWith(suffix)) {
            String candidate = cleanHost.substring(0, cleanHost.length() - suffix.length());
            if (!candidate.contains(".")) return normalizeSubdomain(candidate);
        }
        String[] parts = cleanHost.split("\\.");
        if (parts.length >= 2 && "localhost".equals(parts[1])) {
            return normalizeSubdomain(parts[0]);
        }
        if (parts.length >= 3 && !"www".equals(parts[0])) {
            return normalizeSubdomain(parts[0]);
        }
        return null;
    }

    private String normalizeMobile(String mobile) {
        if (mobile == null || mobile.isBlank()) return null;
        return mobile.replaceAll("[\\s-]", "");
    }

    private String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private NameParts splitName(String fullName) {
        String[] parts = fullName == null ? new String[0] : fullName.trim().split("\\s+", 2);
        String first = parts.length > 0 && !parts[0].isBlank() ? parts[0] : "Admin";
        String last = parts.length > 1 && !parts[1].isBlank() ? parts[1] : "User";
        return new NameParts(first, last);
    }

    private record NameParts(String firstName, String lastName) {}
    private record TenantRow(UUID id, String name, String slug, String status) {}
    private record PlatformAdminRow(UUID id, String email, String name, String passwordHash, boolean active) {}
    private record LeaveTypeSeed(UUID id, String name, String code, int days) {}
}
