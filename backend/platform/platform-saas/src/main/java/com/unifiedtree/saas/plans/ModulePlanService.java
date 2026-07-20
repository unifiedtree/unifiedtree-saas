package com.unifiedtree.saas.plans;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
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
                included);
    };

    /** All plans, ordered for the pricing grid. */
    public List<ModulePlanDto> listPlans() {
        return jdbc.query("""
                SELECT key, display_name, tagline, description, category, icon, color,
                       price_inr, price_model, status, sort_order, features, included_modules
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
     * Total price in rupees for the given AVAILABLE plans and seat count
     * (server-authoritative). PER_SEAT plans bill price * seats; FLAT plans bill
     * price once. Seats are clamped to at least 1.
     */
    public BigDecimal totalPriceInr(List<ModulePlanDto> plans, int seats) {
        int s = Math.max(1, seats);
        BigDecimal total = BigDecimal.ZERO;
        for (ModulePlanDto p : plans) {
            BigDecimal unit = p.priceInr() == null ? BigDecimal.ZERO : p.priceInr();
            BigDecimal line = "FLAT".equalsIgnoreCase(p.priceModel())
                    ? unit
                    : unit.multiply(BigDecimal.valueOf(s));
            total = total.add(line);
        }
        return total;
    }

    /** Union of functional module_catalog keys unlocked by the given plans. */
    public List<String> expandModules(List<ModulePlanDto> plans) {
        Set<String> mods = new LinkedHashSet<>();
        for (ModulePlanDto p : plans) mods.addAll(p.includedModules());
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
