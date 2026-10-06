package com.unifiedtree.saas.entitlement;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Is a product switched on for a company? The single answer to that question,
 * for the platform admin console and for Marketing Automation.
 *
 * <p>Precedence, first match wins:
 * <ol>
 *   <li>A company MANUAL row (an operator's audited override). ACTIVE turns the
 *       product on; SUSPENDED turns it OFF even over a paid subscription — that
 *       is what "suspend this company's Marketing" has to mean.</li>
 *   <li>A company SUBSCRIPTION or TRIAL row that is ACTIVE and inside its period.</li>
 *   <li>The workspace's row in {@code platform.tenant_modules} (ACTIVE, not expired).
 *       This is how every product was granted before per-company billing, and how
 *       HRMS is still granted, so existing workspaces keep exactly what they have.</li>
 * </ol>
 *
 * <p>Platform tables only ({@code platform.*} has no row-level security), so this
 * needs no workspace binding. It does NOT check that the company exists in the
 * workspace: callers that take a company id from outside do that first, and the
 * composite foreign keys make a mismatched row impossible to write.
 *
 * <p>Note for HRMS: the HRMS request guards ({@code TenantModuleGuard}) still
 * read {@code tenant_modules} per workspace. A company-level SUSPENDED row shows
 * here and in the admin console but does not yet block HRMS screens.
 */
@Service
public class CompanyEntitlementService {

    private static final Logger log = LoggerFactory.getLogger(CompanyEntitlementService.class);

    public static final String SOURCE_MANUAL = "MANUAL";
    public static final String SOURCE_SUBSCRIPTION = "SUBSCRIPTION";
    public static final String SOURCE_TRIAL = "TRIAL";
    /** Effective source when the product comes from the workspace, not the company. */
    public static final String SOURCE_WORKSPACE = "WORKSPACE";
    public static final String SOURCE_NONE = "NONE";

    private static final Set<String> MANUAL_STATUSES = Set.of("ACTIVE", "SUSPENDED");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public CompanyEntitlementService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** A company's product, as stored. */
    public record CompanyModuleRow(UUID id, UUID tenantId, UUID companyId, String moduleKey, String status,
                                   String source, UUID subscriptionId, Integer seats, Instant startsAt,
                                   Instant endsAt, String reason, String grantedBy, Map<String, Object> limits,
                                   Instant updatedAt) {

        boolean liveAt(Instant now) {
            return "ACTIVE".equals(status)
                    && (startsAt == null || !startsAt.isAfter(now))
                    && (endsAt == null || endsAt.isAfter(now));
        }
    }

    /** The answer for one (company, product). */
    public record Entitlement(String moduleKey, boolean entitled, String source, String status,
                              Instant startsAt, Instant endsAt, UUID subscriptionId, Integer seats,
                              String planKey, Map<String, Object> limits, String reason, String grantedBy,
                              long version) {}

    // ── Reads ───────────────────────────────────────────────────────────────

    /** Resolve one product for one company. */
    @Transactional(readOnly = true)
    public Entitlement resolve(UUID tenantId, UUID companyId, String moduleKey) {
        List<CompanyModuleRow> rows = companyRows(List.of(companyId), moduleKey);
        Map<String, Object> workspaceRow = workspaceRow(tenantId, moduleKey);
        return decide(moduleKey, rows, workspaceRow, Instant.now());
    }

    /** Every product's answer for one company (products it has a row or a workspace grant for). */
    @Transactional(readOnly = true)
    public List<Entitlement> resolveAll(UUID tenantId, UUID companyId) {
        List<CompanyModuleRow> rows = companyRows(List.of(companyId), null);
        List<String> keys = new ArrayList<>(rows.stream().map(CompanyModuleRow::moduleKey).distinct().toList());
        for (String k : jdbc.queryForList("""
                SELECT module_key FROM platform.tenant_modules WHERE tenant_id = ? ORDER BY module_key
                """, String.class, tenantId)) {
            if (!keys.contains(k)) keys.add(k);
        }
        Instant now = Instant.now();
        List<Entitlement> out = new ArrayList<>();
        for (String key : keys) {
            List<CompanyModuleRow> forKey = rows.stream().filter(r -> r.moduleKey().equals(key)).toList();
            out.add(decide(key, forKey, workspaceRow(tenantId, key), now));
        }
        return out;
    }

    /**
     * Effective product keys per company, for lists: one query for the company rows and
     * one for the workspace rows, however many companies are on the page.
     */
    @Transactional(readOnly = true)
    public Map<UUID, List<String>> effectiveModules(Map<UUID, UUID> companyToTenant) {
        Map<UUID, List<String>> out = new LinkedHashMap<>();
        if (companyToTenant.isEmpty()) return out;
        List<CompanyModuleRow> rows = companyRows(companyToTenant.keySet(), null);
        Map<UUID, List<String>> workspaceKeys = new LinkedHashMap<>();
        for (UUID tenantId : Set.copyOf(companyToTenant.values())) {
            workspaceKeys.put(tenantId, jdbc.queryForList("""
                    SELECT module_key FROM platform.tenant_modules
                     WHERE tenant_id = ? AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now())
                    """, String.class, tenantId));
        }
        Instant now = Instant.now();
        for (Map.Entry<UUID, UUID> e : companyToTenant.entrySet()) {
            UUID companyId = e.getKey();
            List<CompanyModuleRow> own = rows.stream().filter(r -> r.companyId().equals(companyId)).toList();
            List<String> keys = new ArrayList<>(own.stream().map(CompanyModuleRow::moduleKey).distinct().toList());
            for (String k : workspaceKeys.getOrDefault(e.getValue(), List.of())) if (!keys.contains(k)) keys.add(k);
            List<String> on = new ArrayList<>();
            for (String key : keys) {
                Map<String, Object> ws = workspaceKeys.getOrDefault(e.getValue(), List.of()).contains(key)
                        ? Map.of("status", "ACTIVE") : null;
                if (decide(key, own.stream().filter(r -> r.moduleKey().equals(key)).toList(), ws, now).entitled()) {
                    on.add(key);
                }
            }
            on.sort(String::compareTo);
            out.put(companyId, on);
        }
        return out;
    }

    /** The stored rows behind a company (for the admin detail page). */
    @Transactional(readOnly = true)
    public List<CompanyModuleRow> rows(UUID companyId) {
        return companyRows(List.of(companyId), null);
    }

    // ── Operator overrides ──────────────────────────────────────────────────

    /**
     * Switch a product on (ACTIVE) or off (SUSPENDED) for one company, outside its
     * subscription. One manual row per (company, product); setting it again replaces it.
     */
    @Transactional
    public CompanyModuleRow setManual(UUID tenantId, UUID companyId, String moduleKey, String status,
                                      Instant endsAt, String reason, String grantedBy) {
        if (!MANUAL_STATUSES.contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "status must be ACTIVE or SUSPENDED");
        }
        if (reason == null || reason.strip().length() < 5) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A manual change needs a reason of at least 5 characters (it is kept with the change)");
        }
        if (endsAt != null && !endsAt.isAfter(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "endsAt must be in the future");
        }
        requireModule(moduleKey);
        jdbc.update("""
                INSERT INTO platform.company_modules
                       (tenant_id, company_id, module_key, status, source, starts_at, ends_at, reason, granted_by)
                VALUES (?, ?, ?, ?, 'MANUAL', now(), ?, ?, ?)
                ON CONFLICT (company_id, module_key, source) DO UPDATE
                   SET status = EXCLUDED.status, starts_at = now(), ends_at = EXCLUDED.ends_at,
                       reason = EXCLUDED.reason, granted_by = EXCLUDED.granted_by, updated_at = now()
                """, tenantId, companyId, moduleKey, status,
                endsAt == null ? null : Timestamp.from(endsAt), reason.strip(), grantedBy);
        return companyRows(List.of(companyId), moduleKey).stream()
                .filter(r -> SOURCE_MANUAL.equals(r.source())).findFirst()
                .orElseThrow(() -> new IllegalStateException("manual row not found after upsert"));
    }

    /** Remove an operator override, so the subscription / workspace decides again. */
    @Transactional
    public boolean clearManual(UUID companyId, String moduleKey) {
        return jdbc.update("""
                UPDATE platform.company_modules SET status = 'CANCELLED', updated_at = now()
                 WHERE company_id = ? AND module_key = ? AND source = 'MANUAL' AND status <> 'CANCELLED'
                """, companyId, moduleKey) > 0;
    }

    // ── Internals ───────────────────────────────────────────────────────────

    static Entitlement decide(String moduleKey, List<CompanyModuleRow> rows, Map<String, Object> workspaceRow,
                              Instant now) {
        long version = rows.stream().map(CompanyModuleRow::updatedAt)
                .filter(java.util.Objects::nonNull).mapToLong(Instant::toEpochMilli).max().orElse(0L);

        CompanyModuleRow manual = rows.stream().filter(r -> SOURCE_MANUAL.equals(r.source())).findFirst().orElse(null);
        if (manual != null && !"CANCELLED".equals(manual.status())
                && (manual.endsAt() == null || manual.endsAt().isAfter(now))) {
            boolean on = manual.liveAt(now);
            return new Entitlement(moduleKey, on, SOURCE_MANUAL, manual.status(), manual.startsAt(), manual.endsAt(),
                    null, manual.seats(), null, manual.limits(), manual.reason(), manual.grantedBy(), version);
        }
        for (String source : List.of(SOURCE_SUBSCRIPTION, SOURCE_TRIAL)) {
            CompanyModuleRow row = rows.stream()
                    .filter(r -> source.equals(r.source()) && r.liveAt(now)).findFirst().orElse(null);
            if (row != null) {
                return new Entitlement(moduleKey, true, source, row.status(), row.startsAt(), row.endsAt(),
                        row.subscriptionId(), row.seats(), null, row.limits(), row.reason(), row.grantedBy(), version);
            }
        }
        if (workspaceRow != null && "ACTIVE".equals(workspaceRow.get("status"))) {
            Instant expires = workspaceRow.get("expires_at") instanceof Timestamp ts ? ts.toInstant() : null;
            if (expires == null || expires.isAfter(now)) {
                Integer seats = workspaceRow.get("seats") instanceof Number n ? n.intValue() : null;
                return new Entitlement(moduleKey, true, SOURCE_WORKSPACE, "ACTIVE", null, expires,
                        null, seats, null, null, null, null, version);
            }
        }
        return new Entitlement(moduleKey, false, SOURCE_NONE, null, null, null, null, null, null, null, null,
                null, version);
    }

    private List<CompanyModuleRow> companyRows(Collection<UUID> companyIds, String moduleKey) {
        if (companyIds.isEmpty()) return List.of();
        String in = String.join(",", companyIds.stream().map(x -> "?").toList());
        List<Object> args = new ArrayList<>(companyIds);
        String sql = """
                SELECT id, tenant_id, company_id, module_key, status, source, subscription_id, seats,
                       starts_at, ends_at, reason, granted_by, limits::text AS limits, updated_at
                  FROM platform.company_modules
                 WHERE company_id IN (%s)
                """.formatted(in);
        if (moduleKey != null) {
            sql += " AND module_key = ?";
            args.add(moduleKey);
        }
        sql += " ORDER BY module_key, source";
        return jdbc.query(sql, this::mapRow, args.toArray());
    }

    private Map<String, Object> workspaceRow(UUID tenantId, String moduleKey) {
        List<Map<String, Object>> r = jdbc.queryForList("""
                SELECT status, expires_at, seats FROM platform.tenant_modules
                 WHERE tenant_id = ? AND module_key = ?
                """, tenantId, moduleKey);
        return r.isEmpty() ? null : r.get(0);
    }

    private void requireModule(String moduleKey) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM platform.module_catalog WHERE key = ?",
                Integer.class, moduleKey);
        if (n == null || n == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown product module: " + moduleKey);
        }
    }

    private CompanyModuleRow mapRow(ResultSet rs, int i) throws SQLException {
        return new CompanyModuleRow(
                rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getObject("company_id", UUID.class), rs.getString("module_key"), rs.getString("status"),
                rs.getString("source"), rs.getObject("subscription_id", UUID.class),
                (Integer) rs.getObject("seats"), instant(rs, "starts_at"), instant(rs, "ends_at"),
                rs.getString("reason"), rs.getString("granted_by"), parseLimits(rs.getString("limits")),
                instant(rs, "updated_at"));
    }

    Map<String, Object> parseLimits(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return json.readValue(raw, new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            log.warn("company_modules.limits is not a JSON object: {}", e.getMessage());
            return null;
        }
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
