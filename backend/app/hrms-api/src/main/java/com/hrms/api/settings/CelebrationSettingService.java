package com.hrms.api.settings;

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

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * "Show birthdays to colleagues" (V143.89, {@code settings.celebration_settings},
 * JDBC only), one switch per company in HR configuration -> Celebrations. ON
 * unless the company turned it off: no row means ON, which is how every company
 * works today.
 *
 * <p>When OFF, nobody in that company sees colleagues' birthdays on Celebrations
 * (Home's card and the page) or on Home's Upcoming events, and nobody can send
 * birthday wishes; work anniversaries and new joiners still show.
 *
 * <p>The readers' lookup ({@link #showBirthdays}) never fails: without the table,
 * or when it can't be read, birthdays show as today. The settings endpoints
 * answer FEATURE_NOT_READY while the table is missing.
 */
@Service
public class CelebrationSettingService {

    private static final Logger log = LoggerFactory.getLogger(CelebrationSettingService.class);

    static final String TABLE = "settings.celebration_settings";

    private final JdbcTemplate jdbc;

    public CelebrationSettingService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** GET/PUT /v1/settings/celebrations. */
    public record Setting(UUID companyId, boolean showBirthdays, String updatedByName, Instant updatedAt) {}

    /** PUT body. */
    public record SaveRequest(Boolean showBirthdays) {}

    /**
     * Whether colleagues in this company see each other's birthdays: true unless
     * the company switched it off. True as well while the table is missing and
     * when it can't be read (today's behaviour); never throws. The caller has
     * bound the tenant.
     */
    public boolean showBirthdays(UUID tenantId, UUID companyId) {
        if (tenantId == null || companyId == null) return true;
        try {
            if (!tableExists()) return true;
            List<Boolean> rows = jdbc.queryForList(
                    "SELECT show_birthdays FROM settings.celebration_settings WHERE tenant_id = ? AND company_id = ?",
                    Boolean.class, tenantId, companyId);
            return rows.isEmpty() || !Boolean.FALSE.equals(rows.get(0));
        } catch (DataAccessException e) {
            log.warn("Could not read the celebration settings of company {}: {}", companyId, e.getMessage());
            return true;
        }
    }

    /** GET /v1/settings/celebrations: FEATURE_NOT_READY while the table is missing. */
    @Transactional(readOnly = true)
    public Setting setting(UUID companyId) {
        requireCompany(companyId);
        UUID tenant = TenantContext.requireTenantId();
        if (!tableExists()) throw new FeatureNotReady();
        List<Setting> rows = FeatureNotReady.guard(() -> jdbc.query("""
                SELECT show_birthdays, updated_by_name, updated_at
                  FROM settings.celebration_settings WHERE tenant_id = ? AND company_id = ?
                """, (rs, i) -> {
            Timestamp at = rs.getTimestamp("updated_at");
            return new Setting(companyId, rs.getBoolean("show_birthdays"), rs.getString("updated_by_name"),
                    at == null ? null : at.toInstant());
        }, tenant, companyId));
        return rows.isEmpty() ? new Setting(companyId, true, null, null) : rows.get(0);
    }

    /** PUT /v1/settings/celebrations. */
    @Transactional
    public Setting save(UUID companyId, SaveRequest body, UUID byUserId, String byName) {
        requireCompany(companyId);
        UUID tenant = TenantContext.requireTenantId();
        if (body == null || body.showBirthdays() == null) {
            throw new BusinessRuleException("Say whether colleagues see each other's birthdays.", "CELEBRATION_SETTING_REQUIRED");
        }
        if (!tableExists()) throw new FeatureNotReady();
        String name = byName == null ? null : byName.length() > 200 ? byName.substring(0, 200) : byName;
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO settings.celebration_settings (tenant_id, company_id, show_birthdays, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, company_id) DO UPDATE
                   SET show_birthdays = EXCLUDED.show_birthdays, updated_by_user_id = EXCLUDED.updated_by_user_id,
                       updated_by_name = EXCLUDED.updated_by_name, updated_at = now()
                """, tenant, companyId, body.showBirthdays(), byUserId, name));
        return setting(companyId);
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
}
