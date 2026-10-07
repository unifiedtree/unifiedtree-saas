package com.unifiedtree.saas.admin.catalog;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Products and plans, and their prices over time.
 *
 * <p>Reuses the existing catalogue — {@code platform.module_catalog} (what can be
 * switched on) and {@code platform.module_plans} (what is sold) — rather than a
 * second admin-only product list. {@code module_plans.price_inr} stays the current
 * price that checkout, the website and seat billing already read;
 * {@code platform.module_plan_prices} (V144.103) adds the history behind it.
 */
@Service
public class PlatformCatalogService {

    private static final Set<String> PRICE_MODELS = Set.of("PER_SEAT", "FLAT");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public PlatformCatalogService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record ModuleRow(String key, String displayName, String description, String category,
                            boolean available, List<String> inPlans, long workspacesActive, long companiesActive) {}

    public record PlanRow(String key, String displayName, String tagline, String category, String status,
                          BigDecimal priceInr, String priceModel, BigDecimal annualDiscountPct, boolean included,
                          List<String> includedModules, List<String> features, Map<String, Object> limits,
                          UUID currentPriceVersionId, Instant priceSince, int sortOrder) {}

    public record PriceVersion(UUID id, String planKey, String currency, BigDecimal unitPrice, String priceModel,
                               BigDecimal annualDiscountPct, Instant validFrom, Instant validTo, String reason,
                               String createdBy, Instant createdAt, boolean current) {}

    public record PriceChange(PlanRow plan, PriceVersion previous, PriceVersion current, int razorpayPlansCleared) {}

    public List<ModuleRow> modules() {
        return jdbc.query("""
                SELECT c.key, c.display_name, c.description, c.category, c.is_available,
                       (SELECT string_agg(p.key, ',' ORDER BY p.sort_order) FROM platform.module_plans p
                         WHERE c.key = ANY (p.included_modules) AND p.status <> 'RETIRED') AS in_plans,
                       (SELECT count(*) FROM platform.tenant_modules tm
                         WHERE tm.module_key = c.key AND tm.status = 'ACTIVE') AS ws_active,
                       (SELECT count(DISTINCT cm.company_id) FROM platform.company_modules cm
                         WHERE cm.module_key = c.key AND cm.status = 'ACTIVE'
                           AND (cm.ends_at IS NULL OR cm.ends_at > now())) AS co_active
                  FROM platform.module_catalog c
                 ORDER BY c.is_available DESC, c.display_name
                """, (rs, i) -> new ModuleRow(rs.getString("key"), rs.getString("display_name"),
                rs.getString("description"), rs.getString("category"), rs.getBoolean("is_available"),
                split(rs.getString("in_plans")), rs.getLong("ws_active"), rs.getLong("co_active")));
    }

    public List<PlanRow> plans() {
        return jdbc.query(planSql("") + " ORDER BY p.sort_order, p.key", this::mapPlan);
    }

    public PlanRow plan(String key) {
        List<PlanRow> rows = jdbc.query(planSql(" WHERE p.key = ?"), this::mapPlan, key);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Plan not found: " + key);
        return rows.get(0);
    }

    public List<PriceVersion> priceHistory(String planKey) {
        plan(planKey);
        return jdbc.query("""
                SELECT * FROM platform.module_plan_prices WHERE plan_key = ? ORDER BY valid_from DESC, created_at DESC
                """, this::mapPrice, planKey);
    }

