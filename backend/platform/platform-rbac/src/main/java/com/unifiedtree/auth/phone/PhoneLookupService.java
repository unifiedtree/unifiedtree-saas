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
    /**
     * The same match, but only inside one business (the web's business login page, contract §5b
     * with the HRMS lane): a number that is also on file in another business never signs the person
     * in there. {@code tenantId == null} = today's lookup across businesses (the mobile app).
     */
    @Transactional
    public Optional<Match> findByPhone(String phone, UUID tenantId) {
        if (tenantId == null) return findByPhone(phone);
        String last10 = last10(phone);
        return last10 == null ? Optional.empty() : matchInTenant(tenantId, last10, true);
    }

    /**
     * The number is on more than one login in the named business (review 7 Oct: in production 3 numbers
     * sit on 10 logins, admins and non-admins mixed), so a code sent to it can't say WHICH login to sign
     * in: nobody is signed in by it; they use their email.
     */
    public static class SeveralLogins extends RuntimeException {
        public SeveralLogins() { super("This mobile number is on more than one login here"); }
    }

    /** Sentinel for "a business was named but doesn't exist": matches nothing. */
    static final UUID NO_SUCH_BUSINESS = new UUID(0L, 0L);

    /** An active business by its subdomain; {@link #NO_SUCH_BUSINESS} when there is none. */
    public UUID businessBySubdomain(String subdomain) {
        List<UUID> ids = jdbc.queryForList(
                "SELECT id FROM platform.tenants WHERE lower(subdomain) = lower(?) AND status = 'ACTIVE'",
                UUID.class, subdomain);
        return ids.isEmpty() ? NO_SUCH_BUSINESS : ids.get(0);
    }

    private static String last10(String phone) {
        if (phone == null || phone.isBlank()) return null;
        String digits = phone.replaceAll("\\D", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

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

        if (Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT to_regprocedure('auth.phone_login_match(text)') IS NOT NULL", Boolean.class))) {
            // One indexed lookup (V143.2) instead of scanning every workspace's employees.
            List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM auth.phone_login_match(?)", last10);
            if (rows.isEmpty()) return Optional.empty();
            Map<String, Object> r = rows.get(0);
            return Optional.of(new Match((UUID) r.get("tenant_id"), (UUID) r.get("user_id"),
                    (UUID) r.get("employee_id"), (String) r.get("email")));
        }

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
            Optional<Match> m = matchInTenant(t, last10, false);
            if (m.isPresent()) return m;
        }
        return Optional.empty();
    }

    /**
     * One business: its active employee with this number and an active login (RLS: tenant bound first).
     * {@code strict} (a business named, the web): an inactive employee never matches, and a number on
     * more than one login throws {@link SeveralLogins} instead of picking one. The app's lookup across
     * businesses ({@code strict} false) is unchanged.
     */
    private Optional<Match> matchInTenant(UUID t, String last10, boolean strict) {
        try {
            jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, t.toString());
            List<Map<String, Object>> emp = jdbc.queryForList(
                    "SELECT e.id, e.email FROM hrms.employees e "
                            + "WHERE right(regexp_replace(coalesce(e.phone, ''), '\\D', '', 'g'), 10) = ? "
                            + "  AND e.tenant_id = ? "
                            + "  AND (e.employment_status IS NULL OR e.employment_status IN ('ACTIVE','PROBATION','NOTICE_PERIOD')) "
                            + (strict
                                ? "  AND e.is_active = TRUE AND EXISTS (SELECT 1 FROM auth.user_credentials uc "
                                  + "WHERE uc.employee_id = e.id AND uc.tenant_id = e.tenant_id AND uc.is_active = TRUE) "
                                  + "LIMIT 2"
                                : "LIMIT 1"),
                    last10, t);
            if (emp.isEmpty()) return Optional.empty();
            if (strict && emp.size() > 1) throw new SeveralLogins();
            UUID employeeId = (UUID) emp.get(0).get("id");
            String email = (String) emp.get(0).get("email");
            List<UUID> userIds = jdbc.queryForList(
                    "SELECT id FROM auth.user_credentials WHERE employee_id = ? AND tenant_id = ? AND is_active = true LIMIT 1",
                    UUID.class, employeeId, t);
            if (userIds.isEmpty()) {
                log.debug("phone lookup: employee {} in tenant {} has no active user_credentials", employeeId, t);
                return Optional.empty();
            }
            return Optional.of(new Match(t, userIds.get(0), employeeId, email));
        } catch (SeveralLogins e) {
            throw e;
        } catch (Exception ignored) {
            // Unreadable tenant (schema drift, permission oddity) — skip.
            return Optional.empty();
        }
    }
}
