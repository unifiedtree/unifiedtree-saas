package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A company's overtime rules (BW-29 as changed by the client on 2 Oct 2026, DECISIONS 22; table
 * {@code attendance.overtime_rules}, V143.54, JDBC only):
 * <ul>
 *   <li>{@code minimumMinutes}: a THRESHOLD. Extra time under it is not overtime; once it is reached, ALL of the
 *       extra time counts (1 h 20 m extra with a 1 h minimum is 1 h 20 m of overtime). Default
 *       {@value #DEFAULT_MINIMUM} minutes when the company has set none (no row, a NULL value, or no table).</li>
 *   <li>{@code monthlyCapMinutes}: the most overtime that can be approved per person per calendar month; null = no cap.</li>
 * </ul>
 * The rules change only which minutes the Overtime list counts and how much can be approved; stored
 * {@code overtime_minutes}, {@code work_hours} and pay never change, and overtime stays recorded, not paid.
 *
 * <p>The readers the overtime list and decisions use ({@link #tableReady}, {@link #forCompany}) never fail on a
 * missing table, so they can't abort their transaction. The settings endpoints ({@link #get}, {@link #save}) answer
 * FEATURE_NOT_READY instead.
 */
@Service
public class OvertimeRules {

    /** The minimum overtime when a company has set none: one hour (client, 2 Oct 2026). */
    public static final int DEFAULT_MINIMUM = 60;
    /** Largest minimum: a day. */
    public static final int MAX_MINIMUM = 1440;
    /** Largest monthly cap: 31 days of 24 hours. */
    public static final int MAX_MONTHLY_CAP = 44640;

    /**
     * A company's rules. {@code minimumMinutes} is the one in force (the company's, else the default);
     * {@code minimumIsDefault} says which. {@code monthlyCapMinutes} null = no cap.
     */
    public record Rules(UUID companyId, int minimumMinutes, boolean minimumIsDefault, Integer monthlyCapMinutes,
                        String updatedByName, Instant updatedAt) {
        public static Rules none(UUID companyId) {
            return new Rules(companyId, DEFAULT_MINIMUM, true, null, null, null);
        }

        /** Minutes of {@code overtimeMinutes} that count as overtime under these rules. */
        public int counted(int overtimeMinutes) {
            return countedMinutes(overtimeMinutes, minimumMinutes);
        }
    }

    /** The threshold: nothing under the minimum, all of it from the minimum on. */
    public static int countedMinutes(int overtimeMinutes, int minimum) {
        if (overtimeMinutes <= 0) return 0;
        return overtimeMinutes >= minimum ? overtimeMinutes : 0;
    }

    private final JdbcTemplate jdbc;

    public OvertimeRules(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * True when the table and every column this class reads exist (a catalog read; never fails). Public: the
     * overtime controllers call it through this bean's proxy.
     */
    public boolean tableReady() {
        Integer n = jdbc.queryForObject("""
                SELECT count(*) FROM pg_attribute
                 WHERE attrelid = to_regclass('attendance.overtime_rules') AND attnum > 0 AND NOT attisdropped
                   AND attname IN ('tenant_id', 'company_id', 'minimum_minutes', 'monthly_cap_minutes',
                                   'updated_by_name', 'updated_at')
                """, Integer.class);
        return n != null && n == 6;
    }

    /** The rules for a company, the defaults when it has none: never fails on a missing table. */
    @Transactional(readOnly = true)
    public Rules forCompany(UUID tenantId, UUID companyId) {
        if (companyId == null || !tableReady()) return Rules.none(companyId);
        List<Rules> rows = jdbc.query(SELECT_ONE, (rs, i) -> map(rs), tenantId, companyId);
        return rows.isEmpty() ? Rules.none(companyId) : rows.get(0);
    }

    private static final String SELECT_ONE = """
            SELECT company_id, minimum_minutes, monthly_cap_minutes, updated_by_name, updated_at
              FROM attendance.overtime_rules WHERE tenant_id = ? AND company_id = ?
            """;

    /** GET: the company's rules (the default minimum when never set). FEATURE_NOT_READY while the table is missing. */
    @Transactional(readOnly = true)
    public Rules get(UUID companyId) {
        UUID tenantId = TenantContext.requireTenantId();
        requireCompany(tenantId, companyId);
        List<Rules> rows = FeatureNotReady.guard(() -> jdbc.query(SELECT_ONE, (rs, i) -> map(rs), tenantId, companyId));
        return rows.isEmpty() ? Rules.none(companyId) : rows.get(0);
    }

    /**
     * PUT: saves both values. A null minimum goes back to the default (60 minutes); a null cap means no cap. The row
     * is kept, so "who last changed them" stays.
     */
    @Transactional
    public Rules save(UUID companyId, Integer minimumMinutes, Integer monthlyCapMinutes, UUID userId, String userName) {
        UUID tenantId = TenantContext.requireTenantId();
        requireCompany(tenantId, companyId);
        validate(minimumMinutes, monthlyCapMinutes);
        String name = userName == null ? null : userName.length() > 200 ? userName.substring(0, 200) : userName;
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO attendance.overtime_rules
                    (tenant_id, company_id, minimum_minutes, monthly_cap_minutes, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, company_id) DO UPDATE
                   SET minimum_minutes      = EXCLUDED.minimum_minutes,
                       monthly_cap_minutes  = EXCLUDED.monthly_cap_minutes,
                       updated_by_user_id   = EXCLUDED.updated_by_user_id,
                       updated_by_name      = EXCLUDED.updated_by_name,
                       updated_at           = now()
                """, tenantId, companyId, minimumMinutes, monthlyCapMinutes, userId, name));
        return get(companyId);
    }

    static void validate(Integer minimumMinutes, Integer monthlyCapMinutes) {
        if (minimumMinutes != null && (minimumMinutes < 0 || minimumMinutes > MAX_MINIMUM)) {
            throw new BusinessRuleException(
                    "The minimum overtime must be between 0 and " + (MAX_MINIMUM / 60) + " hours.",
                    "OVERTIME_RULES_INVALID");
        }
        if (monthlyCapMinutes != null && (monthlyCapMinutes < 0 || monthlyCapMinutes > MAX_MONTHLY_CAP)) {
            throw new BusinessRuleException(
                    "The monthly cap must be between 0 and " + (MAX_MONTHLY_CAP / 60) + " hours.",
                    "OVERTIME_RULES_INVALID");
        }
    }

    private void requireCompany(UUID tenantId, UUID companyId) {
        if (companyId == null) {
            throw new BusinessRuleException("Choose a company.", "COMPANY_REQUIRED");
        }
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM org.companies WHERE id = ? AND tenant_id = ?)", Boolean.class, companyId, tenantId);
        if (!Boolean.TRUE.equals(found)) {
            throw new ResourceNotFoundException("Company", companyId);
        }
    }

    private static Rules map(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp at = rs.getTimestamp("updated_at");
        Integer minimum = (Integer) rs.getObject("minimum_minutes");
        return new Rules(rs.getObject("company_id", UUID.class),
                minimum == null ? DEFAULT_MINIMUM : minimum, minimum == null,
                (Integer) rs.getObject("monthly_cap_minutes"),
                rs.getString("updated_by_name"),
                at == null ? null : at.toInstant());
    }
}
