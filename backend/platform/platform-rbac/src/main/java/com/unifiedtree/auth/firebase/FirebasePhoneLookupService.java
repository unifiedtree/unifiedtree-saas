package com.unifiedtree.auth.firebase;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Cross-tenant "which workspace owns this phone number?" lookup used by the
 * Firebase phone-auth login path.
 *
 * <p>Both {@code hrms.employees} and {@code auth.user_credentials} are RLS-
 * isolated with FORCE ROW LEVEL SECURITY, so a single query cannot read them
 * across tenants. Instead we iterate the known tenants and, for each, bind
 * {@code app.tenant_id} transaction-locally with
 * {@code SELECT set_config('app.tenant_id', <uuid>, true)} then run the phone
 * lookup. Same pattern as {@code AuthService.resolveLoginTenant}.
 *
 * <p>Kept in its own {@code @Component} so the class-level {@code @Transactional}
 * proxy actually fires when {@code FirebaseAuthController} calls it — a self-
 * invoked {@code @Transactional} method would bypass the proxy and every
 * per-tenant {@code SET LOCAL} would silently target its own auto-commit
 * connection, hiding every employee row.
 */
@Component
public class FirebasePhoneLookupService {

    private static final Logger log = LoggerFactory.getLogger(FirebasePhoneLookupService.class);

    private final JdbcTemplate jdbc;

    public FirebasePhoneLookupService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Result of a successful phone→employee resolution.
     *
     * @param tenantId  workspace the employee belongs to
     * @param authUserId {@code auth.user_credentials.id} — the id required by
     *                   {@code AuthService.issueWorkspaceSession}
     * @param employeeId {@code hrms.employees.id}
     * @param email      work email, echoed to the caller for UX
     */
    public record Match(UUID tenantId, UUID authUserId, UUID employeeId, String email) { }

    /**
     * Find the employee whose phone matches the given E.164 number.
     *
     * <p>Storage format for {@code hrms.employees.phone} is unspecified (users
     * type it by hand — with or without country code, with or without spaces
     * and dashes), so the match compares the LAST 10 DIGITS of the stored
     * value with the last 10 digits of the caller-supplied number. That covers
     * every Indian mobile whether the row was entered as {@code 9876543210},
     * {@code +91 98765 43210}, {@code 91-9876543210} or the bare E.164
     * {@code +919876543210}.
     *
     * <p>Returns {@code Optional.empty()} when no employee is found in any
     * tenant — the controller surfaces that as {@code PHONE_NOT_REGISTERED}.
     * When multiple tenants have a matching employee (rare — same person in
     * two workspaces) the first hit wins; the phone-auth flow is a
     * best-effort convenience login, not a multi-workspace selector.
     */
    @Transactional
    public Optional<Match> findByPhone(String e164Phone) {
        if (e164Phone == null || e164Phone.isBlank()) return Optional.empty();

        // Keep only digits and take the last 10 — everything the Indian
        // client base uses fits in the last-10 space, and this is what the
        // per-row expression compares against.
        String digits = e164Phone.replaceAll("\\D", "");
        if (digits.length() < 10) {
            log.debug("firebase phone-auth: caller number '{}' has fewer than 10 digits — no match possible",
                    e164Phone);
            return Optional.empty();
        }
        final String last10 = digits.substring(digits.length() - 10);

        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList(
                    "SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            // status column may be absent on very old schemas — same guard
            // resolveLoginTenant uses.
            try {
                tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class);
            } catch (Exception e2) {
                log.warn("firebase phone-auth: could not enumerate tenants", e2);
                return Optional.empty();
            }
        }

        for (UUID t : tenantIds) {
            try {
                jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)",
                        String.class, t.toString());

                // Find the employee whose stripped phone ends in the same 10
                // digits as the caller. LIMIT 1 — duplicates within a single
                // tenant are a data-entry mistake, not a login concern.
                List<Map<String, Object>> emp = jdbc.queryForList(
                        "SELECT id, email FROM hrms.employees "
                                + "WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ? "
                                + "  AND (employment_status IS NULL OR employment_status = 'ACTIVE') "
                                + "LIMIT 1",
                        last10);
                if (emp.isEmpty()) continue;

                UUID employeeId = (UUID) emp.get(0).get("id");
                String email = (String) emp.get(0).get("email");

                // Now find the auth.user_credentials row for this employee.
                // Without an active credentials row the phone-auth login has
                // no user id to issue a session for, so treat as no-match and
                // keep scanning (the client may exist in another tenant that
                // does have credentials).
                List<UUID> userIds = jdbc.queryForList(
                        "SELECT id FROM auth.user_credentials "
                                + "WHERE employee_id = ? AND is_active = true LIMIT 1",
                        UUID.class, employeeId);
                if (userIds.isEmpty()) {
                    log.debug("firebase phone-auth: employee {} in tenant {} has no active user_credentials",
                            employeeId, t);
                    continue;
                }
                return Optional.of(new Match(t, userIds.get(0), employeeId, email));
            } catch (Exception ignored) {
                // Unreadable tenant (schema drift, permission oddity) — skip
                // and keep scanning rather than 500ing the login.
            }
        }
        return Optional.empty();
    }
}
