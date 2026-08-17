package com.hrms.api.users;

import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import com.unifiedtree.settings.branding.R2Storage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Canonical "who am I" endpoint.
 *
 * <p>The pre-existing {@code /v1/canonical-auth/me} returns just enough for
 * the SDK to know it is signed in — no full name, no avatar, no display
 * name. That worked when every page rendered "Hi, {email}", but for the
 * top-nav profile chip and the avatar upload flow we need one payload with
 * everything.
 *
 * <p>This endpoint deliberately does not touch {@code AuthService.currentUser()}
 * (a parallel workflow is editing that path). It reads what it needs from
 * {@code auth.user_credentials} + {@code hrms.employees} directly.
 *
 * <p>Full-name resolution follows the brief:
 * <pre>
 *   full_name = COALESCE(firstName + ' ' + lastName, firstName, email.local-part)
 * </pre>
 * Never falls back to email when firstName is present.
 */
@RestController
@RequestMapping("/v1/users")
public class UserProfileController {

    private static final Logger log = LoggerFactory.getLogger(UserProfileController.class);

    private static final String AVATAR_KEY_PREFIX = "user-avatars/";

    private final JdbcTemplate jdbc;
    private final R2Storage    storage;

    public UserProfileController(JdbcTemplate jdbc, R2Storage storage) {
        this.jdbc    = jdbc;
        this.storage = storage;
    }

    @GetMapping("/me")
    @PreAuthorize("isAuthenticated()")
    public UserMeResponse me() {
        UUID userId   = TenantContext.getUserId();
        UUID tenantId = TenantContext.getTenantId();
        if (userId == null || tenantId == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }

        Map<String, Object> u = firstRow("""
                SELECT email, employee_id, avatar_url
                  FROM auth.user_credentials
                 WHERE id = ? AND tenant_id = ?
                """, userId, tenantId);
        if (u == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }

        String email     = (String) u.get("email");
        String avatarUrl = resolveAvatarUrl((String) u.get("avatar_url"));
        UUID   employeeId = (UUID) u.get("employee_id");

        String firstName = null, lastName = null;
        if (employeeId != null) {
            Map<String, Object> e = firstRow(
                    "SELECT first_name, last_name FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                    employeeId, tenantId);
            if (e != null) {
                firstName = (String) e.get("first_name");
                lastName  = (String) e.get("last_name");
            }
        }

        String fullName    = buildFullName(firstName, lastName, email);
        String displayName = fullName; // deliberately identical — frontend need not concat

        return new UserMeResponse(
                userId, tenantId, email,
                blankToNull(firstName), blankToNull(lastName),
                fullName, displayName,
                employeeId, avatarUrl);
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /**
     * <pre>
     *   COALESCE(firstName + ' ' + lastName, firstName, email.local-part)
     * </pre>
     * <p>Explicitly NEVER returns the raw email — falls back to the
     * local-part only, so "sai@unifiedtree.com" renders as "sai", not the
     * full address (which the SPA already shows separately below the name).
     */
    static String buildFullName(String firstName, String lastName, String email) {
        String f = blankToNull(firstName);
        String l = blankToNull(lastName);
        if (f != null && l != null) return f + " " + l;
        if (f != null)              return f;
        if (email != null && !email.isBlank()) {
            int at = email.indexOf('@');
            return at > 0 ? email.substring(0, at) : email;
        }
        return "";
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    /**
     * The {@code avatar_url} column now stores the R2 object key rather
     * than a rendered URL (see {@link UserAvatarController} — the key
     * embeds a random UUID so listings can't be walked back to a user).
     * Turn the key into a fetchable URL via {@link R2Storage#urlFor} on
     * read. Legacy rows written before this migration hold a full
     * https URL — pass those through unchanged so existing avatars keep
     * rendering until the next re-upload naturally migrates them.
     */
    private String resolveAvatarUrl(String stored) {
        if (stored == null || stored.isBlank()) return null;
        String t = stored.trim();
        if (t.startsWith("http://") || t.startsWith("https://")) return t;
        if (!t.startsWith(AVATAR_KEY_PREFIX)) return t;
        if (!storage.isConfigured()) return null;
        try {
            return storage.urlFor(t);
        } catch (RuntimeException e) {
            log.warn("failed to render URL for avatar key {}: {}", t, e.getMessage());
            return null;
        }
    }

    private Map<String, Object> firstRow(String sql, Object... args) {
        List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ── response DTO ───────────────────────────────────────────────────────

    /**
     * Fields intentionally use snake_case aliases where the SPA already
     * expects them ({@code full_name}, {@code display_name}, {@code avatar_url})
     * so this endpoint drops in without a frontend field-map change.
     */
    public record UserMeResponse(
            UUID   userId,
            UUID   tenantId,
            String email,
            String firstName,
            String lastName,
            @com.fasterxml.jackson.annotation.JsonProperty("full_name")    String fullName,
            @com.fasterxml.jackson.annotation.JsonProperty("display_name") String displayName,
            UUID   employeeId,
            @com.fasterxml.jackson.annotation.JsonProperty("avatar_url")   String avatarUrl
    ) {}
}
