package com.unifiedtree.saas.admin.insight;

import com.unifiedtree.saas.admin.support.PageResult;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * The platform dashboard and the audit trail.
 *
 * <p>Every figure is read from a real table; nothing is estimated except where the
 * name says so ({@code estimatedMrrInr}, from active PAID subscriptions with annual
 * ones spread over twelve months). Marketing-engine figures (WABA connections,
 * queue failures) are not here: the admin console's BFF merges them from Marketing's
 * own API, so this service never reads MongoDB.
 */
@Service
public class PlatformInsightService {

    private final JdbcTemplate jdbc;
    private final TenantScopedReader scoped;

    public PlatformInsightService(JdbcTemplate jdbc, TenantScopedReader scoped) {
        this.jdbc = jdbc;
        this.scoped = scoped;
    }

    public record Dashboard(Map<String, Long> workspacesByStatus, long workspaces, long companies, long accounts,
                            long accountsActive30d, Map<String, Long> subscriptionsByStatus, long activePaid,
                            long activeTrial, long pastDue, long workspacesWithHrms, long companiesWithMarketing,
                            BigDecimal paidLast30dInr, long paymentsLast30d, BigDecimal estimatedMrrInr,
                            List<Map<String, Object>> recentPayments, List<AuditEventRow> recentPlatformEvents,
                            Instant generatedAt) {}

    public record AuditEventRow(UUID id, UUID tenantId, Instant occurredAt, UUID actorUserId, String actorEmail,
                                String actorIp, String module, String action, String entityType, String entityId,
                                String summary) {}

    public Dashboard dashboard() {
        Map<String, Long> byStatus = countBy("""
                SELECT status, count(*) FROM platform.tenants WHERE id <> ? GROUP BY status
                """, TenantContext.PLATFORM_TENANT_ID);
        long workspaces = byStatus.values().stream().mapToLong(Long::longValue).sum();

        long companies = 0;
        for (UUID tenantId : jdbc.queryForList("SELECT id FROM platform.tenants WHERE id <> ?", UUID.class,
                TenantContext.PLATFORM_TENANT_ID)) {
            Long n = scoped.read(tenantId, () -> jdbc.queryForObject("SELECT count(*) FROM org.companies", Long.class));
            companies += n == null ? 0 : n;
        }

        Map<String, Object> acc = jdbc.queryForMap("""
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE last_login_at > now() - interval '30 days') AS active
                  FROM platform.accounts
                """);
        Map<String, Long> subs = countBy("SELECT status, count(*) FROM platform.subscriptions GROUP BY status");
        Map<String, Object> s = jdbc.queryForMap("""
                SELECT count(*) FILTER (WHERE status = 'ACTIVE' AND plan_type = 'PAID')                     AS active_paid,
                       count(*) FILTER (WHERE status IN ('ACTIVE','TRIALING') AND plan_type = 'TRIAL')       AS active_trial,
                       count(*) FILTER (WHERE status IN ('PAST_DUE','HALTED','GRACE'))                       AS past_due,
                       coalesce(sum(CASE WHEN billing_cycle = 'ANNUAL' THEN amount_inr / 12 ELSE amount_inr END)
                                FILTER (WHERE status = 'ACTIVE' AND plan_type = 'PAID'), 0)                  AS mrr
                  FROM platform.subscriptions
                """);
        Long hrms = jdbc.queryForObject("""
                SELECT count(DISTINCT tenant_id) FROM platform.tenant_modules
                 WHERE module_key = 'hrms' AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now())
                """, Long.class);
        Long marketing = jdbc.queryForObject("""
                SELECT count(DISTINCT company_id) FROM platform.company_modules
                 WHERE module_key = 'whatsapp' AND status = 'ACTIVE'
                   AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
                """, Long.class);
        Map<String, Object> pay = jdbc.queryForMap("""
                SELECT coalesce(sum(amount_inr), 0) AS amount, count(*) AS n FROM platform.payments
                 WHERE status IN ('PAID','CONSUMED') AND paid_at > now() - interval '30 days'
                """);
        List<Map<String, Object>> recentPayments = jdbc.queryForList("""
                SELECT p.id, t.subdomain, p.amount_inr, p.status, p.paid_at, p.created_at,
                       array_to_string(p.plan_keys, ', ') AS plans
                  FROM platform.payments p LEFT JOIN platform.tenants t ON t.id = p.tenant_id
                 ORDER BY coalesce(p.paid_at, p.created_at) DESC LIMIT 5
                """);

        return new Dashboard(byStatus, workspaces, companies, num(acc.get("total")), num(acc.get("active")), subs,
                num(s.get("active_paid")), num(s.get("active_trial")), num(s.get("past_due")),
                hrms == null ? 0 : hrms, marketing == null ? 0 : marketing, (BigDecimal) pay.get("amount"),
                num(pay.get("n")), (BigDecimal) s.get("mrr"), recentPayments,
                audit(null, null, null, null, 0, 10).content(), Instant.now());
    }

    /**
     * Audit events: the platform's own trail when {@code tenantId} is null, else one
     * workspace's trail, read through that workspace's row-level security.
     */
    public PageResult<AuditEventRow> audit(UUID tenantId, String module, String action, String search,
                                           int page, int size) {
        UUID bound = tenantId == null ? TenantContext.PLATFORM_TENANT_ID : tenantId;
        if (tenantId != null) {
            Integer exists = jdbc.queryForObject("SELECT count(*) FROM platform.tenants WHERE id = ?",
                    Integer.class, tenantId);
            if (exists == null || exists == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found");
        }
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE tenant_id = ?");
        args.add(bound);
        if (module != null && !module.isBlank()) { where.append(" AND module = ?"); args.add(module.trim()); }
        if (action != null && !action.isBlank()) {
            where.append(" AND action = ?");
            args.add(action.trim().toUpperCase(Locale.ROOT));
        }
        if (search != null && !search.isBlank()) {
            where.append(" AND (summary ILIKE ? OR actor_email ILIKE ? OR entity_id::text ILIKE ?)");
            String like = "%" + search.trim() + "%";
            args.addAll(List.of(like, like, like));
        }
        return scoped.read(bound, () -> {
            Long total = jdbc.queryForObject("SELECT count(*) FROM audit.events" + where, Long.class, args.toArray());
            List<Object> pageArgs = new ArrayList<>(args);
            pageArgs.add(size);
            pageArgs.add((long) page * size);
            List<AuditEventRow> rows = jdbc.query("""
                    SELECT id, tenant_id, occurred_at, actor_user_id, actor_email, actor_ip, module, action,
                           entity_type, entity_id::text AS entity_id, summary
                      FROM audit.events
                    """ + where + " ORDER BY occurred_at DESC LIMIT ? OFFSET ?", this::mapAudit, pageArgs.toArray());
            return PageResult.of(rows, page, size, total == null ? 0 : total);
        });
    }

    private AuditEventRow mapAudit(ResultSet rs, int i) throws SQLException {
        Timestamp t = rs.getTimestamp("occurred_at");
        return new AuditEventRow(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                t == null ? null : t.toInstant(), rs.getObject("actor_user_id", UUID.class),
                rs.getString("actor_email"), rs.getString("actor_ip"), rs.getString("module"),
                rs.getString("action"), rs.getString("entity_type"), rs.getString("entity_id"),
                rs.getString("summary"));
    }

    private Map<String, Long> countBy(String sql, Object... args) {
        Map<String, Long> out = new LinkedHashMap<>();
        jdbc.query(sql, (ResultSet rs) -> { out.put(rs.getString(1), rs.getLong(2)); }, args);
        return out;
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }
}
