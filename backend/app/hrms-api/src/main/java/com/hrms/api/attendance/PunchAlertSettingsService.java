package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Array;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Who gets punch-in alerts in a company (V143.72,
 * {@code attendance.punch_alert_settings}, JDBC only): the person's reporting
 * manager (on by default), extra people the company picks, everyone holding
 * chosen roles (built-in or made by the business), and whether every punch-in
 * counts or only late and outside-office ones. No row means the defaults.
 *
 * <p>The settings endpoints answer FEATURE_NOT_READY while the table is missing.
 * The sender's lookup ({@link #rulesFor}) never fails: without the table it says
 * "no alerts", so nothing is sent until the migration is applied.
 */
@Service
public class PunchAlertSettingsService {

    private static final Logger log = LoggerFactory.getLogger(PunchAlertSettingsService.class);

    static final String TABLE = "attendance.punch_alert_settings";
    public static final String ALL = "ALL";
    public static final String LATE_OR_OUTSIDE = "LATE_OR_OUTSIDE";
    static final int MAX_PEOPLE = 50;
    static final int MAX_ROLES = 20;
    /** The most people the picker lists at once. */
    static final int MAX_OPTIONS = 1000;
    /**
     * Roles that can't be chosen. Everyone holds EMPLOYEE, so it would tell the
     * whole company where each person is; PLATFORM_SUPER_ADMIN is the platform's
     * own operator, not a person in the business.
     */
    static final Set<String> HIDDEN_ROLE_CODES = Set.of("EMPLOYEE", "PLATFORM_SUPER_ADMIN");
    /** Statuses of someone still working here (the policy notices' rule). */
    static final String WORKING = "e.is_active = TRUE AND e.employment_status IN ('ACTIVE','PROBATION','NOTICE_PERIOD','ON_LEAVE')";

    private final JdbcTemplate jdbc;

    public PunchAlertSettingsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── API shapes ──────────────────────────────────────────────────────────

    /** A picked person. {@code working}: false once they have left (the alert skips them). */
    public record Person(UUID employeeId, String name, String employeeCode, String jobTitle, boolean working) {}

    /** A role. {@code builtIn}: one of the platform's roles rather than one the business made. */
    public record RoleRef(UUID roleId, String name, boolean builtIn) {}

    /** GET/PUT /punch-alert-setting. */
    public record Setting(UUID companyId, boolean notifyManager, List<Person> people, List<RoleRef> roles,
                          String alertOn, String updatedByName, Instant updatedAt) {}

    /** PUT body. */
    public record SaveRequest(Boolean notifyManager, List<UUID> employeeIds, List<UUID> roleIds, String alertOn) {}

    /** GET /punch-alert-setting/options: what the picker offers. {@code truncated}: more people than were listed. */
    public record Options(UUID companyId, List<RoleRef> roles, List<Person> people, boolean truncated) {}

    /** What the sender needs: the stored choices, as ids. */
    public record Rules(boolean notifyManager, List<UUID> employeeIds, List<UUID> roleIds, String alertOn) {
        static Rules defaults() {
            return new Rules(true, List.of(), List.of(), ALL);
        }

        boolean onlyExceptions() {
            return LATE_OR_OUTSIDE.equals(alertOn);
        }
    }

    // ── the sender's lookup ─────────────────────────────────────────────────

    /**
     * The company's choices, or the defaults when it never saved any. Empty
     * while the table is missing (punch-in alerts aren't switched on yet) and
     * when it can't be read; never throws. The caller has bound the tenant.
     */
    public Optional<Rules> rulesFor(UUID tenantId, UUID companyId) {
        if (tenantId == null || companyId == null) return Optional.empty();
        try {
            if (!tableExists()) return Optional.empty();
            List<Rules> rows = jdbc.query("""
                    SELECT notify_manager, employee_ids, role_ids, alert_on
                      FROM attendance.punch_alert_settings WHERE tenant_id = ? AND company_id = ?
                    """, (rs, i) -> new Rules(rs.getBoolean("notify_manager"), uuids(rs.getArray("employee_ids")),
                    uuids(rs.getArray("role_ids")), alertOn(rs.getString("alert_on"))), tenantId, companyId);
            return Optional.of(rows.isEmpty() ? Rules.defaults() : rows.get(0));
        } catch (DataAccessException e) {
            log.warn("Could not read the punch-in alert settings of company {}: {}", companyId, e.getMessage());
            return Optional.empty();
        }
    }

    // ── GET / PUT ───────────────────────────────────────────────────────────

