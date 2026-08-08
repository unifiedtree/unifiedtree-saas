package com.unifiedtree.saas.plans;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Reads the sellable {@code platform.module_plans} catalog (the 9 merged
 * website products) and answers the two questions the paywall needs:
 *   - what does a set of plan keys cost?  (computed SERVER-SIDE, never trusted
 *     from the client)
 *   - which functional module_catalog keys does a purchase unlock?
 */
@Service
public class ModulePlanService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public ModulePlanService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private final RowMapper<ModulePlanDto> ROW = (rs, n) -> {
        List<String> features = new ArrayList<>();
        try {
            String json = rs.getString("features");
            if (json != null && !json.isBlank()) {
                features = mapper.readValue(json, mapper.getTypeFactory()
                        .constructCollectionType(List.class, String.class));
            }
        } catch (Exception ignored) { /* malformed features never break the page */ }

        java.sql.Array inc = rs.getArray("included_modules");
        List<String> included = inc != null ? List.of((String[]) inc.getArray()) : List.of();

        return new ModulePlanDto(
                rs.getString("key"),
                rs.getString("display_name"),
                rs.getString("tagline"),
                rs.getString("description"),
                rs.getString("category"),
                rs.getString("icon"),
                rs.getString("color"),
                rs.getBigDecimal("price_inr"),
                rs.getString("price_model"),
                rs.getString("status"),
                rs.getInt("sort_order"),
                features,
                included,
                rs.getBigDecimal("annual_discount_pct"),
                rs.getBoolean("is_included"));
    };

    /** All plans, ordered for the pricing grid. */
    public List<ModulePlanDto> listPlans() {
        return jdbc.query("""
                SELECT key, display_name, tagline, description, category, icon, color,
                       price_inr, price_model, status, sort_order, features, included_modules,
                       annual_discount_pct, is_included
                  FROM platform.module_plans
                 ORDER BY sort_order, display_name
                """, ROW);
    }

    /**
     * Validate that every requested plan key exists AND is AVAILABLE (you cannot
     * pay for a LAUNCHING_SOON plan), returning the matched rows. Throws 400 on
     * any unknown or not-yet-available key.
     */
    public List<ModulePlanDto> requireAvailable(List<String> planKeys) {
        List<String> keys = normalize(planKeys);
        if (keys.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one plan");
        }
        List<ModulePlanDto> all = listPlans();
        List<ModulePlanDto> matched = new ArrayList<>();
        for (String k : keys) {
            ModulePlanDto plan = all.stream().filter(p -> p.key().equals(k)).findFirst().orElse(null);
            if (plan == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown plan: " + k);
            }
            if (!"AVAILABLE".equalsIgnoreCase(plan.status())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Plan '" + plan.displayName() + "' is launching soon and cannot be purchased yet");
            }
            matched.add(plan);
        }
        return matched;
    }

    /**
     * A plan's effective per-MONTH unit price for a billing cycle. Monthly is
     * the catalog price; annual applies the plan's {@code annual_discount_pct}
     * (DB-driven, not hardcoded) and rounds to the whole rupee — e.g. 39 at 10%
     * becomes 35/user/month. The 12x is applied by the total, not here.
     *
     * <p>SAFETY GUARANTEE: modules flagged {@code is_included = true} always
     * price at ₹0 regardless of what {@code price_inr} the row carries. Those
     * are the baseline bundle the marketing site labels "Included in every
     * plan" (HR / Attendance / Payroll today); charging for one of them —
     * even if the frontend accidentally sends it in the paid checkout —
     * would be a billing bug that undermines the promise on the pricing
     * page. This is the enforcement point; do not trust the client.
     */
    public BigDecimal effectiveMonthlyUnit(ModulePlanDto p, BillingCycle cycle) {
        if (p.included()) return BigDecimal.ZERO;
        BigDecimal unit = p.priceInr() == null ? BigDecimal.ZERO : p.priceInr();
        if (cycle == BillingCycle.ANNUAL) {
            BigDecimal pct = p.annualDiscountPct() == null ? BigDecimal.ZERO : p.annualDiscountPct();
            BigDecimal factor = BigDecimal.ONE.subtract(pct.movePointLeft(2)); // 1 - pct/100
            unit = unit.multiply(factor).setScale(0, RoundingMode.HALF_UP);
        }
        return unit;
    }

    /** Effective per-user/month rate across the given plans (for the ledger). */
    public BigDecimal unitPriceInr(List<ModulePlanDto> plans, BillingCycle cycle) {
        BigDecimal sum = BigDecimal.ZERO;
        for (ModulePlanDto p : plans) sum = sum.add(effectiveMonthlyUnit(p, cycle));
        return sum;
    }

    /**
     * Total rupees charged for the given AVAILABLE plans, seat count and billing
     * cycle (server-authoritative). PER_SEAT plans bill unit * seats; FLAT plans
     * bill the unit once; the whole line is multiplied by the months in the
     * cycle (1 monthly, 12 annual). Seats are clamped to at least 1.
     */
    public BigDecimal totalPriceInr(List<ModulePlanDto> plans, int seats, BillingCycle cycle) {
        BillingCycle c = cycle == null ? BillingCycle.MONTHLY : cycle;
        int s = Math.max(1, seats);
        BigDecimal months = BigDecimal.valueOf(c.months());
        BigDecimal total = BigDecimal.ZERO;
        for (ModulePlanDto p : plans) {
            BigDecimal unit = effectiveMonthlyUnit(p, c);
            BigDecimal line = "FLAT".equalsIgnoreCase(p.priceModel())
                    ? unit
                    : unit.multiply(BigDecimal.valueOf(s));
            total = total.add(line.multiply(months));
        }
        return total;
    }

    /** Backwards-compatible monthly total. */
    public BigDecimal totalPriceInr(List<ModulePlanDto> plans, int seats) {
        return totalPriceInr(plans, seats, BillingCycle.MONTHLY);
    }

    /** Union of functional module_catalog keys unlocked by the given plans. */
    public List<String> expandModules(List<ModulePlanDto> plans) {
        Set<String> mods = new LinkedHashSet<>();
        for (ModulePlanDto p : plans) mods.addAll(p.includedModules());
        return new ArrayList<>(mods);
    }

    /**
     * Look up one plan by key WITHOUT the AVAILABLE check.
     *
     * <p>Counterpart to {@link #requireAvailable} for paths acting on a
     * subscription the customer has ALREADY paid for — activation from a
     * completed mandate, and seat changes on a live subscription. Those must
     * not fail because the catalog row was later flipped to LAUNCHING_SOON or
     * retired: the money has changed hands, and refusing to expand the
     * customer's modules (or to let them adjust seats) over a catalog edit
     * punishes them for an internal pricing decision. Purchase paths keep
     * using {@link #requireAvailable} — you still cannot BUY a retired plan.
     *
     * @return the plan, or empty if the key is unknown entirely (renamed or
     *         deleted), which callers must treat as unrecoverable
     */
    public Optional<ModulePlanDto> findLenient(String planKey) {
        if (planKey == null || planKey.isBlank()) return Optional.empty();
        String k = planKey.trim().toLowerCase(Locale.ROOT);
        return listPlans().stream().filter(p -> p.key().equalsIgnoreCase(k)).findFirst();
    }

    /**
     * Same as {@link #expandModules} but from raw plan keys and WITHOUT the
     * AVAILABLE check — used when activating a subscription from an already-paid
     * order, where a plan going launching-soon later must not break activation.
     */
    public List<String> expandModulesLenient(List<String> planKeys) {
        List<ModulePlanDto> all = listPlans();
        Set<String> mods = new LinkedHashSet<>();
        if (planKeys != null) {
            for (String k : planKeys) {
                if (k == null) continue;
                all.stream().filter(p -> p.key().equalsIgnoreCase(k.trim())).findFirst()
                        .ifPresent(p -> mods.addAll(p.includedModules()));
            }
        }
        return new ArrayList<>(mods);
    }

    private static List<String> normalize(List<String> keys) {
        if (keys == null) return List.of();
        return keys.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(s -> s.trim().toLowerCase(Locale.ROOT))
                .distinct()
                .toList();
    }
}
