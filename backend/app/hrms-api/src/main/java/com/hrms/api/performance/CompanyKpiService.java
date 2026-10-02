package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.audit.AuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Company KPIs (redesign BW-83, lower priority): company-level targets that people's
 * goals count towards. {@code performance_mgmt.company_kpis} and
 * {@code performance_mgmt.goal_kpi_links} (V143.61, JDBC only; {@code goals} is
 * mapped by the Goal entity, so a goal's link is a side table).
 *
 * <p>A company KPI's progress is the <b>weighted average progress of its linked
 * goals</b> (dropped goals left out, each goal's progress capped at 100%, weights as
 * set on the goals; when every weight is 0 each goal counts equally). With no linked
 * goal there is no progress yet (null), never 0%.
 *
 * <p>Managing them needs {@code hrms.kpi.manage}; reading them
 * {@code hrms.performance.read} or {@code hrms.performance.review.self} (the goal
 * forms list them). The roll-up is an aggregate over the company, so it shows no one's
 * own goal. Until V143.61 is applied, reads answer FEATURE_NOT_READY and goals simply
 * carry no link.
 */
@Service
public class CompanyKpiService {

    private static final Logger log = LoggerFactory.getLogger(CompanyKpiService.class);
    static final Set<String> STATUSES = Set.of("ACTIVE", "COMPLETED", "DROPPED");
    static final int MAX_TITLE = 200, MAX_DESCRIPTION = 1000, MAX_UNIT = 24;

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public CompanyKpiService(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public record CompanyKpi(UUID id, UUID companyId, String title, String description, BigDecimal targetValue,
                             String unit, LocalDate dueDate, String status, Integer progress, int linkedGoals,
                             String createdAt, String updatedAt) {}

    public record CompanyKpiRequest(UUID companyId, String title, String description, BigDecimal targetValue,
                                    String unit, LocalDate dueDate, String status) {}

    boolean ready() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT to_regclass('performance_mgmt.company_kpis') IS NOT NULL AND to_regclass('performance_mgmt.goal_kpi_links') IS NOT NULL",
                Boolean.class));
    }

    // ── reads ─────────────────────────────────────────────────────────────────

    /** Company KPIs with their roll-up, newest first. {@code companyId} null = every company; dropped ones only when asked. */
    @Transactional(readOnly = true)
    public List<CompanyKpi> list(UUID tenantId, UUID companyId, boolean includeDropped) {
        if (!ready()) throw new FeatureNotReady();
        StringBuilder sql = new StringBuilder(SELECT).append(" WHERE k.tenant_id = ?");
        List<Object> args = new ArrayList<>(List.of(tenantId));
        if (companyId != null) { sql.append(" AND k.company_id = ?"); args.add(companyId); }
        if (!includeDropped) sql.append(" AND k.status <> 'DROPPED'");
        sql.append(GROUP).append(" ORDER BY (k.status = 'ACTIVE') DESC, k.due_date NULLS LAST, LOWER(k.title)");
        return jdbc.query(sql.toString(), (rs, i) -> row(rs), args.toArray());
    }

    @Transactional(readOnly = true)
    public CompanyKpi get(UUID tenantId, UUID id) {
        if (!ready()) throw new FeatureNotReady();
        List<CompanyKpi> rows = jdbc.query(SELECT + " WHERE k.tenant_id = ? AND k.id = ?" + GROUP,
                (rs, i) -> row(rs), tenantId, id);
        if (rows.isEmpty()) throw new ResourceNotFoundException("Company KPI", id);
        return rows.get(0);
    }

    /** goal id → [company KPI id, its title] for one person's goals; empty before V143.61. */
    Map<UUID, Object[]> linksOf(UUID tenantId, UUID employeeId) {
        if (!ready()) return Map.of();
        Map<UUID, Object[]> out = new HashMap<>();
        jdbc.query("""
                SELECT l.goal_id, k.id, k.title
                  FROM performance_mgmt.goal_kpi_links l
                  JOIN performance_mgmt.company_kpis k ON k.id = l.company_kpi_id AND k.tenant_id = l.tenant_id
                  JOIN performance_mgmt.goals g ON g.id = l.goal_id AND g.tenant_id = l.tenant_id
                 WHERE l.tenant_id = ? AND g.employee_id = ?
                """, (RowCallbackHandler) rs -> out.put(rs.getObject("goal_id", UUID.class),
                        new Object[] { rs.getObject("id", UUID.class), rs.getString("title") }), tenantId, employeeId);
        return out;
    }

    /** goal id → [company KPI id, its title] for the given goals; empty before V143.61. */
    Map<UUID, Object[]> linksFor(UUID tenantId, java.util.Collection<UUID> goalIds) {
        if (goalIds.isEmpty() || !ready()) return Map.of();
        List<Object> args = new ArrayList<>(List.of(tenantId));
        args.addAll(goalIds);
        Map<UUID, Object[]> out = new HashMap<>();
        jdbc.query("""
                SELECT l.goal_id, k.id, k.title
                  FROM performance_mgmt.goal_kpi_links l
                  JOIN performance_mgmt.company_kpis k ON k.id = l.company_kpi_id AND k.tenant_id = l.tenant_id
                 WHERE l.tenant_id = ? AND l.goal_id IN (""" + PerformanceCycleService.marks(goalIds.size()) + ")",
                (RowCallbackHandler) rs -> out.put(rs.getObject("goal_id", UUID.class),
                        new Object[] { rs.getObject("id", UUID.class), rs.getString("title") }), args.toArray());
        return out;
    }

    // ── writes ────────────────────────────────────────────────────────────────

    @Transactional
    public CompanyKpi create(UUID tenantId, CompanyKpiRequest req, UUID actorUserId) {
        if (!ready()) throw new FeatureNotReady();
        if (req.companyId() == null) throw new BusinessRuleException("Choose the company", "COMPANY_REQUIRED");
        Integer company = jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE tenant_id = ? AND id = ?",
                Integer.class, tenantId, req.companyId());
        if (company == null || company == 0) throw new BusinessRuleException("That company isn't in this workspace", "COMPANY_NOT_FOUND");
        String title = title(req.title());
        validate(req);
        UUID id = jdbc.queryForObject("""
                INSERT INTO performance_mgmt.company_kpis
                    (tenant_id, company_id, title, description, target_value, unit, due_date, status, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                RETURNING id
                """, UUID.class, tenantId, req.companyId(), title, blank(req.description()), req.targetValue(),
                blank(req.unit()), req.dueDate() == null ? null : java.sql.Date.valueOf(req.dueDate()), actorUserId, actorUserId);
        record("COMPANY_KPI_CREATED", id, "Company KPI \"" + title + "\" added");
        return get(tenantId, id);
    }

    /** Partial update: null leaves a field as it is; an empty description or unit clears it. */
    @Transactional
    public CompanyKpi update(UUID tenantId, UUID id, CompanyKpiRequest req, UUID actorUserId) {
        CompanyKpi existing = get(tenantId, id);
        validate(req);
        if (req.status() != null && !STATUSES.contains(req.status())) {
            throw new BusinessRuleException("Status must be active, completed or dropped", "INVALID_STATUS");
        }
        StringBuilder sql = new StringBuilder("UPDATE performance_mgmt.company_kpis SET updated_at = now(), updated_by = ?");
        List<Object> args = new ArrayList<>();
        args.add(actorUserId);
        if (req.title() != null) { sql.append(", title = ?"); args.add(title(req.title())); }
        if (req.description() != null) { sql.append(", description = ?"); args.add(blank(req.description())); }
        if (req.targetValue() != null) { sql.append(", target_value = ?"); args.add(req.targetValue()); }
        if (req.unit() != null) { sql.append(", unit = ?"); args.add(blank(req.unit())); }
        if (req.dueDate() != null) { sql.append(", due_date = ?"); args.add(java.sql.Date.valueOf(req.dueDate())); }
        if (req.status() != null) { sql.append(", status = ?"); args.add(req.status()); }
        sql.append(" WHERE tenant_id = ? AND id = ?");
        args.add(tenantId);
        args.add(id);
        jdbc.update(sql.toString(), args.toArray());
        record("COMPANY_KPI_UPDATED", id, "Company KPI \"" + existing.title() + "\" changed"
                + (req.status() != null && !req.status().equals(existing.status()) ? " (" + req.status().toLowerCase() + ")" : ""));
        return get(tenantId, id);
    }

    /**
     * A goal of {@code employeeId} may count towards this KPI: it exists in this
     * workspace, isn't dropped, and belongs to the person's company.
     */
    void requireLinkable(UUID tenantId, UUID employeeId, UUID kpiId) {
        if (!ready()) throw new FeatureNotReady();
        Boolean ok = jdbc.query("""
                SELECT k.status <> 'DROPPED' AND k.company_id = e.company_id AS ok
                  FROM performance_mgmt.company_kpis k
                  JOIN hrms.employees e ON e.tenant_id = k.tenant_id AND e.id = ?
                 WHERE k.tenant_id = ? AND k.id = ?
                """, rs -> rs.next() ? rs.getBoolean("ok") : null, employeeId, tenantId, kpiId);
        if (ok == null) throw new BusinessRuleException("That company KPI isn't in this workspace", "COMPANY_KPI_NOT_FOUND");
        if (!ok) throw new BusinessRuleException("Pick an open company KPI of this person's company", "COMPANY_KPI_NOT_LINKABLE");
    }

    /** Point the goal at this KPI (one KPI per goal). */
    void link(UUID tenantId, UUID goalId, UUID kpiId, UUID actorUserId) {
        jdbc.update("""
                INSERT INTO performance_mgmt.goal_kpi_links (tenant_id, goal_id, company_kpi_id, created_by)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (tenant_id, goal_id) DO UPDATE SET company_kpi_id = EXCLUDED.company_kpi_id,
                       created_by = EXCLUDED.created_by, created_at = now()
                """, tenantId, goalId, kpiId, actorUserId);
    }

    /** Remove the goal's link, if any. */
    void unlink(UUID tenantId, UUID goalId) {
        if (!ready()) return;
        jdbc.update("DELETE FROM performance_mgmt.goal_kpi_links WHERE tenant_id = ? AND goal_id = ?", tenantId, goalId);
    }

    // ── rules (pure, unit-tested) ─────────────────────────────────────────────

    /**
     * Weighted average progress, each goal capped at 100; equal weights when every
     * weight is 0; null with no goals.
     */
    static Integer rollUp(List<int[]> progressAndWeight) {
        if (progressAndWeight.isEmpty()) return null;
        long weightSum = progressAndWeight.stream().mapToLong(p -> Math.max(0, p[1])).sum();
        BigDecimal total = BigDecimal.ZERO;
        for (int[] p : progressAndWeight) {
            int pct = Math.max(0, Math.min(100, p[0]));
            long w = weightSum == 0 ? 1 : Math.max(0, p[1]);
            total = total.add(BigDecimal.valueOf((long) pct * w));
        }
        long divisor = weightSum == 0 ? progressAndWeight.size() : weightSum;
        return total.divide(BigDecimal.valueOf(divisor), 0, RoundingMode.HALF_UP).intValue();
    }

    static String title(String raw) {
        String t = raw == null ? "" : raw.trim();
        if (t.isEmpty()) throw new BusinessRuleException("Give the KPI a title", "TITLE_REQUIRED");
        if (t.length() > MAX_TITLE) throw new BusinessRuleException("The title can be at most " + MAX_TITLE + " characters", "TITLE_TOO_LONG");
        return t;
    }

    static void validate(CompanyKpiRequest req) {
        if (req.description() != null && req.description().trim().length() > MAX_DESCRIPTION) {
            throw new BusinessRuleException("The description can be at most " + MAX_DESCRIPTION + " characters", "FIELD_TOO_LONG");
        }
        if (req.unit() != null && req.unit().trim().length() > MAX_UNIT) {
            throw new BusinessRuleException("The unit can be at most " + MAX_UNIT + " characters", "FIELD_TOO_LONG");
        }
        if (req.targetValue() != null && req.targetValue().signum() <= 0) {
            throw new BusinessRuleException("The target must be more than zero", "INVALID_TARGET");
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * The roll-up in SQL: SUM(LEAST(progress,100) * weight) / SUM(weight), or the plain
     * average when the weights add up to 0 — the same rule as {@link #rollUp}.
     */
    private static final String SELECT = """
            SELECT k.*, COUNT(g.id) AS linked,
                   CASE WHEN COUNT(g.id) = 0 THEN NULL
                        WHEN COALESCE(SUM(GREATEST(g.weight, 0)), 0) = 0 THEN ROUND(AVG(LEAST(GREATEST(g.progress, 0), 100)))
                        ELSE ROUND(SUM(LEAST(GREATEST(g.progress, 0), 100) * GREATEST(g.weight, 0))::numeric
                                   / SUM(GREATEST(g.weight, 0))) END AS rolled
              FROM performance_mgmt.company_kpis k
              LEFT JOIN performance_mgmt.goal_kpi_links l ON l.company_kpi_id = k.id AND l.tenant_id = k.tenant_id
              LEFT JOIN performance_mgmt.goals g ON g.id = l.goal_id AND g.tenant_id = l.tenant_id AND g.status <> 'DROPPED'
            """;
    private static final String GROUP = " GROUP BY k.tenant_id, k.id";

    private static CompanyKpi row(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.Date due = rs.getDate("due_date");
        BigDecimal rolled = rs.getBigDecimal("rolled");
        java.sql.Timestamp c = rs.getTimestamp("created_at"), u = rs.getTimestamp("updated_at");
        return new CompanyKpi(rs.getObject("id", UUID.class), rs.getObject("company_id", UUID.class),
                rs.getString("title"), rs.getString("description"), rs.getBigDecimal("target_value"),
                rs.getString("unit"), due == null ? null : due.toLocalDate(), rs.getString("status"),
                rolled == null ? null : rolled.intValue(), rs.getInt("linked"),
                c == null ? null : c.toInstant().toString(), u == null ? null : u.toInstant().toString());
    }

    private static String blank(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }

    private void record(String action, UUID id, String summary) {
        try {
            audit.record("performance", action, "company_kpi", id, summary);
        } catch (Exception e) {
            log.warn("Audit of {} failed (non-fatal): {}", action, e.getMessage());
        }
    }
}
