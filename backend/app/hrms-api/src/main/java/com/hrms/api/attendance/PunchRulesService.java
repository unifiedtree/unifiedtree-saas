package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Where a person may punch from (V143.53 redesign):
 * <ul>
 *   <li><b>"Allow web check-in"</b> (BW-24), a company switch, OFF by default,
 *       in {@code settings.hr_configuration.allow_web_punch} (JDBC only; the
 *       HrConfiguration entity does not map it). The punch API refuses the WEB
 *       method while it is off, and also while the records' method checks don't
 *       accept WEB yet (the migration is applied by hand, in steps). A web punch
 *       needs the browser's location; the geofence rule is unchanged and there
 *       is no face check on the web.</li>
 *   <li><b>"Anywhere (no geofence)"</b> (BW-28), per person, in
 *       {@code hrms.employee_punch_rules}. Check-in skips the geofence check for
 *       that person. No row, or no table, means the rule is off: today's
 *       behaviour.</li>
 * </ul>
 * The lookups the punch paths use never fail and never log: a missing column or
 * table reads as "off". The settings endpoints answer FEATURE_NOT_READY instead,
 * so the pages can hide the toggles.
 */
@Service
public class PunchRulesService {

    private static final Logger log = LoggerFactory.getLogger(PunchRulesService.class);

    static final String WEB = "WEB";
    public static final String WEB_PUNCH_NOT_ALLOWED = "WEB_PUNCH_NOT_ALLOWED";
    public static final String LOCATION_REQUIRED = "LOCATION_REQUIRED";

    private final JdbcTemplate jdbc;

    public PunchRulesService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── web check-in ────────────────────────────────────────────────────────

    /** "Allow web check-in" for one company (the API shape of the contract). */
    public record WebPunchSetting(UUID companyId, boolean allowWebPunch) {}

    /** True when a punch names the web method (the same spelling AttendanceService maps to WEB). */
    public static boolean isWeb(String method) {
        return method != null && WEB.equals(method.toUpperCase());
    }