    /**
     * Publish a new price for a plan, effective now.
     *
     * <p>In one transaction: close the current version, open the new one, update
     * {@code module_plans} (so checkout charges it), and clear the cached Razorpay
     * plans for the plan's modules. That cache is keyed by (module, cycle), not by
     * price ({@code SubscriptionService.ensureRazorpayPlan}), so without clearing it
     * new checkouts would keep being charged the old price by Razorpay. Subscriptions
     * that already exist hold their own Razorpay plan id and are unaffected.
     */
    @Transactional
    public PriceChange changePrice(String planKey, BigDecimal unitPrice, String priceModel,
                                   BigDecimal annualDiscountPct, String reason, String createdBy) {
        if (unitPrice == null || unitPrice.signum() < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unitPrice must be zero or more");
        }
        if (reason == null || reason.strip().length() < 5) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A price change needs a reason of at least 5 characters (it is kept in the price history)");
        }
        List<Map<String, Object>> locked = jdbc.queryForList("""
                SELECT key, price_inr, price_model, annual_discount_pct, included_modules
                  FROM platform.module_plans WHERE key = ? FOR UPDATE
                """, planKey);
        if (locked.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Plan not found: " + planKey);
        Map<String, Object> p = locked.get(0);

        String model = priceModel == null || priceModel.isBlank()
                ? (String) p.get("price_model") : priceModel.trim().toUpperCase(Locale.ROOT);
        if (!PRICE_MODELS.contains(model)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "priceModel must be PER_SEAT or FLAT");
        }
        BigDecimal discount = annualDiscountPct == null ? (BigDecimal) p.get("annual_discount_pct") : annualDiscountPct;
        if (discount.signum() < 0 || discount.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "annualDiscountPct must be between 0 and 100");
        }
        BigDecimal price = unitPrice.setScale(2, RoundingMode.HALF_UP);
        if (price.compareTo((BigDecimal) p.get("price_inr")) == 0 && model.equals(p.get("price_model"))
                && discount.compareTo((BigDecimal) p.get("annual_discount_pct")) == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That is already the plan's current price");
        }

        List<PriceVersion> open = jdbc.query("""
                SELECT * FROM platform.module_plan_prices
                 WHERE plan_key = ? AND currency = 'INR' AND valid_to IS NULL FOR UPDATE
                """, this::mapPrice, planKey);
        PriceVersion previous = open.isEmpty() ? null : open.get(0);

        Instant now = jdbc.queryForObject("SELECT now()", Timestamp.class).toInstant();
        if (previous != null) {
            jdbc.update("UPDATE platform.module_plan_prices SET valid_to = ? WHERE id = ?",
                    Timestamp.from(now), previous.id());
        }
        UUID newId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO platform.module_plan_prices
                       (id, plan_key, currency, unit_price, price_model, annual_discount_pct, valid_from, reason, created_by)
                VALUES (?, ?, 'INR', ?, ?, ?, ?, ?, ?)
                """, newId, planKey, price, model, discount, Timestamp.from(now), reason.strip(), createdBy);
        jdbc.update("""
                UPDATE platform.module_plans
                   SET price_inr = ?, price_model = ?, annual_discount_pct = ?, updated_at = now()
                 WHERE key = ?
                """, price, model, discount, planKey);

        String[] modules = moduleKeys(p.get("included_modules"));
        int cleared = jdbc.update("""
                DELETE FROM platform.razorpay_plans WHERE module_key = ? OR module_key = ANY (?)
                """, planKey, modules);

        PriceVersion current = jdbc.queryForObject("SELECT * FROM platform.module_plan_prices WHERE id = ?",
                this::mapPrice, newId);
        PriceVersion closed = previous == null ? null : jdbc.queryForObject(
                "SELECT * FROM platform.module_plan_prices WHERE id = ?", this::mapPrice, previous.id());
        return new PriceChange(plan(planKey), closed, current, cleared);
    }

    // ── mapping ─────────────────────────────────────────────────────────────

    private static String planSql(String where) {
        return """
                SELECT p.*, p.features::text AS features_json, p.limits::text AS limits_json,
                       v.id AS price_version_id, v.valid_from AS price_since
                  FROM platform.module_plans p
                  LEFT JOIN platform.module_plan_prices v
                         ON v.plan_key = p.key AND v.currency = 'INR' AND v.valid_to IS NULL
                """ + where;
    }

    private PlanRow mapPlan(ResultSet rs, int i) throws SQLException {
        return new PlanRow(rs.getString("key"), rs.getString("display_name"), rs.getString("tagline"),
                rs.getString("category"), rs.getString("status"), rs.getBigDecimal("price_inr"),
                rs.getString("price_model"), rs.getBigDecimal("annual_discount_pct"), rs.getBoolean("is_included"),
                Arrays.asList(moduleKeys(rs.getArray("included_modules"))), features(rs.getString("features_json")),
                limits(rs.getString("limits_json")), rs.getObject("price_version_id", UUID.class),
                instant(rs, "price_since"), rs.getInt("sort_order"));
    }

    private PriceVersion mapPrice(ResultSet rs, int i) throws SQLException {
        Instant validTo = instant(rs, "valid_to");
        return new PriceVersion(rs.getObject("id", UUID.class), rs.getString("plan_key"), rs.getString("currency"),
                rs.getBigDecimal("unit_price"), rs.getString("price_model"), rs.getBigDecimal("annual_discount_pct"),
                instant(rs, "valid_from"), validTo, rs.getString("reason"), rs.getString("created_by"),
                instant(rs, "created_at"), validTo == null);
    }

    private List<String> features(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        try {
            List<Object> items = json.readValue(raw, new TypeReference<List<Object>>() {});
            return items.stream().map(String::valueOf).toList();
        } catch (Exception e) {
            return List.of();
        }
    }

    private Map<String, Object> limits(String raw) {
        if (raw == null || raw.isBlank()) return Map.of();
        try {
            return json.readValue(raw, new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static String[] moduleKeys(Object sqlArray) {
        try {
            if (sqlArray instanceof java.sql.Array a) return (String[]) a.getArray();
            if (sqlArray instanceof String[] s) return s;
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
        return new String[0];
    }

    private static List<String> split(String csv) {
        return csv == null || csv.isBlank() ? List.of() : Arrays.asList(csv.split(","));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