    /** GET /punch-alert-setting: FEATURE_NOT_READY while the table is missing. */
    @Transactional(readOnly = true)
    public Setting setting(UUID companyId) {
        requireCompany(companyId);
        UUID tenant = TenantContext.requireTenantId();
        if (!tableExists()) throw new FeatureNotReady();
        return FeatureNotReady.guard(() -> {
            List<Object[]> rows = jdbc.query("""
                    SELECT notify_manager, employee_ids, role_ids, alert_on, updated_by_name, updated_at
                      FROM attendance.punch_alert_settings WHERE tenant_id = ? AND company_id = ?
                    """, (rs, i) -> {
                Timestamp at = rs.getTimestamp("updated_at");
                return new Object[]{new Rules(rs.getBoolean("notify_manager"), uuids(rs.getArray("employee_ids")),
                        uuids(rs.getArray("role_ids")), alertOn(rs.getString("alert_on"))),
                        rs.getString("updated_by_name"), at == null ? null : at.toInstant()};
            }, tenant, companyId);
            if (rows.isEmpty()) return new Setting(companyId, true, List.of(), List.of(), ALL, null, null);
            Rules r = (Rules) rows.get(0)[0];
            return new Setting(companyId, r.notifyManager(), people(tenant, r.employeeIds()), roles(tenant, r.roleIds()),
                    r.alertOn(), (String) rows.get(0)[1], (Instant) rows.get(0)[2]);
        });
    }

