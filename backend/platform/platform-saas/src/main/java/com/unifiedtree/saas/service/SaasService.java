package com.unifiedtree.saas.service;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.saas.dto.AccountDtos.CreateWorkspaceRequest;
import com.unifiedtree.saas.dto.SaasDtos.ApprovalRequest;
import com.unifiedtree.saas.dto.SaasDtos.PlatformLoginResponse;
import com.unifiedtree.saas.dto.SaasDtos.RejectionRequest;
import com.unifiedtree.saas.dto.SaasDtos.SignupRequest;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.dto.SaasDtos.SubdomainCheckResponse;
import com.unifiedtree.saas.dto.SaasDtos.TenantRequestSummary;
import com.unifiedtree.saas.dto.SaasDtos.WorkspaceStatusResponse;
import com.unifiedtree.saas.event.WorkspaceCreatedEvent;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Customer-facing SaaS portal orchestration. Talks only to canonical
 * schemas (platform.*, auth.*, rbac.*).
 *
 * <p>Write paths that touch RLS-protected tables (auth.user_credentials,
 * rbac.user_roles) set TenantContext before delegating to {@link SaasWriter},
 * whose @Transactional methods cause {@code TenantAwareDataSource} to issue
 * {@code SET LOCAL app.tenant_id} on connection lease.
 */
@Service
public class SaasService {

    /** Special tenant id used to host UnifiedTree platform admins. */
    public static final UUID PLATFORM_TENANT_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000000");

    private static final UUID SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID PLATFORM_SUPER_ADMIN_ROLE_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000006");

    /**
     * Subdomains a tenant may NOT register, because they collide with
     * platform infrastructure or routing. The wildcard *.unifiedtree.com
     * serves the tenant workspace app, but these names are claimed by
     * other hosts (the marketing site, the admin console, the API, mail,
     * static assets, etc.). Allowing a tenant to take one would hijack
     * real traffic. Kept lowercase; matching is exact after normalization.
     */
    private static final java.util.Set<String> RESERVED_SUBDOMAINS = java.util.Set.of(
            "www", "api", "admin", "app", "apps", "platform", "dashboard",
            "mail", "email", "smtp", "imap", "ftp", "ns", "ns1", "ns2", "dns",
            "static", "assets", "cdn", "img", "images", "media", "files",
            "status", "health", "metrics", "monitor", "grafana", "prometheus",
            "blog", "docs", "help", "support", "billing", "pay", "payment",
            "payments", "checkout", "auth", "login", "signup", "register",
            "account", "accounts", "console", "control", "internal", "test",
            "staging", "stage", "dev", "demo", "sandbox", "preview", "vercel",
            "railway", "root", "unifiedtree", "webhook", "webhooks",
            "ws", "socket", "vpn", "git", "ci", "cd", "ops", "noc", "sec");

    private final JdbcTemplate jdbc;
    private final SaasWriter writer;
    private final JwtService jwt;
    private final PasswordService passwords;
    private final String baseDomain;
    private final ApplicationEventPublisher events;

    public SaasService(JdbcTemplate jdbc,
                       SaasWriter writer,
                       JwtService jwt,
                       PasswordService passwords,
                       @Value("${unifiedtree.base-domain:unifiedtree.com}") String baseDomain,
                       ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.writer = writer;
        this.jwt = jwt;
        this.passwords = passwords;
        this.baseDomain = baseDomain;
        this.events = events;
    }

    // -- Public: subdomain availability -----------------------------------------------------------

