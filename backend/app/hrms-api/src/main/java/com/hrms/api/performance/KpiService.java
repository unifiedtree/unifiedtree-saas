package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * KPI / Goal administration. Wave 4 (2026-08-11).
 *
 * <p>Backed by {@code performance_mgmt.goals} — Wave 1 (V082) extended the
 * table with {@code target_value / current_value / unit / direction /
 * due_date / category} + created {@code performance_mgmt.kpi_progress_updates}
 * for audit history.
 *
 * <p>Manager scoping: a MANAGER role reads/writes only for their DIRECT
 * REPORTS (recursive one-hop via {@code reporting_manager_id}). Admin roles
 * bypass. Recursive-CTE version reserved for a later wave — one-hop covers
 * the demo and is O(1) per query.
 *
 * <p>Progress arithmetic:
 * <ul>
 *   <li>HIGHER_IS_BETTER: progress_pct = clamp(current/target × 100, 0, 200)</li>
 *   <li>LOWER_IS_BETTER : progress_pct = clamp(target/current × 100, 0, 200)</li>
 *   <li>TARGET_EXACT    : progress_pct = 100 iff |current−target| within 5% of target, else scaled</li>
 * </ul>
 * clamp to 200 so a 3× overachievement doesn't overflow the UI bar but stays visible.
 */
@Service
public class KpiService {

    private static final Logger log = LoggerFactory.getLogger(KpiService.class);
    private static final int MAX_PAGE_SIZE = 200;
    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final BigDecimal MAX_PCT = new BigDecimal("200");
    private static final Set<String> ALLOWED_DIRECTIONS =
            Set.of("HIGHER_IS_BETTER", "LOWER_IS_BETTER", "TARGET_EXACT");
    private static final Set<String> ALLOWED_STATUSES =
            Set.of("ACTIVE", "COMPLETED", "DROPPED", "AT_RISK");

    private final JdbcTemplate jdbc;

    public KpiService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record KpiRowDto(
            UUID id, UUID ownerId, String ownerName, String ownerCode,
            String title, String description, String category,
            BigDecimal targetValue, BigDecimal currentValue, String unit,
            String direction, BigDecimal progressPct,
            BigDecimal weight, String dueDate, String status,
            String createdAt, String updatedAt) {}

