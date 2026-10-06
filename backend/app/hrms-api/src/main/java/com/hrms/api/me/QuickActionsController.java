package com.hrms.api.me;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Quick-action customisation (audit G-59, contract BW-112; V143_97 hrms.user_dashboard_prefs): which quick actions
 * the signed-in person picked for the Dashboard or Home, in order, so the website and the phone app show the same.
 *
 * <p>Self-service only: the account comes from the session, never from the request ({@code isAuthenticated()}, as
 * for {@code /v1/me/notification-preferences}). No row means the default tiles; {@code PUT {picked: null}} goes
 * back to them ("Reset to default"). The server keeps the keys only; which tiles exist and which a person may use
 * stays with each client (a picked tile the person can no longer open is simply not shown).
 *
 * <p>Served at {@code /v1/me/quick-actions} (for the app) and {@code /v1/me/dashboard/quick-actions} (the web's
 * BW-112 hook). While the table is missing GET answers {@code available: false} and PUT FEATURE_NOT_READY.
 * Usage counts ("most used first") are not recorded yet: {@code uses} is always empty.
 */
@RestController
@SecurityRequirement(name = "bearerAuth")
public class QuickActionsController {

    public static final int MAX_PICKED = 6;
    static final Set<String> SURFACES = Set.of("dashboard", "home");
    /** A tile key: lower case letters, digits and dashes (so the list can be joined with commas). */
    static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9-]{0,39}$");
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;

    public QuickActionsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The web's QuickActionPrefs. {@code picked} null = the default tiles. */
    public record QuickActionPrefs(boolean available, List<String> picked, String month, Map<String, Integer> uses) {}

    /** {@code picked} null = back to the default tiles. */
    public record SaveRequest(List<String> picked) {}

    @Operation(summary = "My quick actions for the Dashboard or Home (null = the default tiles)")
    @GetMapping({"/v1/me/quick-actions", "/v1/me/dashboard/quick-actions"})
    @PreAuthorize("isAuthenticated()")
    @Transactional(readOnly = true)
    public QuickActionPrefs get(@RequestParam(defaultValue = "dashboard") String surface) {
        String s = surface(surface);
        UUID[] ids = session();
        bindTenant(ids[0]);
        if (!tableReady()) return new QuickActionPrefs(false, null, month(), Map.of());
        List<String> rows;
        try {
            rows = jdbc.queryForList("""
                    SELECT array_to_string(quick_actions, ',') FROM hrms.user_dashboard_prefs
                     WHERE tenant_id = ? AND user_id = ? AND surface = ?
                    """, String.class, ids[0], ids[1], s);
        } catch (DataAccessException e) {
            if (FeatureNotReady.isMissingSchema(e)) return new QuickActionPrefs(false, null, month(), Map.of());
            throw e;
        }
        return new QuickActionPrefs(true, rows.isEmpty() ? null : split(rows.get(0)), month(), Map.of());
    }

    @Operation(summary = "Save my quick actions (up to 6, in order), or {picked: null} for the default tiles")
    @PutMapping({"/v1/me/quick-actions", "/v1/me/dashboard/quick-actions"})
    @PreAuthorize("isAuthenticated()")
    @Transactional
    public QuickActionPrefs save(@RequestParam(defaultValue = "dashboard") String surface,
                                 @RequestBody(required = false) SaveRequest body) {
        String s = surface(surface);
        UUID[] ids = session();
        List<String> picked = validate(body == null ? null : body.picked());
        bindTenant(ids[0]);
        if (!tableReady()) throw new FeatureNotReady();
        FeatureNotReady.run(() -> {
            if (picked == null) {
                jdbc.update("DELETE FROM hrms.user_dashboard_prefs WHERE tenant_id = ? AND user_id = ? AND surface = ?",
                        ids[0], ids[1], s);
            } else {
                jdbc.update("""
                        INSERT INTO hrms.user_dashboard_prefs (tenant_id, user_id, surface, quick_actions, updated_at)
                        VALUES (?, ?, ?, string_to_array(?, ','), now())
                        ON CONFLICT (tenant_id, user_id, surface)
                        DO UPDATE SET quick_actions = EXCLUDED.quick_actions, updated_at = now()
                        """, ids[0], ids[1], s, String.join(",", picked));
            }
        });
        return new QuickActionPrefs(true, picked, month(), Map.of());
    }

    /** null stays null (the default tiles); otherwise 1 to 6 unique, well-formed keys, in the order given. */
    static List<String> validate(List<String> picked) {
        if (picked == null) return null;
        if (picked.isEmpty()) {
            throw invalid("Pick at least one quick action, or reset to the default ones.");
        }
        Set<String> seen = new LinkedHashSet<>();
        for (String k : picked) {
            if (k == null || !KEY.matcher(k).matches()) throw invalid("That isn’t a quick action we know.");
            if (!seen.add(k)) throw invalid("Each quick action can be picked once.");
        }
        if (seen.size() > MAX_PICKED) throw invalid("Pick at most " + MAX_PICKED + " quick actions.");
        return new ArrayList<>(seen);
    }

    static String surface(String surface) {
        String s = surface == null ? "dashboard" : surface.trim().toLowerCase(Locale.ROOT);
        if (!SURFACES.contains(s)) {
            throw new HrmsException("Choose dashboard or home.", HttpStatus.BAD_REQUEST, "QUICK_ACTIONS_SURFACE_INVALID");
        }
        return s;
    }

    /**
     * The table's row-level security reads app.tenant_id, which lives only for the transaction (SET LOCAL): set it
     * here, inside this handler's transaction, as every other JDBC handler does (UserProfileController.bindTenant).
     */
    private void bindTenant(UUID tenantId) {
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
    }

    private boolean tableReady() {
        Boolean ready = jdbc.queryForObject("SELECT to_regclass('hrms.user_dashboard_prefs') IS NOT NULL", Boolean.class);
        return Boolean.TRUE.equals(ready);
    }

    private static String month() {
        return LocalDate.now(IST).toString().substring(0, 7);
    }

    private static UUID[] session() {
        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();
        if (tenantId == null || userId == null) {
            throw new HrmsException("Sign in again to change your quick actions.", HttpStatus.UNAUTHORIZED, "NOT_AUTHENTICATED");
        }
        return new UUID[]{tenantId, userId};
    }

    private static HrmsException invalid(String message) {
        return new HrmsException(message, HttpStatus.UNPROCESSABLE_ENTITY, "QUICK_ACTIONS_INVALID");
    }

    /** The stored keys (joined with commas by the query), in order; null when there are none. */
    static List<String> split(String joined) {
        return joined == null || joined.isBlank() ? null : List.of(joined.split(","));
    }
}