    /**
     * The browser sent a real position: both coordinates, in range, and not the
     * 0,0 a client sends when it has none (the old web hook's default).
     */
    public static boolean hasLocation(Double latitude, Double longitude) {
        if (latitude == null || longitude == null) return false;
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)) return false;
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
        return !(latitude == 0.0 && longitude == 0.0);
    }

    /**
     * Refuses a web punch unless the company switched web check-in on, the
     * records accept WEB, and the browser sent its location.
     */
    public void assertWebPunch(UUID companyId, Double latitude, Double longitude) {
        if (!webPunchAllowed(companyId) || !webMethodStorable()) {
            throw new BusinessRuleException(
                    "Web check-in isn't switched on for your company. Check in and out from the mobile app.",
                    WEB_PUNCH_NOT_ALLOWED);
        }
        if (!hasLocation(latitude, longitude)) {
            throw new BusinessRuleException(
                    "Your browser's location is needed to check in or out from the web. Allow location for this site and try again.",
                    LOCATION_REQUIRED);
        }
    }

    /** The company's switch; false while it is off, the column is missing, or it can't be read. */
    public boolean webPunchAllowed(UUID companyId) {
        if (companyId == null) return false;
        try {
            if (!columnExists("settings.hr_configuration", "allow_web_punch")) return false;
            List<Boolean> on = jdbc.queryForList(
                    "SELECT allow_web_punch FROM settings.hr_configuration WHERE tenant_id = ? AND company_id = ?",
                    Boolean.class, TenantContext.requireTenantId(), companyId);
            return !on.isEmpty() && Boolean.TRUE.equals(on.get(0));
        } catch (DataAccessException | IllegalStateException e) {
            log.warn("Could not read the web check-in switch for company {}: {}", companyId, e.getMessage());
            return false;
        }
    }

    /**
     * Every CHECK on attendance.records that names a punch method accepts WEB,
     * i.e. V143.53's constraint steps are done. Until then a WEB row would be
     * refused by the database, so the API refuses it first, with a clear answer.
     */
    boolean webMethodStorable() {
        try {
            Boolean ok = jdbc.queryForObject("""
                    SELECT NOT EXISTS (
                        SELECT 1 FROM pg_constraint c
                         WHERE c.conrelid = to_regclass('attendance.records') AND c.contype = 'c'
                           AND (pg_get_constraintdef(c.oid) LIKE '%check_in_method%'
                                OR pg_get_constraintdef(c.oid) LIKE '%check_out_method%')
                           AND pg_get_constraintdef(c.oid) NOT LIKE '%''WEB''%')
                    """, Boolean.class);
            return Boolean.TRUE.equals(ok);
        } catch (DataAccessException e) {
            log.warn("Could not read the attendance method checks: {}", e.getMessage());
            return false;
        }
    }

    /** GET /web-punch-setting: FEATURE_NOT_READY while the column is missing. */
    @Transactional(readOnly = true)
    public WebPunchSetting setting(UUID companyId) {
        requireCompany(companyId);
        return FeatureNotReady.guard(() -> {
            List<Boolean> on = jdbc.queryForList(
                    "SELECT allow_web_punch FROM settings.hr_configuration WHERE tenant_id = ? AND company_id = ?",
                    Boolean.class, TenantContext.requireTenantId(), companyId);
            return new WebPunchSetting(companyId, !on.isEmpty() && Boolean.TRUE.equals(on.get(0)));
        });
    }

    /**
     * PUT /web-punch-setting. Turning it on creates the company's HR
     * configuration row when it has none yet (every other setting at its
     * default, the values HR Configuration already shows); turning it off never
     * creates one.
     */
    @Transactional
    public WebPunchSetting save(UUID companyId, boolean allowWebPunch) {
        requireCompany(companyId);
        UUID tenant = TenantContext.requireTenantId();
        FeatureNotReady.run(() -> {
            if (allowWebPunch) {
                jdbc.update("""
                        INSERT INTO settings.hr_configuration (id, tenant_id, company_id, allow_web_punch)
                        VALUES (gen_random_uuid(), ?, ?, TRUE)
                        ON CONFLICT (tenant_id, company_id) DO UPDATE SET allow_web_punch = TRUE, updated_at = now()
                        """, tenant, companyId);
            } else {
                jdbc.update("UPDATE settings.hr_configuration SET allow_web_punch = FALSE, updated_at = now() "
                        + "WHERE tenant_id = ? AND company_id = ?", tenant, companyId);
            }
        });
        return new WebPunchSetting(companyId, allowWebPunch);
    }

    private void requireCompany(UUID companyId) {
        if (companyId == null) throw new BusinessRuleException("Choose a company.", "COMPANY_REQUIRED");
        Integer found = jdbc.queryForObject("SELECT count(*) FROM org.companies WHERE id = ? AND tenant_id = ?",
                Integer.class, companyId, TenantContext.requireTenantId());
        if (found == null || found == 0) throw new ResourceNotFoundException("Company", companyId);
    }

    // ── "Anywhere (no geofence)" per person ─────────────────────────────────

    /** One person's punch rule (the API shape). */
    public record PunchRule(UUID employeeId, boolean allowAnywhere, String updatedByName, Instant updatedAt) {}

    /**
     * True when this person may check in from anywhere. False without a row,
     * without the table, or when it can't be read, so the geofence applies as
     * before. Uses to_regclass first, so it is safe inside a transaction.
     */
    public boolean allowAnywhere(UUID employeeId) {
        if (employeeId == null) return false;
        try {
            if (!tableExists("hrms.employee_punch_rules")) return false;
            List<Boolean> on = jdbc.queryForList(
                    "SELECT allow_anywhere FROM hrms.employee_punch_rules WHERE tenant_id = ? AND employee_id = ?",
                    Boolean.class, TenantContext.requireTenantId(), employeeId);
            return !on.isEmpty() && Boolean.TRUE.equals(on.get(0));
        } catch (DataAccessException | IllegalStateException e) {
            log.warn("Could not read the punch rule of employee {}: {}", employeeId, e.getMessage());
            return false;
        }
    }

    /** GET /punch-rules/{employeeId}: FEATURE_NOT_READY while the table is missing. */
    @Transactional(readOnly = true)
    public PunchRule rule(UUID employeeId) {
        requireEmployee(employeeId);
        return FeatureNotReady.guard(() -> {
            List<PunchRule> rows = jdbc.query("""
                    SELECT employee_id, allow_anywhere, updated_by_name, updated_at
                      FROM hrms.employee_punch_rules WHERE tenant_id = ? AND employee_id = ?
                    """, (rs, i) -> new PunchRule((UUID) rs.getObject("employee_id"), rs.getBoolean("allow_anywhere"),
                    rs.getString("updated_by_name"), rs.getTimestamp("updated_at").toInstant()),
                    TenantContext.requireTenantId(), employeeId);
            return rows.isEmpty() ? new PunchRule(employeeId, false, null, null) : rows.get(0);
        });
    }

    /** PUT /punch-rules/{employeeId}. */
    @Transactional
    public PunchRule saveRule(UUID employeeId, boolean allowAnywhere, UUID byUserId, String byName) {
        requireEmployee(employeeId);
        UUID tenant = TenantContext.requireTenantId();
        String name = byName == null ? null : byName.length() > 200 ? byName.substring(0, 200) : byName;
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO hrms.employee_punch_rules (tenant_id, employee_id, allow_anywhere, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, employee_id) DO UPDATE
                   SET allow_anywhere = EXCLUDED.allow_anywhere, updated_by_user_id = EXCLUDED.updated_by_user_id,
                       updated_by_name = EXCLUDED.updated_by_name, updated_at = now()
                """, tenant, employeeId, allowAnywhere, byUserId, name));
        return rule(employeeId);
    }

    private void requireEmployee(UUID employeeId) {
        if (employeeId == null) throw new BusinessRuleException("Choose a person.", "EMPLOYEE_REQUIRED");
        Integer found = jdbc.queryForObject("SELECT count(*) FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                Integer.class, employeeId, TenantContext.requireTenantId());
        if (found == null || found == 0) throw new ResourceNotFoundException("Employee", employeeId);
    }

    // ── catalog checks (they never fail, so they are safe inside a transaction) ──

    private boolean tableExists(String qualifiedName) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, qualifiedName));
    }

    private boolean columnExists(String qualifiedTable, String column) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(?) AND attname = ? AND NOT attisdropped)",
                Boolean.class, qualifiedTable, column));
    }
}