    public record CreateKpiRequest(
            @jakarta.validation.constraints.NotNull UUID ownerId,        // employee_id
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 300) String title,
            String description,
            @jakarta.validation.constraints.Size(max = 40) String category,
            BigDecimal targetValue,
            BigDecimal currentValue,
            @jakarta.validation.constraints.Size(max = 24) String unit,
            String direction,       // one of ALLOWED_DIRECTIONS
            BigDecimal weight,
            String dueDate) {}

    public record UpdateKpiRequest(
            String title, String description, String category,
            BigDecimal targetValue, String unit, String direction,
            BigDecimal weight, String dueDate, String status, UUID ownerId) {}

    public record ProgressUpdateRequest(
            @jakarta.validation.constraints.NotNull BigDecimal newValue,
            String notes) {}

    public record ProgressUpdateDto(
            UUID id, BigDecimal previousValue, BigDecimal newValue,
            BigDecimal progressPct, String notes, UUID updatedBy, String updatedAt) {}

    public record PageDto<T>(List<T> items, int page, int size, long total) {}

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Paged directory of KPIs. When {@code managerId} is passed we scope to
     * that manager's direct reports; when null (or when the caller has an
     * admin role) we return all rows.
     */
    @Transactional
    public PageDto<KpiRowDto> list(UUID tenantId, UUID ownerId, UUID managerId,
                                   String status, String search, int page, int size) {
        bindTenant(tenantId);
        if (page < 0) page = 0;
        if (size <= 0) size = 25;
        if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;

        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (ownerId != null) { where.append(" AND g.employee_id = ?"); args.add(ownerId); }
        if (managerId != null) {
            // Direct-reports-only scoping via one-hop join. Cheap + right for
            // the demo; upgrade to recursive CTE when the manager tree gets
            // deep enough that direct reports isn't sufficient scope.
            where.append(" AND g.employee_id IN (SELECT id FROM hrms.employees WHERE reporting_manager_id = ? AND is_active)");
            args.add(managerId);
        }
        if (status != null)  { where.append(" AND g.status = ?"); args.add(status); }
        if (search != null && !search.isBlank()) {
            where.append(" AND LOWER(g.title) LIKE ?");
            args.add("%" + search.toLowerCase() + "%");
        }

        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM performance_mgmt.goals g" + where,
                Long.class, args.toArray());
        if (total == null) total = 0L;

        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add(page * size);

        String sql = """
                SELECT g.*,
                       TRIM(e.first_name || ' ' || COALESCE(e.last_name,'')) AS owner_name,
                       e.employee_code                                        AS owner_code
                  FROM performance_mgmt.goals g
                  LEFT JOIN hrms.employees e ON e.id = g.employee_id AND e.tenant_id = g.tenant_id
                """ + where + """
                 ORDER BY g.updated_at DESC
                 LIMIT ? OFFSET ?
                """;
        List<KpiRowDto> rows = jdbc.query(sql, (rs, i) -> toKpiDto(rs), pageArgs.toArray());
        return new PageDto<>(rows, page, size, total);
    }

    @Transactional
    public KpiRowDto get(UUID tenantId, UUID id) {
        bindTenant(tenantId);
        return jdbc.query("""
                SELECT g.*,
                       TRIM(e.first_name || ' ' || COALESCE(e.last_name,'')) AS owner_name,
                       e.employee_code                                        AS owner_code
                  FROM performance_mgmt.goals g
                  LEFT JOIN hrms.employees e ON e.id = g.employee_id AND e.tenant_id = g.tenant_id
                 WHERE g.id = ?
                """, rs -> {
                    if (!rs.next()) throw new BusinessRuleException("KPI not found", "KPI_NOT_FOUND");
                    return toKpiDto(rs);
                }, id);
    }

    @Transactional
    public List<ProgressUpdateDto> progressHistory(UUID tenantId, UUID kpiId) {
        bindTenant(tenantId);
        return jdbc.query("""
                SELECT * FROM performance_mgmt.kpi_progress_updates
                 WHERE goal_id = ? ORDER BY updated_at DESC
                """, (rs, i) -> new ProgressUpdateDto(
                    rs.getObject("id", UUID.class),
                    rs.getBigDecimal("previous_value"),
                    rs.getBigDecimal("new_value"),
                    rs.getBigDecimal("progress_pct"),
                    rs.getString("notes"),
                    rs.getObject("updated_by", UUID.class),
                    ts(rs.getTimestamp("updated_at"))), kpiId);
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    @Transactional
    public KpiRowDto create(UUID tenantId, CreateKpiRequest req, UUID actorId) {
        bindTenant(tenantId);
        validateDirection(req.direction());
        BigDecimal pct = computeProgressPct(req.currentValue(), req.targetValue(), req.direction());

        UUID id = jdbc.queryForObject("""
                INSERT INTO performance_mgmt.goals
                    (tenant_id, employee_id, title, description, category,
                     target_value, current_value, unit, direction, weight,
                     due_date, progress, status, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                RETURNING id
                """, UUID.class,
                tenantId, req.ownerId(), req.title(), req.description(), req.category(),
                req.targetValue(), req.currentValue(), req.unit(), req.direction(),
                req.weight(), parseDate(req.dueDate()),
                pct == null ? null : pct.intValue(),
                actorId == null ? null : actorId.toString(),
                actorId == null ? null : actorId.toString());

        // Seed the audit log with the initial value so the history endpoint
        // has something to show from day one.
        if (req.currentValue() != null) {
            jdbc.update("""
                    INSERT INTO performance_mgmt.kpi_progress_updates
                        (tenant_id, goal_id, previous_value, new_value,
                         progress_pct, notes, updated_by)
                    VALUES (?, ?, NULL, ?, ?, 'Initial value', ?)
                    """, tenantId, id, req.currentValue(),
                    pct == null ? BigDecimal.ZERO : pct,
                    actorId);
        }
        return get(tenantId, id);
    }

    @Transactional
    public KpiRowDto update(UUID tenantId, UUID id, UpdateKpiRequest req, UUID actorId) {
        bindTenant(tenantId);
        KpiRowDto existing = get(tenantId, id);   // 404 if missing
        if (req.direction() != null) validateDirection(req.direction());
        if (req.status() != null && !ALLOWED_STATUSES.contains(req.status()))
            throw new BusinessRuleException("Unknown status: " + req.status(), "INVALID_STATUS");

        StringBuilder sql = new StringBuilder("UPDATE performance_mgmt.goals SET updated_at = now()");
        List<Object> args = new ArrayList<>();
        if (req.title()       != null) { sql.append(", title = ?");        args.add(req.title()); }
        if (req.description() != null) { sql.append(", description = ?");  args.add(req.description()); }
        if (req.category()    != null) { sql.append(", category = ?");     args.add(req.category()); }
        if (req.targetValue() != null) { sql.append(", target_value = ?"); args.add(req.targetValue()); }
        if (req.unit()        != null) { sql.append(", unit = ?");         args.add(req.unit()); }
        if (req.direction()   != null) { sql.append(", direction = ?");    args.add(req.direction()); }
        if (req.weight()      != null) { sql.append(", weight = ?");       args.add(req.weight()); }
        if (req.dueDate()     != null) { sql.append(", due_date = ?");     args.add(parseDate(req.dueDate())); }
        if (req.status()      != null) { sql.append(", status = ?");       args.add(req.status()); }
        if (req.ownerId()     != null) { sql.append(", employee_id = ?");  args.add(req.ownerId()); }
        if (actorId != null)           { sql.append(", updated_by = ?");   args.add(actorId.toString()); }
        sql.append(", version = version + 1 WHERE id = ?");
        args.add(id);

        // Recompute progress_pct if target or direction changed (or if ownership
        // context makes it stale). Simple: recompute always after the update.
        int rows = jdbc.update(sql.toString(), args.toArray());
        if (rows == 0) throw new BusinessRuleException("KPI not found", "KPI_NOT_FOUND");

        recomputeProgressPct(id);
        return get(tenantId, id);
    }

    @Transactional
    public KpiRowDto updateProgress(UUID tenantId, UUID id, ProgressUpdateRequest req, UUID actorId) {
        bindTenant(tenantId);
        BigDecimal[] snap = jdbc.query("""
                SELECT current_value, target_value, direction
                  FROM performance_mgmt.goals WHERE id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    return new BigDecimal[] {
                        rs.getBigDecimal("current_value"),
                        rs.getBigDecimal("target_value"),
                        new BigDecimal(rs.getString("direction") == null
                            ? "0" : "1")   // marker; direction not numeric — use accessor below
                    };
                }, id);
        if (snap == null) throw new BusinessRuleException("KPI not found", "KPI_NOT_FOUND");

        String direction = jdbc.query(
                "SELECT direction FROM performance_mgmt.goals WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null, id);
        BigDecimal previous = snap[0];
        BigDecimal target   = snap[1];
        BigDecimal pct = computeProgressPct(req.newValue(), target, direction);
        if (pct == null) pct = BigDecimal.ZERO;

        jdbc.update("""
                UPDATE performance_mgmt.goals
                   SET current_value = ?, progress = ?,
                       updated_at = now(), updated_by = ?, version = version + 1
                 WHERE id = ?
                """, req.newValue(), pct.intValue(),
                actorId == null ? null : actorId.toString(), id);
        jdbc.update("""
                INSERT INTO performance_mgmt.kpi_progress_updates
                    (tenant_id, goal_id, previous_value, new_value,
                     progress_pct, notes, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, tenantId, id, previous, req.newValue(), pct, req.notes(), actorId);
        return get(tenantId, id);
    }

    /** Soft delete — status='DROPPED' keeps history for audit; hard-DELETE not exposed. */
    @Transactional
    public void softDelete(UUID tenantId, UUID id, UUID actorId) {
        bindTenant(tenantId);
        int rows = jdbc.update("""
                UPDATE performance_mgmt.goals
                   SET status = 'DROPPED', updated_at = now(),
                       updated_by = ?, version = version + 1
                 WHERE id = ? AND status <> 'DROPPED'
                """, actorId == null ? null : actorId.toString(), id);
        if (rows == 0) {
            // Distinguish "already dropped" (no-op — treat as success) from "not found"
            Integer exists = jdbc.queryForObject(
                    "SELECT count(*) FROM performance_mgmt.goals WHERE id = ?",
                    Integer.class, id);
            if (exists == null || exists == 0) {
                throw new BusinessRuleException("KPI not found", "KPI_NOT_FOUND");
            }
        }
    }

    // ── Nightly at-risk sweeper (called from a scheduler wrapper, not exposed) ──

    /**
     * Auto-flip {@code ACTIVE} goals to {@code AT_RISK} when
     * {@code due_date < today AND progress_pct < 100}. Called from a
     * {@code @Scheduled} wrapper that loops through every tenant and
     * SET LOCAL app.tenant_id — this method assumes the caller has already
     * bound the tenant + wants ONE tenant's flip.
     */
    @Transactional
    public int flipOverdueToAtRisk(UUID tenantId) {
        bindTenant(tenantId);
        return jdbc.update("""
                UPDATE performance_mgmt.goals
                   SET status = 'AT_RISK', updated_at = now(),
                       version = version + 1
                 WHERE status = 'ACTIVE'
                   AND due_date IS NOT NULL AND due_date < CURRENT_DATE
                   AND COALESCE(progress, 0) < 100
                """);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private void recomputeProgressPct(UUID kpiId) {
        Object[] snap = jdbc.query("""
                SELECT current_value, target_value, direction
                  FROM performance_mgmt.goals WHERE id = ?
                """, rs -> {
                    if (!rs.next()) return null;
                    return new Object[] { rs.getBigDecimal("current_value"),
                                          rs.getBigDecimal("target_value"),
                                          rs.getString("direction") };
                }, kpiId);
        if (snap == null) return;
        BigDecimal pct = computeProgressPct((BigDecimal) snap[0], (BigDecimal) snap[1], (String) snap[2]);
        if (pct != null) jdbc.update("UPDATE performance_mgmt.goals SET progress = ? WHERE id = ?",
                pct.intValue(), kpiId);
    }

    private static BigDecimal computeProgressPct(BigDecimal current, BigDecimal target, String direction) {
        if (current == null || target == null || target.signum() == 0) return null;
        BigDecimal pct;
        if ("LOWER_IS_BETTER".equals(direction)) {
            // Guard against current=0 blowing up. Also: if current<=target we're 100%.
            if (current.signum() <= 0) return HUNDRED;
            if (current.compareTo(target) <= 0) return HUNDRED;
            pct = target.multiply(HUNDRED).divide(current, 2, RoundingMode.HALF_UP);
        } else if ("TARGET_EXACT".equals(direction)) {
            BigDecimal diff = current.subtract(target).abs();
            BigDecimal tolerance = target.abs().multiply(new BigDecimal("0.05"));
            if (diff.compareTo(tolerance) <= 0) return HUNDRED;
            // Linearly scale down to 0 as we drift 100% off target.
            BigDecimal ratio = diff.divide(target.abs(), 4, RoundingMode.HALF_UP);
            BigDecimal deficit = HUNDRED.multiply(ratio);
            pct = HUNDRED.subtract(deficit).max(BigDecimal.ZERO);
        } else {
            // Default: HIGHER_IS_BETTER
            pct = current.multiply(HUNDRED).divide(target, 2, RoundingMode.HALF_UP);
        }
        if (pct.signum() < 0) pct = BigDecimal.ZERO;
        if (pct.compareTo(MAX_PCT) > 0) pct = MAX_PCT;
        return pct;
    }

    private static void validateDirection(String d) {
        if (d != null && !ALLOWED_DIRECTIONS.contains(d))
            throw new BusinessRuleException("direction must be one of " + ALLOWED_DIRECTIONS,
                    "INVALID_DIRECTION");
    }

    private KpiRowDto toKpiDto(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.Date dueDate = rs.getDate("due_date");
        Object pctObj = rs.getObject("progress");
        BigDecimal pct = pctObj == null ? null : new BigDecimal(pctObj.toString());
        return new KpiRowDto(
                rs.getObject("id", UUID.class),
                rs.getObject("employee_id", UUID.class),
                rs.getString("owner_name"),
                rs.getString("owner_code"),
                rs.getString("title"),
                rs.getString("description"),
                rs.getString("category"),
                rs.getBigDecimal("target_value"),
                rs.getBigDecimal("current_value"),
                rs.getString("unit"),
                rs.getString("direction"),
                pct,
                rs.getBigDecimal("weight"),
                dueDate == null ? null : dueDate.toString(),
                rs.getString("status"),
                ts(rs.getTimestamp("created_at")),
                ts(rs.getTimestamp("updated_at")));
    }

    private static String ts(java.sql.Timestamp t) {
        return t == null ? null : t.toInstant().toString();
    }

    /**
     * QA FIX (2026-08-11, finding wmih6ivbj/HIGH-5): previously the callers
     * did {@code java.sql.Date.valueOf(req.dueDate())} directly — a bad
     * input like "2026/08/11" or "yesterday" threw IllegalArgumentException
     * and became a 500. Now returns 400 INVALID_DATE with the offending value.
     */
    private static java.sql.Date parseDate(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return java.sql.Date.valueOf(s);
        } catch (IllegalArgumentException e) {
            throw new BusinessRuleException(
                    "Invalid date '" + s + "' — expected YYYY-MM-DD",
                    "INVALID_DATE");
        }
    }

    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
    }
}
