package com.hrms.api.users;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.BusinessRuleException;
import com.unifiedtree.security.tenant.TenantContext;
import com.unifiedtree.settings.branding.R2Storage;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Canonical "who am I" endpoint.
 *
 * <p>The pre-existing {@code /v1/canonical-auth/me} returns just enough for
 * the SDK to know it is signed in — no full name, no avatar, no display
 * name. That worked when every page rendered "Hi, {email}", but for the
 * top-nav profile chip, the avatar upload flow and the Profile page we need
 * one payload with everything.
 *
 * <p>This endpoint deliberately does not touch {@code AuthService.currentUser()}
 * (a parallel workflow is editing that path). It reads what it needs from
 * {@code auth.user_credentials} + {@code hrms.employees} directly.
 *
 * <p><strong>Contract note (2026-09-08 audit fix):</strong> the response used
 * to serialise as {@code userId / display_name / avatar_url}, but every SPA
 * consumer reads {@code id / displayName / avatarUrl}. The mismatch made the
 * Profile page unusable — the seeding {@code useEffect} keyed on
 * {@code user?.id} never fired, the avatar reverted to initials after every
 * upload, and there was no PUT handler at all so Save was a 404. The response
 * now uses camelCase throughout and this class exposes a {@code PUT /me}
 * that persists {@code displayName}, {@code phone} (via {@code mobile_number})
 * and {@code notificationPreferences} (V114 JSONB column).
 */
@RestController
@RequestMapping("/v1/users")
public class UserProfileController {

    private static final Logger log = LoggerFactory.getLogger(UserProfileController.class);

    private static final String AVATAR_KEY_PREFIX = "user-avatars/";

    private final JdbcTemplate jdbc;
    private final R2Storage    storage;
    private final ObjectMapper mapper;

    public UserProfileController(JdbcTemplate jdbc, R2Storage storage, ObjectMapper mapper) {
        this.jdbc    = jdbc;
        this.storage = storage;
        this.mapper  = mapper;
    }

