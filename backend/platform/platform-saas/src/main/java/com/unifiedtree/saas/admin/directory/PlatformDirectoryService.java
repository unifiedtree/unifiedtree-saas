package com.unifiedtree.saas.admin.directory;

import com.unifiedtree.saas.admin.support.PageResult;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.CompanyModuleRow;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.Entitlement;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Who the customers are: workspaces, their companies, and the people (accounts)
 * in them — across every workspace, for UnifiedTree's operators.
 *
 * <p>Workspaces, accounts and memberships live in {@code platform.*}, which has no
 * row-level security, so they are read directly. Companies live in
 * {@code org.companies}, which does: those reads go through {@link TenantScopedReader}
 * one workspace at a time, so the database still applies each workspace's isolation.
 */
@Service
public class PlatformDirectoryService {

    private final JdbcTemplate jdbc;
    private final TenantScopedReader scoped;
    private final CompanyEntitlementService entitlements;

    public PlatformDirectoryService(JdbcTemplate jdbc, TenantScopedReader scoped,
                                    CompanyEntitlementService entitlements) {
        this.jdbc = jdbc;
        this.scoped = scoped;
        this.entitlements = entitlements;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record WorkspaceRow(UUID id, String subdomain, String displayName, String status, String planType,
                               String contactEmail, String ownerEmail, int companyCount, int memberCount,
                               List<String> activeModules, String subscriptionStatus, Instant createdAt) {}

    public record WorkspaceDetail(UUID id, String subdomain, String displayName, String status, String planType,
                                  String contactEmail, String contactPhone, String ownerEmail, String ownerName,
                                  String gstin, String pan, String city, String state, String logoUrl,
                                  String primaryColor, List<String> domains, Instant createdAt, Instant approvedAt,
                                  Instant suspendedAt, List<CompanyRow> companies, List<ModuleRow> workspaceModules,
                                  List<MemberRow> members) {}

    public record CompanyRow(UUID id, UUID tenantId, String workspaceSubdomain, String workspaceName, String name,
                             String legalName, String gstin, String pan, boolean active, Integer employeeCount,
                             List<String> products, Instant createdAt) {}

    public record CompanyDetail(CompanyRow company, String registrationNumber, String industry, String country,
                                String currency, String timezone, String logoUrl, List<Entitlement> entitlements,
                                List<CompanyModuleRow> entitlementRows, AccessSummary access) {}

    /** How many people reach the company and how: home employees, extra-company grants. */
    public record AccessSummary(int activeEmployees, int grantedUsers, int grantRows) {}

    public record ModuleRow(String moduleKey, String status, Integer seats, Instant activatedAt, Instant expiresAt) {}

    public record MemberRow(UUID accountId, String email, String displayName, String role, String status,
                            Instant joinedAt) {}

    public record AccountRow(UUID id, String email, String displayName, String status, boolean emailVerified,
                             boolean googleLinked, Instant lastLoginAt, Instant createdAt,
                             List<Membership> workspaces) {}

    public record Membership(UUID tenantId, String subdomain, String workspaceName, String role, String status,
                             boolean defaultWorkspace) {}

    // ── Workspaces ──────────────────────────────────────────────────────────

    public PageResult<WorkspaceRow> workspaces(String search, String status, int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE t.id <> ?");
        args.add(TenantContext.PLATFORM_TENANT_ID);
        if (status != null && !status.isBlank()) {
            where.append(" AND t.status = ?");
            args.add(status.trim().toUpperCase(Locale.ROOT));
        }
        if (search != null && !search.isBlank()) {
            where.append(" AND (t.subdomain ILIKE ? OR t.display_name ILIKE ? OR t.contact_email ILIKE ?"
                    + " OR a.email ILIKE ?)");
            String like = "%" + search.trim() + "%";
            args.addAll(List.of(like, like, like, like));
        }
        String from = " FROM platform.tenants t LEFT JOIN platform.accounts a ON a.id = t.owner_account_id";
        Long total = jdbc.queryForObject("SELECT count(*)" + from + where, Long.class, args.toArray());

        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<WorkspaceRow> rows = jdbc.query("""
                SELECT t.id, t.subdomain, t.display_name, t.status, t.plan_type, t.contact_email, t.created_at,
                       a.email AS owner_email,
                       (SELECT count(*) FROM platform.account_workspaces aw
                         WHERE aw.tenant_id = t.id AND aw.status = 'ACTIVE') AS members,
                       (SELECT string_agg(tm.module_key, ',' ORDER BY tm.module_key) FROM platform.tenant_modules tm
                         WHERE tm.tenant_id = t.id AND tm.status = 'ACTIVE') AS modules,
                       (SELECT s.status FROM platform.subscriptions s WHERE s.tenant_id = t.id
                         ORDER BY (s.status IN ('ACTIVE','TRIALING','PAST_DUE','GRACE','HALTED','PENDING_MANDATE')) DESC,
                                  s.created_at DESC LIMIT 1) AS sub_status
                """ + from + where + " ORDER BY t.created_at DESC LIMIT ? OFFSET ?",
                (rs, i) -> new WorkspaceRow(rs.getObject("id", UUID.class), rs.getString("subdomain"),
                        rs.getString("display_name"), rs.getString("status"), rs.getString("plan_type"),
                        rs.getString("contact_email"), rs.getString("owner_email"), 0, rs.getInt("members"),
                        split(rs.getString("modules")), rs.getString("sub_status"), instant(rs, "created_at")),
                pageArgs.toArray());

        // Company counts sit behind org.companies' row-level security: one bound read per workspace.
        List<WorkspaceRow> withCounts = rows.stream().map(w -> new WorkspaceRow(w.id(), w.subdomain(),
                w.displayName(), w.status(), w.planType(), w.contactEmail(), w.ownerEmail(),
                companyCount(w.id()), w.memberCount(), w.activeModules(), w.subscriptionStatus(),
                w.createdAt())).toList();
        return PageResult.of(withCounts, page, size, total == null ? 0 : total);
    }

    public WorkspaceDetail workspace(UUID tenantId) {
        List<Map<String, Object>> t = jdbc.queryForList("""
                SELECT t.*, a.email AS owner_email, a.display_name AS owner_name,
                       b.logo_url AS brand_logo_url, b.primary_color AS brand_primary_color
                  FROM platform.tenants t
                  LEFT JOIN platform.accounts a ON a.id = t.owner_account_id
                  LEFT JOIN platform.tenant_branding b ON b.tenant_id = t.id
                 WHERE t.id = ?
                """, tenantId);
        if (t.isEmpty() || TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }
        Map<String, Object> w = t.get(0);
        List<String> domains = jdbc.queryForList("""
                SELECT domain FROM platform.tenant_domains WHERE tenant_id = ? ORDER BY is_primary DESC, domain
                """, String.class, tenantId);
        List<ModuleRow> modules = jdbc.query("""
                SELECT module_key, status, seats, activated_at, expires_at FROM platform.tenant_modules
                 WHERE tenant_id = ? ORDER BY module_key
                """, (rs, i) -> new ModuleRow(rs.getString("module_key"), rs.getString("status"),
                        (Integer) rs.getObject("seats"), instant(rs, "activated_at"), instant(rs, "expires_at")),
                tenantId);
        List<MemberRow> members = jdbc.query("""
                SELECT a.id, a.email, a.display_name, aw.role::text AS role, aw.status, aw.joined_at
                  FROM platform.account_workspaces aw JOIN platform.accounts a ON a.id = aw.account_id
                 WHERE aw.tenant_id = ?
                 ORDER BY (aw.role::text = 'OWNER') DESC, lower(a.email)
                """, (rs, i) -> new MemberRow(rs.getObject("id", UUID.class), rs.getString("email"),
                        rs.getString("display_name"), rs.getString("role"), rs.getString("status"),
                        instant(rs, "joined_at")), tenantId);

        return new WorkspaceDetail(tenantId, str(w, "subdomain"), str(w, "display_name"), str(w, "status"),
                str(w, "plan_type"), str(w, "contact_email"), str(w, "contact_phone"), str(w, "owner_email"),
                str(w, "owner_name"), str(w, "gstin"), str(w, "pan"), str(w, "city"), str(w, "state"),
                str(w, "brand_logo_url"), str(w, "brand_primary_color"), domains, ts(w, "created_at"),
                ts(w, "approved_at"), ts(w, "suspended_at"), companiesOf(tenantId, str(w, "subdomain"),
                str(w, "display_name")), modules, members);
    }

    // ── Companies ───────────────────────────────────────────────────────────

    /**
     * Companies across workspaces (or one workspace). Read per workspace through RLS, then
     * filtered and paged here. Fine at today's size (tens of workspaces); a large platform
     * would page workspaces first.
     */
    public PageResult<CompanyRow> companies(UUID tenantId, String search, Boolean active, String product,
                                            int page, int size) {
        List<Map<String, Object>> tenants = tenantId == null
                ? jdbc.queryForList("""
                        SELECT id, subdomain, display_name FROM platform.tenants WHERE id <> ? ORDER BY subdomain
                        """, TenantContext.PLATFORM_TENANT_ID)
                : jdbc.queryForList("SELECT id, subdomain, display_name FROM platform.tenants WHERE id = ?",
                        tenantId);
        List<CompanyRow> all = new ArrayList<>();
        for (Map<String, Object> t : tenants) {
            all.addAll(companiesOf((UUID) t.get("id"), (String) t.get("subdomain"), (String) t.get("display_name")));
        }
        String needle = search == null || search.isBlank() ? null : search.trim().toLowerCase(Locale.ROOT);
        List<CompanyRow> filtered = all.stream()
                .filter(c -> needle == null || contains(c.name(), needle) || contains(c.legalName(), needle)
                        || contains(c.gstin(), needle) || contains(c.workspaceSubdomain(), needle))
                .filter(c -> active == null || c.active() == active)
                .filter(c -> product == null || product.isBlank() || c.products().contains(product))
                .sorted(Comparator.comparing(CompanyRow::workspaceSubdomain, Comparator.nullsLast(String::compareTo))
                        .thenComparing(c -> c.name() == null ? "" : c.name().toLowerCase(Locale.ROOT)))
                .toList();
        return PageResult.slice(filtered, page, size);
    }

    public CompanyDetail company(UUID tenantId, UUID companyId) {
        Map<String, Object> tenant = requireWorkspace(tenantId);
        Map<String, Object> c = scoped.read(tenantId, () -> {
            List<Map<String, Object>> r = jdbc.queryForList("SELECT * FROM org.companies WHERE id = ?", companyId);
            return r.isEmpty() ? null : r.get(0);
        });
        if (c == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Company not found in this workspace");

        List<Entitlement> resolved = entitlements.resolveAll(tenantId, companyId);
        List<String> on = resolved.stream().filter(Entitlement::entitled).map(Entitlement::moduleKey).sorted().toList();
        CompanyRow row = toCompanyRow(c, tenantId, (String) tenant.get("subdomain"),
                (String) tenant.get("display_name"), on);

        AccessSummary access = scoped.read(tenantId, () -> {
            Integer employees = jdbc.queryForObject("""
                    SELECT count(*) FROM hrms.employees WHERE company_id = ? AND is_active = TRUE
                    """, Integer.class, companyId);
            Map<String, Object> grants = jdbc.queryForMap("""
                    SELECT count(DISTINCT user_id) AS users, count(*) AS rows
                      FROM rbac.user_company_access WHERE company_id = ?
                    """, companyId);
            return new AccessSummary(employees == null ? 0 : employees,
                    ((Number) grants.get("users")).intValue(), ((Number) grants.get("rows")).intValue());
        });

        return new CompanyDetail(row, str(c, "registration_number"), str(c, "industry"), str(c, "country"),
                str(c, "currency"), str(c, "timezone"), str(c, "logo_url"), resolved,
                entitlements.rows(companyId), access);
    }

    /** Throws 404 unless the company exists in that workspace (read through RLS). */
    public void requireCompany(UUID tenantId, UUID companyId) {
        requireWorkspace(tenantId);
        Boolean exists = scoped.read(tenantId, () -> jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM org.companies WHERE id = ?)", Boolean.class, companyId));
        if (!Boolean.TRUE.equals(exists)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Company not found in this workspace");
        }
    }

    /** Company names for a set of ids in one workspace (for lists that hold ids). */
    public Map<UUID, String> companyNames(UUID tenantId, List<UUID> companyIds) {
        if (companyIds.isEmpty()) return Map.of();
        return scoped.read(tenantId, () -> {
            Map<UUID, String> out = new LinkedHashMap<>();
            String in = String.join(",", companyIds.stream().map(x -> "?").toList());
            jdbc.query("SELECT id, name FROM org.companies WHERE id IN (" + in + ")",
                    (ResultSet rs) -> { out.put(rs.getObject("id", UUID.class), rs.getString("name")); },
                    companyIds.toArray());
            return out;
        });
    }

    public Map<String, Object> requireWorkspace(UUID tenantId) {
        if (tenantId == null || TenantContext.PLATFORM_TENANT_ID.equals(tenantId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }
        List<Map<String, Object>> t = jdbc.queryForList(
                "SELECT id, subdomain, display_name, status FROM platform.tenants WHERE id = ?", tenantId);
        if (t.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        return t.get(0);
    }

    private List<CompanyRow> companiesOf(UUID tenantId, String subdomain, String workspaceName) {
        List<Map<String, Object>> rows = scoped.read(tenantId, () -> jdbc.queryForList("""
                SELECT id, name, legal_name, gstin, pan_number, is_active, employee_count_cached, created_at
                  FROM org.companies ORDER BY lower(name), id
                """));
        Map<UUID, UUID> companyToTenant = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) companyToTenant.put((UUID) r.get("id"), tenantId);
        Map<UUID, List<String>> products = entitlements.effectiveModules(companyToTenant);
        List<CompanyRow> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            out.add(toCompanyRow(r, tenantId, subdomain, workspaceName,
                    products.getOrDefault((UUID) r.get("id"), List.of())));
        }
        return out;
    }

    private int companyCount(UUID tenantId) {
        Integer n = scoped.read(tenantId,
                () -> jdbc.queryForObject("SELECT count(*) FROM org.companies", Integer.class));
        return n == null ? 0 : n;
    }

    private static CompanyRow toCompanyRow(Map<String, Object> c, UUID tenantId, String subdomain,
                                           String workspaceName, List<String> products) {
        Object count = c.get("employee_count_cached");
        return new CompanyRow((UUID) c.get("id"), tenantId, subdomain, workspaceName, str(c, "name"),
                str(c, "legal_name"), str(c, "gstin"), str(c, "pan_number"),
                !Boolean.FALSE.equals(c.get("is_active")), count instanceof Number n ? n.intValue() : null,
                products, ts(c, "created_at"));
    }

    // ── Accounts ────────────────────────────────────────────────────────────

    public PageResult<AccountRow> accounts(String search, String status, int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (search != null && !search.isBlank()) {
            where.append(" AND (a.email ILIKE ? OR a.display_name ILIKE ? OR a.phone ILIKE ?)");
            String like = "%" + search.trim() + "%";
            args.addAll(List.of(like, like, like));
        }
        if (status != null && !status.isBlank()) {
            where.append(" AND a.status::text = ?");
            args.add(status.trim().toUpperCase(Locale.ROOT));
        }
        Long total = jdbc.queryForObject("SELECT count(*) FROM platform.accounts a" + where, Long.class,
                args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<AccountRow> rows = jdbc.query("""
                SELECT a.id, a.email, a.display_name, a.status::text AS status, a.email_verified,
                       a.google_sub IS NOT NULL AS google, a.last_login_at, a.created_at
                  FROM platform.accounts a
                """ + where + " ORDER BY a.created_at DESC LIMIT ? OFFSET ?",
                (rs, i) -> new AccountRow(rs.getObject("id", UUID.class), rs.getString("email"),
                        rs.getString("display_name"), rs.getString("status"), rs.getBoolean("email_verified"),
                        rs.getBoolean("google"), instant(rs, "last_login_at"), instant(rs, "created_at"), List.of()),
                pageArgs.toArray());
        Map<UUID, List<Membership>> memberships = memberships(rows.stream().map(AccountRow::id).toList());
        List<AccountRow> full = rows.stream().map(a -> new AccountRow(a.id(), a.email(), a.displayName(),
                a.status(), a.emailVerified(), a.googleLinked(), a.lastLoginAt(), a.createdAt(),
                memberships.getOrDefault(a.id(), List.of()))).toList();
        return PageResult.of(full, page, size, total == null ? 0 : total);
    }

    public AccountRow account(UUID accountId) {
        List<AccountRow> rows = jdbc.query("""
                SELECT a.id, a.email, a.display_name, a.status::text AS status, a.email_verified,
                       a.google_sub IS NOT NULL AS google, a.last_login_at, a.created_at
                  FROM platform.accounts a WHERE a.id = ?
                """, (rs, i) -> new AccountRow(rs.getObject("id", UUID.class), rs.getString("email"),
                        rs.getString("display_name"), rs.getString("status"), rs.getBoolean("email_verified"),
                        rs.getBoolean("google"), instant(rs, "last_login_at"), instant(rs, "created_at"), List.of()),
                accountId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found");
        AccountRow a = rows.get(0);
        return new AccountRow(a.id(), a.email(), a.displayName(), a.status(), a.emailVerified(), a.googleLinked(),
                a.lastLoginAt(), a.createdAt(), memberships(List.of(accountId)).getOrDefault(accountId, List.of()));
    }

    private Map<UUID, List<Membership>> memberships(List<UUID> accountIds) {
        Map<UUID, List<Membership>> out = new LinkedHashMap<>();
        if (accountIds.isEmpty()) return out;
        String in = String.join(",", accountIds.stream().map(x -> "?").toList());
        jdbc.query("""
                SELECT aw.account_id, t.id AS tenant_id, t.subdomain, t.display_name, aw.role::text AS role,
                       aw.status, aw.default_workspace
                  FROM platform.account_workspaces aw JOIN platform.tenants t ON t.id = aw.tenant_id
                 WHERE aw.account_id IN (%s)
                 ORDER BY t.subdomain
                """.formatted(in), (ResultSet rs) -> {
            out.computeIfAbsent(rs.getObject("account_id", UUID.class), k -> new ArrayList<>())
                    .add(new Membership(rs.getObject("tenant_id", UUID.class), rs.getString("subdomain"),
                            rs.getString("display_name"), rs.getString("role"), rs.getString("status"),
                            rs.getBoolean("default_workspace")));
        }, accountIds.toArray());
        return out;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static boolean contains(String haystack, String needle) {
        return haystack != null && haystack.toLowerCase(Locale.ROOT).contains(needle);
    }

    private static List<String> split(String csv) {
        return csv == null || csv.isBlank() ? List.of() : Arrays.asList(csv.split(","));
    }

    static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : v.toString();
    }

    static Instant ts(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v instanceof Timestamp t) return t.toInstant();
        if (v instanceof java.time.OffsetDateTime o) return o.toInstant();
        return null;
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