    /**
     * PUT /punch-alert-setting. Picked people must be in this company (someone
     * who has since left may stay on the list; the alert skips them), and roles
     * must be built-in or this workspace's own, never the hidden ones.
     */
    @Transactional
    public Setting save(UUID companyId, SaveRequest body, UUID byUserId, String byName) {
        requireCompany(companyId);
        UUID tenant = TenantContext.requireTenantId();
        if (body == null || body.notifyManager() == null) {
            throw new BusinessRuleException("Say whether the reporting manager gets punch-in alerts.", "PUNCH_ALERT_SETTING_REQUIRED");
        }
        String alertOn = body.alertOn() == null ? ALL : body.alertOn().trim().toUpperCase(Locale.ROOT);
        if (!ALL.equals(alertOn) && !LATE_OR_OUTSIDE.equals(alertOn)) {
            throw new BusinessRuleException("Choose every punch-in, or only late and outside-office punch-ins.", "PUNCH_ALERT_WHEN_INVALID");
        }
        List<UUID> people = PunchAlerts.distinct(body.employeeIds());
        List<UUID> roles = PunchAlerts.distinct(body.roleIds());
        if (people.size() > MAX_PEOPLE) {
            throw new BusinessRuleException("Choose up to " + MAX_PEOPLE + " people.", "PUNCH_ALERT_TOO_MANY_PEOPLE");
        }
        if (roles.size() > MAX_ROLES) {
            throw new BusinessRuleException("Choose up to " + MAX_ROLES + " roles.", "PUNCH_ALERT_TOO_MANY_ROLES");
        }
        if (!tableExists()) throw new FeatureNotReady();
        if (!people.isEmpty()) {
            Set<UUID> inCompany = Set.copyOf(jdbc.queryForList(
                    "SELECT id FROM hrms.employees WHERE tenant_id = ? AND company_id = ? AND id = ANY(CAST(? AS uuid[]))",
                    UUID.class, tenant, companyId, array(people)));
            if (!inCompany.containsAll(people)) {
                throw new BusinessRuleException("Someone you picked doesn't work in this company. Pick people from this company.",
                        "PUNCH_ALERT_PERSON_INVALID");
            }
        }
        if (!roles.isEmpty()) {
            Set<UUID> allowed = Set.copyOf(jdbc.queryForList("""
                    SELECT id FROM rbac.roles
                     WHERE id = ANY(CAST(? AS uuid[])) AND (tenant_id IS NULL OR tenant_id = ?)
                       AND NOT (code = ANY(CAST(? AS text[])))
                    """, UUID.class, array(roles), tenant, textArray(HIDDEN_ROLE_CODES)));
            if (!allowed.containsAll(roles)) {
                throw new BusinessRuleException("A role you picked can't get punch-in alerts. Pick another role.",
                        "PUNCH_ALERT_ROLE_INVALID");
            }
        }
        String name = byName == null ? null : byName.length() > 200 ? byName.substring(0, 200) : byName;
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO attendance.punch_alert_settings
                       (tenant_id, company_id, notify_manager, employee_ids, role_ids, alert_on, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, CAST(? AS uuid[]), CAST(? AS uuid[]), ?, ?, ?, now())
                ON CONFLICT (tenant_id, company_id) DO UPDATE
                   SET notify_manager = EXCLUDED.notify_manager, employee_ids = EXCLUDED.employee_ids,
                       role_ids = EXCLUDED.role_ids, alert_on = EXCLUDED.alert_on,
                       updated_by_user_id = EXCLUDED.updated_by_user_id, updated_by_name = EXCLUDED.updated_by_name,
                       updated_at = now()
                """, tenant, companyId, body.notifyManager(), array(people), array(roles), alertOn, byUserId, name));
        return setting(companyId);
    }

    /**
     * GET /punch-alert-setting/options: the roles that can be chosen (built-in
     * ones first, then the business's own) and the people of this company who
     * can get an alert (still working here, with a login), by name.
     */
    @Transactional(readOnly = true)
    public Options options(UUID companyId) {
        requireCompany(companyId);
        UUID tenant = TenantContext.requireTenantId();
        List<RoleRef> roles = jdbc.query("""
                SELECT id, COALESCE(NULLIF(TRIM(display_name), ''), code) AS name, tenant_id IS NULL AS built_in
                  FROM rbac.roles
                 WHERE (tenant_id IS NULL OR tenant_id = ?) AND NOT (code = ANY(CAST(? AS text[])))
                 ORDER BY tenant_id IS NULL DESC, lower(COALESCE(NULLIF(TRIM(display_name), ''), code))
                """, (rs, i) -> new RoleRef((UUID) rs.getObject("id"), rs.getString("name"), rs.getBoolean("built_in")),
                tenant, textArray(HIDDEN_ROLE_CODES));
        List<Person> people = jdbc.query("""
                SELECT e.id, NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS name,
                       e.employee_code, e.job_title
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.company_id = ? AND %s
                   AND EXISTS (SELECT 1 FROM auth.user_credentials uc
                                WHERE uc.tenant_id = e.tenant_id AND uc.employee_id = e.id AND uc.is_active = TRUE)
                 ORDER BY lower(COALESCE(e.first_name, '')), lower(COALESCE(e.last_name, '')), e.id
                 LIMIT ?
                """.formatted(WORKING), (rs, i) -> new Person((UUID) rs.getObject("id"), rs.getString("name"),
                rs.getString("employee_code"), rs.getString("job_title"), true), tenant, companyId, MAX_OPTIONS + 1);
        boolean truncated = people.size() > MAX_OPTIONS;
        return new Options(companyId, roles, truncated ? people.subList(0, MAX_OPTIONS) : people, truncated);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** The picked people with their names, in the order they were picked; ids no longer in the workspace are left out. */
    private List<Person> people(UUID tenant, List<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        Map<UUID, Person> found = new LinkedHashMap<>();
        jdbc.query("""
                SELECT e.id, NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS name,
                       e.employee_code, e.job_title, (%s) AS working
                  FROM hrms.employees e
                 WHERE e.tenant_id = ? AND e.id = ANY(CAST(? AS uuid[]))
                """.formatted(WORKING), (RowCallbackHandler) rs -> {
            UUID id = (UUID) rs.getObject("id");
            found.put(id, new Person(id, rs.getString("name"), rs.getString("employee_code"), rs.getString("job_title"),
                    rs.getBoolean("working")));
        }, tenant, array(ids));
        return ids.stream().map(found::get).filter(java.util.Objects::nonNull).toList();
    }

    /** The chosen roles with their names, in the order they were chosen; roles since deleted are left out. */
    private List<RoleRef> roles(UUID tenant, List<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        Map<UUID, RoleRef> found = new LinkedHashMap<>();
        jdbc.query("""
                SELECT id, COALESCE(NULLIF(TRIM(display_name), ''), code) AS name, tenant_id IS NULL AS built_in
                  FROM rbac.roles WHERE id = ANY(CAST(? AS uuid[])) AND (tenant_id IS NULL OR tenant_id = ?)
                """, (RowCallbackHandler) rs -> {
            UUID id = (UUID) rs.getObject("id");
            found.put(id, new RoleRef(id, rs.getString("name"), rs.getBoolean("built_in")));
        }, array(ids), tenant);
        return ids.stream().map(found::get).filter(java.util.Objects::nonNull).toList();
    }

    private void requireCompany(UUID companyId) {
        if (companyId == null) throw new BusinessRuleException("Choose a company.", "COMPANY_REQUIRED");
        Integer found = jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id = ? AND tenant_id = ?",
                Integer.class, companyId, TenantContext.requireTenantId());
        if (found == null || found == 0) throw new ResourceNotFoundException("Company", companyId);
    }

    /** to_regclass never fails, so this is safe inside a transaction. */
    boolean tableExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, TABLE));
    }

    static String alertOn(String stored) {
        return LATE_OR_OUTSIDE.equals(stored) ? LATE_OR_OUTSIDE : ALL;
    }

    /** A uuid[] value as the text PostgreSQL casts: {a,b}. */
    static String array(Collection<UUID> ids) {
        return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    private static String textArray(Collection<String> values) {
        return values.stream().sorted().collect(Collectors.joining(",", "{", "}"));
    }

    static List<UUID> uuids(Array array) throws SQLException {
        if (array == null) return List.of();
        Object raw = array.getArray();
        if (!(raw instanceof Object[] items)) return List.of();
        List<UUID> out = new ArrayList<>(items.length);
        for (Object o : items) {
            if (o == null) continue;
            try {
                out.add(o instanceof UUID u ? u : UUID.fromString(o.toString()));
            } catch (IllegalArgumentException ignored) {
                // not an id: skipped
            }
        }
        return out;
    }
}