    /**
     * Bind the tenant for RLS. Mirrors the bindTenant() every service in this
     * codebase defines: the two TenantContexts plus the Postgres GUC the RLS
     * policies read. SET LOCAL only survives inside a transaction, so callers
     * must be @Transactional.
     */
    private void bindTenant(UUID tenantId) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(tenantId);
        com.hrms.core.tenant.TenantContext.setTenantId(tenantId);
        jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
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
                SELECT email,
                       mobile_number,
                       employee_id,
                       avatar_url,
                       display_name,
                       notification_preferences
                  FROM auth.user_credentials
                 WHERE id = ? AND tenant_id = ?
                """, userId, tenantId);
        if (u == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }

        String email        = (String) u.get("email");
        String phone        = (String) u.get("mobile_number");
        String avatarUrl    = resolveAvatarUrl((String) u.get("avatar_url"));
        String displayOverride = (String) u.get("display_name");
        UUID   employeeId   = (UUID)   u.get("employee_id");
        Map<String, Object> prefs = parsePrefs(u.get("notification_preferences"));

        String firstName = null, lastName = null, companyName = null;
        UUID companyId = null;
        if (employeeId != null) {
            // 2026-09-10: company_id added to this lookup. GET /v1/hrms/companies
            // requires org.company.read, which a plain EMPLOYEE does not hold, so
            // the SPA had no way to learn the caller's own company — and every
            // ESS surface that needs a companyId query param silently broke.
            // Worst case: the Leave apply form could not load leave types
            // (/v1/leave/types?companyId=... is isAuthenticated() and works
            // fine, the SPA just never had an id to pass), so an employee could
            // not request leave at all from the web.
            Map<String, Object> e = firstRow(
                    "SELECT first_name, last_name, company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                    employeeId, tenantId);
            if (e != null) {
                firstName = (String) e.get("first_name");
                lastName  = (String) e.get("last_name");
                companyId = (UUID)   e.get("company_id");
            }
        }

        // The company NAME is a nice-to-have: it lets the SPA label a one-entry
        // company selector. It is deliberately a SEPARATE, swallowed query
        // rather than a join on the employee lookup above — a first attempt
        // joined it in, got the schema wrong (org.companies, not hrms.*), and
        // 500'd /users/me, which the SPA calls on every single page. Nothing
        // cosmetic is worth putting that endpoint at risk, so a failure here
        // costs a label and nothing else.
        if (companyId != null) {
            try {
                Map<String, Object> c = firstRow(
                        "SELECT name FROM org.companies WHERE id = ? AND tenant_id = ?",
                        companyId, tenantId);
                if (c != null) companyName = (String) c.get("name");
            } catch (Exception ex) {
                log.warn("company-name lookup failed for company {}: {}", companyId, ex.getMessage());
            }
        }

        String fullName    = buildFullName(firstName, lastName, email);
        // The per-user display-name override wins when set (Profile page);
        // otherwise fall back to full-name-from-parts so the sidebar chip
        // still reads correctly for accounts that never opened Profile.
        String displayName = (displayOverride != null && !displayOverride.isBlank())
                ? displayOverride.trim()
                : fullName;

        return new UserMeResponse(
                userId, tenantId, email,
                blankToNull(firstName), blankToNull(lastName),
                fullName, displayName,
                employeeId, companyId, blankToNull(companyName), avatarUrl,
                blankToNull(phone),
                prefs);
    }

    /**
     * Update the signed-in user's profile — displayName override, phone,
     * and notification preferences. Partial: unset fields are ignored, so
     * the SPA's diff-and-PATCH pattern (only send what changed) works
     * without wiping other fields.
     *
     * <p>All three keys map to columns on {@code auth.user_credentials}
     * (mobile_number for phone; V114 added display_name + notification_
     * preferences). Nothing here touches the HR employees row — that is
     * still edited through the HR employee-edit surface.
     */
    @PutMapping("/me")
    @PreAuthorize("isAuthenticated()")
    // 2026-09-09: was neither transactional nor tenant-bound, and silently
    // persisted NOTHING while returning 200 with the unchanged row — verified
    // against prod: PUT {displayName} returned 200 and display_name stayed
    // NULL. auth.user_credentials carries an RLS policy
    // (tenant_id = current_tenant_id()) that applies to UPDATE as well as
    // SELECT. app.tenant_id is set with SET LOCAL, which lives only for the
    // duration of a transaction — with no transaction around this handler the
    // GUC was gone by the time the UPDATE ran, current_tenant_id() was NULL,
    // the predicate matched no rows, and the write vanished.
    //
    // Every other JDBC write in this codebase (LearningService, InvitationService,
    // DisbursementBatchService ...) is @Transactional and calls a bindTenant()
    // that does exactly the three lines below. This handler was the odd one out.
    @org.springframework.transaction.annotation.Transactional
    public UserMeResponse update(@RequestBody UpdateMeRequest req) {
        UUID userId   = TenantContext.getUserId();
        UUID tenantId = TenantContext.getTenantId();
        if (userId == null || tenantId == null) {
            throw new BusinessRuleException("No active session", "NOT_AUTHENTICATED");
        }
        bindTenant(tenantId);

        // Build a partial UPDATE — no clause when nothing to change, one clause
        // per supplied field so a caller who sends only { phone } doesn't wipe
        // notification_preferences.
        StringBuilder sql = new StringBuilder("UPDATE auth.user_credentials SET updated_at = now()");
        java.util.List<Object> args = new java.util.ArrayList<>();

        if (req.displayName() != null) {
            sql.append(", display_name = ?");
            args.add(req.displayName().isBlank() ? null : req.displayName().trim());
        }
        if (req.phone() != null) {
            String phone = req.phone().trim();
            sql.append(", mobile_number = ?");
            args.add(phone.isEmpty() ? null : phone);
        }
        if (req.notificationPreferences() != null) {
            // Cast to jsonb so Postgres stores it structured, not as a string.
            sql.append(", notification_preferences = CAST(? AS jsonb)");
            try {
                args.add(mapper.writeValueAsString(req.notificationPreferences()));
            } catch (Exception e) {
                throw new BusinessRuleException("Invalid notification preferences", "INVALID_PREFS");
            }
        }

        if (!args.isEmpty()) {
            sql.append(" WHERE id = ? AND tenant_id = ?");
            args.add(userId);
            args.add(tenantId);
            int updated = jdbc.update(sql.toString(), args.toArray());
            if (updated == 0) {
                // Reaching here means the row is invisible to this session —
                // almost always RLS, not a bad id. Log it: the previous
                // version of this handler failed silently and the Profile page
                // reported success for a year's worth of saves that never
                // happened.
                log.warn("PUT /v1/users/me updated 0 rows for user={} tenant={}", userId, tenantId);
                throw new BusinessRuleException("Could not save your profile", "PROFILE_UPDATE_FAILED");
            }
            log.info("Profile updated user={} fields={}", userId, args.size() - 2);
        }
        // Echo the fresh row — matches what useUpdateCurrentUser expects.
        return me();
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

    /** Postgres JSONB round-trips as either a String or the driver's PGobject. */
    private Map<String, Object> parsePrefs(Object v) {
        if (v == null) return null;
        String s = v.toString();
        if (s.isBlank() || "null".equals(s)) return null;
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = mapper.readValue(s, Map.class);
            return m;
        } catch (Exception e) {
            log.warn("bad notification_preferences JSON in DB: {}", s);
            return null;
        }
    }

    private Map<String, Object> firstRow(String sql, Object... args) {
        List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ── request / response DTOs ────────────────────────────────────────────

    /**
     * Response contract is CAMEL-CASE (no @JsonProperty snake_case aliases).
     * Fixes the historical mismatch that made every SPA consumer read
     * undefined for id/displayName/avatarUrl.
     */
    public record UserMeResponse(
            UUID    id,
            UUID    tenantId,
            String  email,
            String  firstName,
            String  lastName,
            String  fullName,
            String  displayName,
            UUID    employeeId,
            /** The caller's own company — see me(). Lets ESS screens pass a
             *  companyId without needing org.company.read. Null for a
             *  principal with no employee record (platform admins). */
            UUID    companyId,
            /** Display name of {@link #companyId}, so the SPA can render a
             *  one-entry company selector without the admin-only list call. */
            String  companyName,
            String  avatarUrl,
            String  phone,
            Map<String, Object> notificationPreferences
    ) {}

    /**
     * PUT body. All fields optional (patch semantics). {@code null} means
     * "don't change"; empty string means "clear". Callers only send what
     * they touched.
     */
    public record UpdateMeRequest(
            @Size(max = 150) String displayName,
            @Size(max = 20)  String phone,
            Map<String, Object> notificationPreferences
    ) {}
}
