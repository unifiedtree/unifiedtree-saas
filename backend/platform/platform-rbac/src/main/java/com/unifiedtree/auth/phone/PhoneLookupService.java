package com.unifiedtree.auth.phone;

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
 * Cross-tenant "which workspace owns this phone number?" lookup.
 *
 * <p>Shared by both the Firebase phone-auth login path
 * ({@code /v1/auth/firebase-verify}, {@code /v1/auth/phone/check}) and the
 * MSG91 OTP login path ({@code /v1/auth/otp/verify}). Both flows are
 * anonymous at request time — the caller only proves possession of the
 * phone; we resolve the tenant from that phone on our side.
 *
 * <p>Both {@code hrms.employees} and {@code auth.user_credentials} are
 * RLS-isolated with FORCE ROW LEVEL SECURITY, so a single query cannot
 * read them across tenants. We enumerate the known tenants and, for each,
 * bind {@code app.tenant_id} transaction-locally with
 * {@code SELECT set_config('app.tenant_id', <uuid>, true)} then run the
 * phone lookup. Same pattern as {@code AuthService.resolveLoginTenant}.
 *
 * <p>Kept in its own {@code @Component} so the class-level
 * {@code @Transactional} proxy actually fires when a controller calls it —
 * a self-invoked {@code @Transactional} method would bypass the proxy and
 * every per-tenant {@code SET LOCAL} would silently target its own
 * auto-commit connection, hiding every employee row.
 *
 * <p>This class replaces
 * {@code com.unifiedtree.auth.firebase.FirebasePhoneLookupService} — the
 * lookup itself was never Firebase-specific. The old class is kept as a
 * thin {@code @Component} subclass exposing the legacy {@code Match} type
 * so pre-existing Firebase controller code compiles unchanged.
 */
@Component
public class PhoneLookupService {

    private static final Logger log = LoggerFactory.getLogger(PhoneLookupService.class);

    private final JdbcTemplate jdbc;

    public PhoneLookupService(JdbcTemplate jdbc) {
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
     * Find the employee whose phone matches the given number (E.164 or bare).
     *
     * <p>Storage format for {@code hrms.employees.phone} is unspecified
     * (users type it by hand with or without country code, spaces or
     * dashes), so the match compares the LAST 10 DIGITS of the stored value
     * with the last 10 digits of the caller-supplied number.
     *
     * <p>Returns {@code Optional.empty()} when no employee is found in any
     * tenant.
     */
    @Transactional
    public Optional<Match> findByPhone(String phone) {
        if (phone == null || phone.isBlank()) return Optional.empty();

        String digits = phone.replaceAll("\\D", "");
        if (digits.length() < 10) {
            log.debug("phone lookup: caller number '{}' has fewer than 10 digits — no match possible",
                    phone);
            return Optional.empty();
        }
        final String last10 = digits.substring(digits.length() - 10);

        List<UUID> tenantIds;
        try {
            tenantIds = jdbc.queryForList(
                    "SELECT id FROM platform.tenants WHERE status = 'ACTIVE'", UUID.class);
        } catch (Exception e) {
            try {
                tenantIds = jdbc.queryForList("SELECT id FROM platform.tenants", UUID.class);
            } catch (Exception e2) {
                log.warn("phone lookup: could not enumerate tenants", e2);
                return Optional.empty();
            }
        }

        for (UUID t : tenantIds) {
            try {
                jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)",
                        String.class, t.toString());

                List<Map<String, Object>> emp = jdbc.queryForList(
                        "SELECT id, email FROM hrms.employees "
                                + "WHERE right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ? "
                                + "  AND (employment_status IS NULL OR employment_status = 'ACTIVE') "
                                + "LIMIT 1",
                        last10);
                if (emp.isEmpty()) continue;

                UUID employeeId = (UUID) emp.get(0).get("id");
                String email = (String) emp.get(0).get("email");

                List<UUID> userIds = jdbc.queryForList(
                        "SELECT id FROM auth.user_credentials "
                                + "WHERE employee_id = ? AND is_active = true LIMIT 1",
                        UUID.class, employeeId);
                if (userIds.isEmpty()) {
                    log.debug("phone lookup: employee {} in tenant {} has no active user_credentials",
                            employeeId, t);
                    continue;
                }
                return Optional.of(new Match(t, userIds.get(0), employeeId, email));
            } catch (Exception ignored) {
                // Unreadable tenant (schema drift, permission oddity) — skip.
            }
        }
        return Optional.empty();
    }
}