    public SubdomainCheckResponse checkSubdomain(String requested) {
        String subdomain = normalizeSubdomain(requested);
        if (subdomain.length() < 3) {
            return new SubdomainCheckResponse(subdomain, false,
                    "Workspace address must be at least 3 characters.");
        }
        // Reject infrastructure-reserved names BEFORE the DB check so the
        // guard holds even on a fresh database. Covers both the live
        // availability probe and createWorkspace (which calls this method).
        if (RESERVED_SUBDOMAINS.contains(subdomain)) {
            return new SubdomainCheckResponse(subdomain, false,
                    "This workspace address is reserved. Please choose another.");
        }
        boolean exists = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM platform.tenants WHERE subdomain = ?)",
                Boolean.class, subdomain));
        return new SubdomainCheckResponse(subdomain, !exists,
                exists ? "This workspace address is already reserved." : "Available");
    }

    // -- Public: signup ---------------------------------------------------------------------------

    public SignupResponse createSignupRequest(SignupRequest req) {
        UUID accountId = resolveOrCreateAccountId(req);
        String passwordHash = passwords.hash(req.password());
        return createWorkspace(accountId, passwordHash, req);
    }

    public SignupResponse createWorkspaceForAccount(UUID accountId, CreateWorkspaceRequest req) {
        AccountForWorkspace account = loadAccountForWorkspace(accountId);
        SignupRequest signup = new SignupRequest(
                req.companyName(),
                req.subdomain(),
                defaultText(req.adminName(), account.displayName()),
                account.email(),
                defaultText(req.adminMobile(), account.phone()),
                "account-session-password",
                req.industry(),
                req.country(),
                req.timezone(),
                req.currency(),
                req.companySize(),
                req.primaryInterest(),
                req.requestedModules());
        return createWorkspace(account.accountId(), account.passwordHash(), signup);
    }

    private SignupResponse createWorkspace(UUID accountId, String passwordHash, SignupRequest req) {
        String subdomain = normalizeSubdomain(req.subdomain());
        if (subdomain.length() < 3) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Workspace address too short");
        }
        if (RESERVED_SUBDOMAINS.contains(subdomain)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Workspace address '" + subdomain + "' is reserved. Please choose another.");
        }
        if (!checkSubdomain(subdomain).available()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Workspace address already reserved");
        }
        List<String> requestedModules = normalizeModules(req.requestedModules());
        if (requestedModules.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one module");
        }
        ensureModulesExist(requestedModules);

        UUID tenantId = UUID.randomUUID();
        UUID userId   = UUID.randomUUID();

        // Set tenant context so the @Transactional writer's SET LOCAL kicks
        // in on the connection lease, allowing inserts into RLS-protected
        // auth.user_credentials and rbac.user_roles where tenant_id matches.
        TenantContext.setTenantId(tenantId);
        try {
            writer.signup(tenantId, accountId, userId, subdomain, baseDomain, passwordHash, requestedModules, req);
        } finally {
            TenantContext.clear();
        }

        // Fire-and-forget welcome email — listener lives in hrms-api where MailService is.
        // Wrapped: a mail-side failure must NEVER fail the signup transaction.
        try {
            events.publishEvent(new WorkspaceCreatedEvent(
                    tenantId, accountId, subdomain,
                    subdomain + "." + baseDomain, workspaceUrl(subdomain),
                    req.adminName(), req.adminEmail(), req.companyName(),
                    requestedModules));
        } catch (Exception ignored) { /* no-op; signup must not depend on email */ }

        return new SignupResponse(
                accountId,
                tenantId,
                subdomain,
                workspaceUrl(subdomain),
                "ACTIVE",
                requestedModules,
                "OWNER",
                "Workspace created and instantly activated.");
    }

    private AccountForWorkspace loadAccountForWorkspace(UUID accountId) {
        try {
            return jdbc.queryForObject("""
                    SELECT id, email, display_name, phone, password_hash, status
                      FROM platform.accounts
                     WHERE id = ?
                    """, (rs, rowNum) -> {
                String status = rs.getString("status");
                if (!"ACTIVE".equals(status)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
                }
                return new AccountForWorkspace(
                        UUID.fromString(rs.getString("id")),
                        rs.getString("email"),
                        rs.getString("display_name"),
                        rs.getString("phone"),
                        rs.getString("password_hash"));
            }, accountId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account token is no longer valid");
        }
    }

    private UUID resolveOrCreateAccountId(SignupRequest req) {
        String email = req.adminEmail().trim().toLowerCase(Locale.ROOT);
        return jdbc.query("""
                SELECT id, password_hash, status
                  FROM platform.accounts
                 WHERE lower(email) = lower(?)
                """, rs -> {
            if (!rs.next()) {
                return UUID.randomUUID();
            }
            String status = rs.getString("status");
            if (!"ACTIVE".equals(status)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
            }
            String existingHash = rs.getString("password_hash");
            if (!passwords.matches(req.password(), existingHash)) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "An account already exists for this email. Sign in first to create another workspace.");
            }
            return UUID.fromString(rs.getString("id"));
        }, email);
    }

    // -- Public: workspace status ----------------------------------------------------------------

    public WorkspaceStatusResponse workspaceStatus(String subdomainParam,
                                                   String tenantIdHeader,
                                                   String subdomainHeader,
                                                   String hostHeader) {
        String subdomain = resolveSubdomain(subdomainParam, tenantIdHeader, subdomainHeader, hostHeader);
        if (subdomain == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not identified");
        }
        return buildWorkspaceStatus(subdomain);
    }

    /**
     * Build the status payload for a resolved subdomain. Shared by the public
     * {@code workspace-status} read and the {@code module-toggle} write so both
     * return the same authoritative shape.
     */
    private WorkspaceStatusResponse buildWorkspaceStatus(String subdomain) {
        var tenant = jdbc.query(
                "SELECT id, subdomain, display_name, status FROM platform.tenants WHERE subdomain = ?",
                rs -> rs.next() ? new Object[]{
                        UUID.fromString(rs.getString("id")),
                        rs.getString("subdomain"),
                        rs.getString("display_name"),
                        rs.getString("status")
                } : null,
                subdomain);
        if (tenant == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }
        UUID tenantId = (UUID) tenant[0];
        List<String> activeModules = jdbc.queryForList(
                "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY module_key",
                String.class, tenantId);
        List<String> requestedModules = jdbc.queryForList(
                "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status IN ('REQUESTED','APPROVED') ORDER BY module_key",
                String.class, tenantId);
        return new WorkspaceStatusResponse(
                tenantId,
                (String) tenant[2],
                (String) tenant[1],
                (String) tenant[3],
                requestedModules,
                activeModules);
    }

    // -- Public: self-service module toggle ------------------------------------------------------

    /**
     * Modules a workspace admin may switch on/off from the public Edit-Workspace
     * page, keyed exactly as the website's {@code data/modules.ts}. The value is
     * the catalog display name used to self-seed {@code platform.module_catalog}
     * — the website ships keys (inventory, pos, …) the original catalog seed
     * never listed, and {@code tenant_modules.module_key} has an FK onto it.
     */
    private static final java.util.Map<String, String> TOGGLEABLE_MODULES = java.util.Map.ofEntries(
            java.util.Map.entry("hrms",          "HR & Employees"),
            java.util.Map.entry("attendance",    "Attendance"),
            java.util.Map.entry("payroll",       "Payroll"),
            java.util.Map.entry("accounting",    "Accounting"),
            java.util.Map.entry("inventory",     "Inventory"),
            java.util.Map.entry("crm",           "CRM"),
            java.util.Map.entry("purchase",      "Purchase"),
            java.util.Map.entry("sales",         "Sales"),
            java.util.Map.entry("projects",      "Projects"),
            java.util.Map.entry("manufacturing", "Manufacturing"),
            java.util.Map.entry("pos",           "Point of Sale"),
            java.util.Map.entry("reports",       "Reports & BI"));

    /**
     * Activate or deactivate a single module for a workspace, addressed by
     * subdomain. Unauthenticated to match the rest of the Edit-Workspace page
     * (the admin lands here from an emailed deep link, not a logged-in session).
     *
     * <p>Writes target the non-RLS {@code platform.*} tables, so no
     * TenantContext is needed. Activation upserts the row to {@code ACTIVE};
     * deactivation hard-deletes it so re-adding is a clean insert and the admin
     * can toggle as many times as they like. Returns the refreshed status.
     */
    public WorkspaceStatusResponse setModuleActive(String subdomainRaw, String moduleRaw, boolean active) {
        String subdomain = subdomainRaw == null ? "" : subdomainRaw.trim().toLowerCase(Locale.ROOT);
        if (subdomain.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "subdomain is required");
        }
        String moduleKey = normalizeModuleKey(moduleRaw == null ? "" : moduleRaw);
        String displayName = TOGGLEABLE_MODULES.get(moduleKey);
        if (displayName == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown module: " + moduleKey);
        }
        UUID tenantId = jdbc.query(
                "SELECT id FROM platform.tenants WHERE subdomain = ?",
                rs -> rs.next() ? UUID.fromString(rs.getString(1)) : null,
                subdomain);
        if (tenantId == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }

        if (active) {
            // Ensure the catalog row exists (FK target) before activating.
            jdbc.update("""
                    INSERT INTO platform.module_catalog (key, display_name, category, is_available)
                    VALUES (?, ?, 'ERP', TRUE)
                    ON CONFLICT (key) DO NOTHING
                    """, moduleKey, displayName);
            jdbc.update("""
                    INSERT INTO platform.tenant_modules
                        (id, tenant_id, module_key, status, requested_at, approved_at, activated_at)
                    VALUES (?, ?, ?, 'ACTIVE', now(), now(), now())
                    ON CONFLICT (tenant_id, module_key)
                    DO UPDATE SET status = 'ACTIVE', activated_at = now()
                    """, UUID.randomUUID(), tenantId, moduleKey);
        } else {
            jdbc.update("DELETE FROM platform.tenant_modules WHERE tenant_id = ? AND module_key = ?",
                    tenantId, moduleKey);
        }
        return buildWorkspaceStatus(subdomain);
    }

    // -- Public: platform admin login ------------------------------------------------------------

    public PlatformLoginResponse platformLogin(String email, String password) {
        String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);

        // Switch tenant context to the platform tenant so RLS lets us see the
        // platform admin's credentials + role grants. After we leave this
        // service call, downstream code can replace the context based on the
        // freshly-issued JWT.
        TenantContext.setTenantId(PLATFORM_TENANT_ID);
        try {
            return doPlatformLogin(normalizedEmail, password);
        } finally {
            TenantContext.clear();
        }
    }

    private PlatformLoginResponse doPlatformLogin(String email, String password) {
        try {
            Object[] row = jdbc.queryForObject(
                    "SELECT id, password_hash, is_active FROM auth.user_credentials WHERE tenant_id = ? AND email = ?",
                    (rs, n) -> new Object[]{
                            UUID.fromString(rs.getString("id")),
                            rs.getString("password_hash"),
                            rs.getBoolean("is_active")
                    },
                    PLATFORM_TENANT_ID, email);
            UUID userId = (UUID) row[0];
            String hash = (String) row[1];
            boolean active = (boolean) row[2];
            if (!active) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Account is disabled");
            }
            if (!passwords.matches(password, hash)) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
            }
            List<String> roleCodes = jdbc.queryForList(
                    "SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id " +
                    "WHERE ur.tenant_id = ? AND ur.user_id = ?",
                    String.class, PLATFORM_TENANT_ID, userId);
            List<String> permissions = jdbc.queryForList(
                    "SELECT DISTINCT rp.permission_code FROM rbac.user_roles ur " +
                    "JOIN rbac.role_permissions rp ON rp.role_id = ur.role_id " +
                    "WHERE ur.tenant_id = ? AND ur.user_id = ?",
                    String.class, PLATFORM_TENANT_ID, userId);
            String displayName = jdbc.query(
                    "SELECT display_name FROM platform.tenants WHERE id = ?",
                    rs -> rs.next() ? rs.getString(1) : "Platform Admin",
                    PLATFORM_TENANT_ID);

            JwtService.IssuedToken issued = jwt.issueAccessToken(
                    userId, PLATFORM_TENANT_ID, email, roleCodes, permissions);
            return new PlatformLoginResponse(
                    issued.token(),
                    issued.ttl().toSeconds(),
                    userId,
                    email,
                    displayName,
                    roleCodes,
                    permissions);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
    }

    // -- Platform admin: list tenant requests ----------------------------------------------------

    public List<TenantRequestSummary> listTenantRequests(String statusFilter) {
        String sql;
        Object[] args;
        if (statusFilter == null || statusFilter.isBlank() || "ALL".equalsIgnoreCase(statusFilter)) {
            sql = "SELECT id, display_name, subdomain, status, admin_name, contact_email, contact_phone, " +
                  "       requested_modules, created_at, approved_at, rejected_at, rejection_reason " +
                  "FROM platform.tenants " +
                  "WHERE id <> ? " +     // exclude the platform tenant itself
                  "ORDER BY created_at DESC";
            args = new Object[]{ PLATFORM_TENANT_ID };
        } else {
            sql = "SELECT id, display_name, subdomain, status, admin_name, contact_email, contact_phone, " +
                  "       requested_modules, created_at, approved_at, rejected_at, rejection_reason " +
                  "FROM platform.tenants " +
                  "WHERE id <> ? AND status = ? " +
                  "ORDER BY created_at DESC";
            args = new Object[]{ PLATFORM_TENANT_ID, statusFilter };
        }
        List<TenantRequestSummary> rows = new ArrayList<>();
        jdbc.query(sql, rs -> {
            UUID tenantId = UUID.fromString(rs.getString("id"));
            String displayName = rs.getString("display_name");
            String subdomain = rs.getString("subdomain");
            String status = rs.getString("status");
            String adminName = rs.getString("admin_name");
            String adminEmail = rs.getString("contact_email");
            String adminPhone = rs.getString("contact_phone");
            java.sql.Array requestedSqlArray = rs.getArray("requested_modules");
            String[] requested = requestedSqlArray != null
                    ? (String[]) requestedSqlArray.getArray() : new String[0];
            Instant requestedAt = rs.getTimestamp("created_at").toInstant();
            Instant approvedAt = rs.getTimestamp("approved_at") != null
                    ? rs.getTimestamp("approved_at").toInstant() : null;
            Instant rejectedAt = rs.getTimestamp("rejected_at") != null
                    ? rs.getTimestamp("rejected_at").toInstant() : null;
            String rejectionReason = rs.getString("rejection_reason");

            List<String> activeModules = jdbc.queryForList(
                    "SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY module_key",
                    String.class, tenantId);
            String fullDomain = subdomain + "." + baseDomain;
            rows.add(new TenantRequestSummary(
                    tenantId, displayName, subdomain, fullDomain, status,
                    adminName, adminEmail, adminPhone,
                    List.of(requested), activeModules,
                    requestedAt, approvedAt, rejectedAt, rejectionReason));
        }, args);
        return rows;
    }

    // -- Platform admin: approve / reject --------------------------------------------------------

    public TenantRequestSummary approveTenant(UUID tenantId, UUID approverUserId, ApprovalRequest req) {
        List<String> approvedModules = normalizeModules(req.approvedModules());
        if (approvedModules.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "approvedModules must not be empty");
        }
        writer.approve(tenantId, approverUserId, approvedModules);
        return loadOne(tenantId);
    }

    public TenantRequestSummary rejectTenant(UUID tenantId, UUID rejectorUserId, RejectionRequest req) {
        if (req.reason() == null || req.reason().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Rejection reason is required");
        }
        writer.reject(tenantId, rejectorUserId, req.reason().trim());
        return loadOne(tenantId);
    }

    // -- helpers --------------------------------------------------------------------------------

    private TenantRequestSummary loadOne(UUID tenantId) {
        List<TenantRequestSummary> all = listTenantRequests(null);
        return all.stream().filter(t -> t.tenantId().equals(tenantId)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tenant not found"));
    }

    private String workspaceUrl(String subdomain) {
        return "https://" + subdomain + "." + baseDomain;
    }

    static String normalizeSubdomain(String requested) {
        if (requested == null) return "";
        String s = requested.toLowerCase(Locale.ROOT).trim()
                .replaceAll("[^a-z0-9-]", "-")
                .replaceAll("-+", "-")
                .replaceAll("^-+|-+$", "");
        return s.length() > 63 ? s.substring(0, 63) : s;
    }

    static List<String> normalizeModules(List<String> requested) {
        if (requested == null) return List.of();
        return requested.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(SaasService::normalizeModuleKey)
                .distinct()
                .toList();
    }

    private static String normalizeModuleKey(String requested) {
        String key = requested.trim().toLowerCase(Locale.ROOT);
        return switch (key) {
            case "hrms.core", "core" -> "hrms";
            case "hrms.attendance" -> "attendance";
            case "hrms.leave" -> "leave";
            default -> key;
        };
    }

    private void ensureModulesExist(List<String> modules) {
        String placeholders = String.join(",", modules.stream().map(m -> "?").toList());
        List<String> existing = jdbc.queryForList(
                "SELECT key FROM platform.module_catalog WHERE key IN (" + placeholders + ")",
                String.class,
                modules.toArray());
        HashSet<String> missing = new HashSet<>(modules);
        missing.removeAll(existing);
        if (!missing.isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Unknown module(s): " + String.join(", ", missing));
        }
    }

    private static String defaultText(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value.trim();
    }

    private String resolveSubdomain(String subdomainParam, String tenantIdHeader,
                                    String subdomainHeader, String hostHeader) {
        // Explicit ?subdomain= wins: the website's Edit-Workspace page identifies
        // the workspace this way (no tenant headers on cross-origin calls).
        if (subdomainParam != null && !subdomainParam.isBlank()) {
            return subdomainParam.trim().toLowerCase(Locale.ROOT);
        }
        if (subdomainHeader != null && !subdomainHeader.isBlank()) {
            return subdomainHeader.trim().toLowerCase(Locale.ROOT);
        }
        if (tenantIdHeader != null && !tenantIdHeader.isBlank()) {
            // Lookup tenant by id
            return jdbc.query(
                    "SELECT subdomain FROM platform.tenants WHERE id = ?",
                    rs -> rs.next() ? rs.getString(1) : null,
                    UUID.fromString(tenantIdHeader.trim()));
        }
        if (hostHeader != null && !hostHeader.isBlank()) {
            String host = hostHeader.trim().toLowerCase(Locale.ROOT);
            int dot = host.indexOf('.');
            if (dot > 0) {
                return host.substring(0, dot);
            }
        }
        return null;
    }

    private record AccountForWorkspace(
            UUID accountId,
            String email,
            String displayName,
            String phone,
            String passwordHash
    ) {}
}
