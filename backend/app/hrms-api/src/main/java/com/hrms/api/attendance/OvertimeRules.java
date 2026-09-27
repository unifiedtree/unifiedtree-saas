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
 * A company's overtime rules (BW-29, table {@code attendance.overtime_rules},
 * V143.54, JDBC only):
 * <ul>
 *   <li>{@code countsAfterMinutes}: the first N extra minutes past the shift
 *       don't count as overtime; only the time past them does.</li>
 *   <li>{@code monthlyCapMinutes}: the most counted overtime that can be
 *       approved per person per calendar month.</li>
 * </ul>
 * Null means no rule. No row, null values or a missing table all give today's
 * behaviour exactly. The rules change only which minutes the Overtime list
 * counts and how much can be approved; stored {@code overtime_minutes},
 * {@code work_hours} and pay never change, and overtime stays recorded, not
 * paid.
 *
 * <p>The readers the overtime list and decisions use ({@link #inUse},
 * {@link #forCompany}) first check the catalog, which can't fail, so a missing
 * table never aborts their transaction. The settings endpoints ({@link #get},
 * {@link #save}) answer FEATURE_NOT_READY instead.
 */
@Service
public class OvertimeRules {

    /** Longest "counts after": a day. */
    public static final int MAX_COUNTS_AFTER = 1440;
    /** Largest monthly cap: 31 days of 24 hours. */
    public static final int MAX_MONTHLY_CAP = 44640;

    /** A company's rules; both values null when none are set. */
    public record Rules(UUID companyId, Integer countsAfterMinutes, Integer monthlyCapMinutes,
                        String updatedByName, Instant updatedAt) {
        public static Rules none(UUID companyId) {
            return new Rules(companyId, null, null, null, null);
        }

        /** Minutes of {@code overtimeMinutes} that count as overtime under these rules. */
        public int counted(int overtimeMinutes) {
            return countedMinutes(overtimeMinutes, countsAfterMinutes);
        }
    }

    /** Counted minutes: all of them without a rule, else only the part past {@code countsAfter}. */
    public static int countedMinutes(int overtimeMinutes, Integer countsAfter) {
        if (countsAfter == null || countsAfter <= 0) return overtimeMinutes;
        return Math.max(0, overtimeMinutes - countsAfter);
    }

    private final JdbcTemplate jdbc;

    public OvertimeRules(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * True when the table and every column this class reads exist (a catalog read; never fails). Public: the
     * overtime controller calls it through this bean's proxy.
     */
    public boolean tableReady() {
        Integer n = jdbc.queryForObject("""
                SELECT count(*) FROM pg_attribute
                 WHERE attrelid = to_regclass('attendance.overtime_rules') AND attnum > 0 AND NOT attisdropped
                   AND attname IN ('tenant_id', 'company_id', 'counts_after_minutes', 'monthly_cap_minutes',
                                   'updated_by_name', 'updated_at')
                """, Integer.class);
        return n != null && n == 6;
    }

    /**
     * True when some company in this tenant has a "counts after" rule, so the
     * overtime list must apply it. False without the table: the list is then
     * exactly today's.
     */
    @Transactional(readOnly = true)
    public boolean countsAfterInUse(UUID tenantId) {
        if (!tableReady()) return false;
        Boolean any = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM attendance.overtime_rules WHERE tenant_id = ? AND counts_after_minutes > 0)",
                Boolean.class, tenantId);
        return Boolean.TRUE.equals(any);
    }

    /** The rules for a company, or none: never fails on a missing table (decisions read it mid-transaction). */
    @Transactional(readOnly = true)
    public Rules forCompany(UUID tenantId, UUID companyId) {
        if (companyId == null || !tableReady()) return Rules.none(companyId);
        List<Rules> rows = jdbc.query("""
                SELECT company_id, counts_after_minutes, monthly_cap_minutes, updated_by_name, updated_at
                  FROM attendance.overtime_rules WHERE tenant_id = ? AND company_id = ?
                """, (rs, i) -> map(rs), tenantId, companyId);
        return rows.isEmpty() ? Rules.none(companyId) : rows.get(0);
    }

    /** GET: the company's rules (nulls when never set). FEATURE_NOT_READY while the table is missing. */
    @Transactional(readOnly = true)
    public Rules get(UUID companyId) {
        UUID tenantId = TenantContext.requireTenantId();
        requireCompany(tenantId, companyId);
        List<Rules> rows = FeatureNotReady.guard(() -> jdbc.query("""
                SELECT company_id, counts_after_minutes, monthly_cap_minutes, updated_by_name, updated_at
                  FROM attendance.overtime_rules WHERE tenant_id = ? AND company_id = ?
                """, (rs, i) -> map(rs), tenantId, companyId));
        return rows.isEmpty() ? Rules.none(companyId) : rows.get(0);
    }

    /**
     * PUT: saves both values (null clears one). Clearing both keeps the row, so
     * "who last changed them" stays, and gives today's behaviour again.
     */
    @Transactional
    public Rules save(UUID companyId, Integer countsAfterMinutes, Integer monthlyCapMinutes, UUID userId, String userName) {
        UUID tenantId = TenantContext.requireTenantId();
        requireCompany(tenantId, companyId);
        validate(countsAfterMinutes, monthlyCapMinutes);
        String name = userName == null ? null : userName.length() > 200 ? userName.substring(0, 200) : userName;
        FeatureNotReady.run(() -> jdbc.update("""
                INSERT INTO attendance.overtime_rules
                    (tenant_id, company_id, counts_after_minutes, monthly_cap_minutes, updated_by_user_id, updated_by_name, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, now())
                ON CONFLICT (tenant_id, company_id) DO UPDATE
                   SET counts_after_minutes = EXCLUDED.counts_after_minutes,
                       monthly_cap_minutes  = EXCLUDED.monthly_cap_minutes,
                       updated_by_user_id   = EXCLUDED.updated_by_user_id,
                       updated_by_name      = EXCLUDED.updated_by_name,
                       updated_at           = now()
                """, tenantId, companyId, countsAfterMinutes, monthlyCapMinutes, userId, name));
        return get(companyId);
    }

    static void validate(Integer countsAfterMinutes, Integer monthlyCapMinutes) {
        if (countsAfterMinutes != null && (countsAfterMinutes < 0 || countsAfterMinutes > MAX_COUNTS_AFTER)) {
            throw new BusinessRuleException(
                    "Overtime can start counting from 0 to " + MAX_COUNTS_AFTER + " minutes after the shift.",
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
        return new Rules(rs.getObject("company_id", UUID.class),
                (Integer) rs.getObject("counts_after_minutes"),
                (Integer) rs.getObject("monthly_cap_minutes"),
                rs.getString("updated_by_name"),
                at == null ? null : at.toInstant());
    }
}
