package com.hrms.employee.service;

import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * One rule for employee emails in a workspace (tenant), used by every path that
 * creates an employee, changes their work or personal email, imports them or
 * invites their login:
 * <ul>
 *   <li>Emails are compared trimmed and lower-cased ({@link #normalizeEmail}),
 *       and new ones are saved that way.</li>
 *   <li>A work email belongs to one employee, across every company of the
 *       workspace. People who left still count: their record keeps the email.</li>
 *   <li>A personal email can't be another employee's work or personal email
 *       (so a work email can't be someone else's personal one either).</li>
 *   <li>A login email follows the work-email rule: it can't be the login of a
 *       different employee.</li>
 * </ul>
 * A clash is a 409 {@value #EMAIL_ALREADY_USED} whose message names the person
 * only to callers who may see them ({@link #callerMaySeeOwners()}).
 *
 * <p>A phone number is never refused; {@link #phoneOwners} lets forms warn
 * "Also used by …".
 *
 * <p>JDBC only (hrms.employees and auth.user_credentials), tenant-filtered on top
 * of row-level security. V143.91 adds the matching unique index on
 * (tenant_id, lower(btrim(email))) as the last line of defence.
 */
@Component
public class EmployeeContactGuard {

    private static final Logger log = LoggerFactory.getLogger(EmployeeContactGuard.class);

    public static final String EMAIL_ALREADY_USED = "EMAIL_ALREADY_USED";

    /** The message when the caller may not see who has the email. */
    public static final String GENERIC_EMAIL_MESSAGE = "This email is already used by another employee in this workspace.";

    /** The unique indexes a race past the check would hit (the old exact one and V143.91's). */
    static final List<String> EMAIL_INDEXES = List.of(
            "uq_employee_tenant_email", "uq_employees_tenant_email_norm", "uq_employees_tenant_personal_email_norm");

    /** Who may see whose an email or number is: the people who read or edit every employee record. */
    static final List<String> SEE_OWNERS = List.of("hrms.employee.read", "hrms.employee.write");

    /** How many people a phone warning lists by name. */
    static final int PHONE_NAMES = 3;

    private final JdbcTemplate jdbc;

    public EmployeeContactGuard(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Which of the other person's addresses matched. */
    public enum Field { WORK, PERSONAL, LOGIN }

    /** Someone who already has the email or number. */
    public record Owner(UUID id, String name, String code, boolean left, Field field) {
        /** "Aisha Khan (EMP-0003)". */
        public String label() {
            return code == null || code.isBlank() ? name : name + " (" + code + ")";
        }
    }

    // ── normalising ──────────────────────────────────────────────────────────

    /** Trimmed and lower-cased; null when blank. The form every new email is saved in. */
    public static String normalizeEmail(String raw) {
        if (raw == null) return null;
        String s = raw.strip();
        return s.isEmpty() ? null : s.toLowerCase(Locale.ROOT);
    }

    /**
     * The last ten digits, as the phone sign-in and idx_employees_phone_last10 match
     * numbers ("+91 98450 12345" and "9845012345" are the same number); null when the
     * value has fewer than seven digits.
     */
    public static String phoneKey(String raw) {
        if (raw == null) return null;
        String d = raw.replaceAll("\\D", "");
        if (d.length() < 7) return null;
        return d.length() > 10 ? d.substring(d.length() - 10) : d;
    }

    // ── emails ───────────────────────────────────────────────────────────────

    /**
     * The other employee whose work or personal email this is (a work match first),
     * else the employee whose login it is. {@code excludeEmployeeId} is the person
     * being edited (null when adding someone).
     */
    public Optional<Owner> emailOwner(UUID tenantId, String email, UUID excludeEmployeeId) {
        String e = normalizeEmail(email);
        if (e == null || tenantId == null) return Optional.empty();
        List<Object> args = new ArrayList<>(List.of(e, tenantId, e, e));
        StringBuilder sql = new StringBuilder("""
                SELECT id, first_name, last_name, employee_code, employment_status, is_active,
                       COALESCE(lower(btrim(email)) = ?, FALSE) AS work_match
                  FROM hrms.employees
                 WHERE tenant_id = ?
                   AND (lower(btrim(email)) = ? OR lower(btrim(personal_email)) = ?)
                """);
        if (excludeEmployeeId != null) { sql.append(" AND id <> ?"); args.add(excludeEmployeeId); }
        sql.append(" ORDER BY work_match DESC, is_active DESC LIMIT 1");
        List<Owner> hits = jdbc.query(sql.toString(),
                (rs, i) -> owner(rs, rs.getBoolean("work_match") ? Field.WORK : Field.PERSONAL), args.toArray());
        if (hits != null && !hits.isEmpty()) return Optional.of(hits.get(0));
        return loginOwner(tenantId, e, excludeEmployeeId);
    }

    /** The other employee whose login this email is. A login with no employee record is not a clash. */
    Optional<Owner> loginOwner(UUID tenantId, String normalizedEmail, UUID excludeEmployeeId) {
        List<Object> args = new ArrayList<>(List.of(tenantId, normalizedEmail));
        StringBuilder sql = new StringBuilder("""
                SELECT e.id, e.first_name, e.last_name, e.employee_code, e.employment_status, e.is_active
                  FROM auth.user_credentials c
                  JOIN hrms.employees e ON e.id = c.employee_id
                 WHERE c.tenant_id = ? AND lower(btrim(c.email)) = ?
                """);
        if (excludeEmployeeId != null) { sql.append(" AND c.employee_id <> ?"); args.add(excludeEmployeeId); }
        sql.append(" LIMIT 1");
        try {
            List<Owner> hits = jdbc.query(sql.toString(), (rs, i) -> owner(rs, Field.LOGIN), args.toArray());
            return hits == null || hits.isEmpty() ? Optional.empty() : Optional.of(hits.get(0));
        } catch (DataAccessException ex) {
            // auth's own unique (tenant_id, lower(email)) still stands behind this.
            log.warn("Login email check skipped: {}", ex.getMessage());
            return Optional.empty();
        }
    }

    /** Refuses (409) an email that is another employee's work, personal or login email in this workspace. */
    public void assertEmailFree(String email, UUID excludeEmployeeId) {
        emailOwner(TenantContext.getTenantId(), email, excludeEmployeeId).ifPresent(o -> {
            throw new EmailAlreadyUsedException(conflictMessage(o, callerMaySeeOwners()));
        });
    }

    /**
     * Every email in the workspace, normalised, with whose it is: work and personal
     * emails, then the logins of employees whose login differs from their work email.
     * For checking a whole import file in one go.
     */
    public Map<String, Owner> allEmailOwners(UUID tenantId) {
        Map<String, Owner> out = new HashMap<>();
        if (tenantId == null) return out;
        jdbc.query("""
                SELECT id, first_name, last_name, employee_code, employment_status, is_active,
                       lower(btrim(email)) AS work, lower(btrim(personal_email)) AS personal
                  FROM hrms.employees
                 WHERE tenant_id = ?
                 ORDER BY is_active DESC
                """, rs -> {
            String work = rs.getString("work"), personal = rs.getString("personal");
            if (work != null && !work.isEmpty()) out.putIfAbsent(work, owner(rs, Field.WORK));
            if (personal != null && !personal.isEmpty()) out.putIfAbsent(personal, owner(rs, Field.PERSONAL));
        }, tenantId);
        try {
            jdbc.query("""
                    SELECT e.id, e.first_name, e.last_name, e.employee_code, e.employment_status, e.is_active,
                           lower(btrim(c.email)) AS login
                      FROM auth.user_credentials c
                      JOIN hrms.employees e ON e.id = c.employee_id
                     WHERE c.tenant_id = ?
                    """, rs -> {
                String login = rs.getString("login");
                if (login != null && !login.isEmpty()) out.putIfAbsent(login, owner(rs, Field.LOGIN));
            }, tenantId);
        } catch (DataAccessException ex) {
            log.warn("Login emails left out of the import check: {}", ex.getMessage());
        }
        return out;
    }

    /** The 409 message: names the person (and says when they have left) only when {@code reveal}. */
    public static String conflictMessage(Owner o, boolean reveal) {
        if (!reveal || o == null || o.id() == null) return GENERIC_EMAIL_MESSAGE;
        String left = o.left() ? ", who has left. Their record keeps the email, so use a different one." : ".";
        return o.field() == Field.PERSONAL
                ? "This email is already the personal email of " + o.label() + left
                : "This email already belongs to " + o.label() + left;
    }

    /** Whether the caller may see who already has an email or number (reads or edits every employee record). */
    public static boolean callerMaySeeOwners() {
        try {
            Authentication a = SecurityContextHolder.getContext().getAuthentication();
            return a != null && a.getAuthorities().stream().anyMatch(g -> SEE_OWNERS.contains(g.getAuthority()));
        } catch (RuntimeException ignore) {
            return false;
        }
    }

    /** True when a write failed on one of the email unique indexes (someone saved the same email meanwhile). */
    public static boolean isEmailIndexViolation(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            String m = t.getMessage();
            if (m != null && EMAIL_INDEXES.stream().anyMatch(m::contains)) return true;
        }
        return false;
    }

    // ── phones (a warning, never a refusal) ──────────────────────────────────

    /** The other employees with this number (up to six), people still working first. */
    public List<Owner> phoneOwners(UUID tenantId, String phone, UUID excludeEmployeeId) {
        String k = phoneKey(phone);
        if (k == null || tenantId == null) return List.of();
        List<Object> args = new ArrayList<>(List.of(tenantId, k));
        StringBuilder sql = new StringBuilder("""
                SELECT id, first_name, last_name, employee_code, employment_status, is_active
                  FROM hrms.employees
                 WHERE tenant_id = ?
                   AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = ?
                """);
        if (excludeEmployeeId != null) { sql.append(" AND id <> ?"); args.add(excludeEmployeeId); }
        sql.append(" ORDER BY is_active DESC, employee_code LIMIT 6");
        List<Owner> hits = jdbc.query(sql.toString(), (rs, i) -> owner(rs, Field.WORK), args.toArray());
        return hits == null ? List.of() : hits;
    }

    /** Every phone number in the workspace (by {@link #phoneKey}) with the people who have it; for imports. */
    public Map<String, List<Owner>> allPhoneOwners(UUID tenantId) {
        Map<String, List<Owner>> out = new LinkedHashMap<>();
        if (tenantId == null) return out;
        jdbc.query("""
                SELECT id, first_name, last_name, employee_code, employment_status, is_active, phone
                  FROM hrms.employees
                 WHERE tenant_id = ? AND phone IS NOT NULL
                 ORDER BY is_active DESC, employee_code
                """, rs -> {
            String k = phoneKey(rs.getString("phone"));
            if (k != null) out.computeIfAbsent(k, x -> new ArrayList<>()).add(owner(rs, Field.WORK));
        }, tenantId);
        return out;
    }

    /** "Also used by A (EMP-1), B (EMP-2) and 2 more." — or a nameless line when not {@code reveal}; null when nobody. */
    public static String phoneWarning(List<Owner> owners, boolean reveal) {
        if (owners == null || owners.isEmpty()) return null;
        if (!reveal) return "This number is also used by another employee.";
        List<String> names = owners.stream().limit(PHONE_NAMES).map(Owner::label).toList();
        int more = owners.size() - names.size();
        String list = names.size() == 1 ? names.get(0)
                : String.join(", ", names.subList(0, names.size() - 1)) + (more > 0 ? ", " : " and ") + names.get(names.size() - 1);
        return "Also used by " + list + (more > 0 ? " and " + more + " more" : "") + ".";
    }

    // ── rows ─────────────────────────────────────────────────────────────────

    private static Owner owner(ResultSet rs, Field field) throws SQLException {
        String first = rs.getString("first_name"), last = rs.getString("last_name");
        String name = ((first == null ? "" : first.trim()) + " " + (last == null ? "" : last.trim())).trim();
        String status = rs.getString("employment_status");
        boolean left = !rs.getBoolean("is_active") || "EXITED".equals(status) || "TERMINATED".equals(status);
        return new Owner(rs.getObject("id", UUID.class), name.isEmpty() ? "another employee" : name,
                rs.getString("employee_code"), left, field);
    }
}
