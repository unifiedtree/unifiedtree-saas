package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.RosterSettings;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;

/**
 * The shift planner's settings per company ({@code attendance.roster_settings}, design §1.1 table 9,
 * endpoints 5–6): the minimum rest between two shifts (D-S8, warning only, default 8 hours).
 * Defaults when the company has no row. {@code rosters_drive_attendance} is shown but never changed
 * here: it is Phase 3's switch, read by nothing in Phase 1, with no screen to set it until then.
 */
@Service
public class RosterSettingsService {

    public static final int DEFAULT_MIN_REST_MINUTES = 480;
    static final int MAX_MIN_REST_MINUTES = 1440;

    private final JdbcTemplate jdbc;
    private final RosterTables tables;

    public RosterSettingsService(JdbcTemplate jdbc, RosterTables tables) {
        this.jdbc = jdbc;
        this.tables = tables;
    }

    @Transactional(readOnly = true)
    public RosterSettings get(Jwt jwt, UUID companyIdIn) {
        tables.require();
        UUID tenant = TenantContext.requireTenantId();
        UUID companyId = company(jwt, tenant, companyIdIn);
        return read(tenant, companyId);
    }

    @Transactional
    public RosterSettings update(Jwt jwt, UUID companyIdIn, RosterContract.RosterSettingsBody body) {
        tables.require();
        if (body == null || body.minRestMinutes() < 0 || body.minRestMinutes() > MAX_MIN_REST_MINUTES) {
            throw RosterErrors.settingsInvalid("The minimum rest is from 0 to 24 hours (0 to 1440 minutes).");
        }
        UUID tenant = TenantContext.requireTenantId();
        UUID companyId = company(jwt, tenant, companyIdIn);
        String who = name(jwt, tenant);
        jdbc.update("""
                INSERT INTO attendance.roster_settings (tenant_id, company_id, min_rest_minutes, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, company_id) DO UPDATE
                   SET min_rest_minutes = EXCLUDED.min_rest_minutes, updated_by_user_id = EXCLUDED.updated_by_user_id,
                       updated_by_name = EXCLUDED.updated_by_name, updated_at = now()
                """, tenant, companyId, body.minRestMinutes(), RosterAuth.userId(jwt), who);
        return read(tenant, companyId);
    }

    /** The company's settings, or the defaults when it has none saved. */
    public RosterSettings read(UUID tenant, UUID companyId) {
        List<RosterSettings> rows = jdbc.query("""
                SELECT min_rest_minutes, rosters_drive_attendance, updated_by_name, updated_at
                  FROM attendance.roster_settings WHERE tenant_id = ? AND company_id = ?
                """, (rs, n) -> {
            Timestamp t = rs.getTimestamp("updated_at");
            return new RosterSettings(companyId, rs.getInt("min_rest_minutes"), rs.getBoolean("rosters_drive_attendance"),
                    rs.getString("updated_by_name"), t == null ? null : t.toInstant());
        }, tenant, companyId);
        return rows.isEmpty() ? new RosterSettings(companyId, DEFAULT_MIN_REST_MINUTES, false, null, null) : rows.get(0);
    }

    /** The named company (access checked by the filter), else the one the request runs in, else the caller's own. */
    private UUID company(Jwt jwt, UUID tenant, UUID companyIdIn) {
        UUID companyId = companyIdIn != null ? companyIdIn : CompanyContext.getCompanyId();
        UUID employeeId = RosterAuth.employeeId(jwt);
        if (companyId == null && employeeId != null) {
            List<UUID> own = jdbc.queryForList("SELECT company_id FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                    UUID.class, employeeId, tenant);
            companyId = own.isEmpty() ? null : own.get(0);
        }
        if (companyId == null) throw RosterErrors.companyRequired();
        Boolean known = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM org.companies WHERE id = ? AND tenant_id = ?)",
                Boolean.class, companyId, tenant);
        if (!Boolean.TRUE.equals(known)) throw new ResourceNotFoundException("Company", companyId);
        return companyId;
    }

    private String name(Jwt jwt, UUID tenant) {
        UUID employeeId = RosterAuth.employeeId(jwt);
        if (employeeId != null) {
            List<String> n = jdbc.queryForList("SELECT concat_ws(' ', first_name, last_name) FROM hrms.employees WHERE id = ? AND tenant_id = ?",
                    String.class, employeeId, tenant);
            if (!n.isEmpty() && n.get(0) != null && !n.get(0).isBlank()) return n.get(0);
        }
        return jwt.getClaimAsString("email");
    }
}
