package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.employee.entity.Employee;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The company's holidays in the window, as the holiday list shows them today
 * ({@code GET /v1/settings/holidays}, open to anyone signed in): name, type and,
 * for a branch holiday, the branches it is for. Nothing here changes who gets
 * the day off (DECISIONS 16).
 */
@Component
class HolidaysSource implements AroundSource {

    /** The holiday list's own labels (HolidayCalendar.tsx), as "… holiday". */
    static final Map<String, String> TYPE_LABELS = Map.of(
            "NATIONAL", "National holiday",
            "FESTIVAL", "Festival holiday",
            "RESTRICTED", "Restricted holiday",
            "REGIONAL", "Regional holiday",
            "OPTIONAL", "Optional holiday",
            "COMPANY", "Company holiday");

    private final JdbcTemplate jdbc;

    HolidaysSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "HOLIDAY"; }
    @Override public String module() { return null; }
    @Override public boolean allowed(EssCaller caller) { return true; }

    @Override
    public List<AroundItem> load(EssCaller caller, Employee me, LocalDate from, LocalDate to) {
        return jdbc.query("""
                SELECT h.id, h.holiday_date, h.holiday_name, h.holiday_type,
                       (SELECT string_agg(b.name, ', ' ORDER BY b.name)
                          FROM settings.holiday_branches hb
                          JOIN org.branches b ON b.id = hb.branch_id AND b.tenant_id = hb.tenant_id
                         WHERE hb.holiday_id = h.id AND hb.tenant_id = h.tenant_id) AS branches
                  FROM settings.holiday_calendar h
                 WHERE h.tenant_id = ? AND h.company_id = ? AND h.is_active
                   AND h.holiday_date BETWEEN ? AND ?
                 ORDER BY h.holiday_date, h.holiday_name
                """, (rs, i) -> {
                    String type = rs.getString("holiday_type");
                    String branches = rs.getString("branches");
                    String label = TYPE_LABELS.getOrDefault(type, "Holiday");
                    return new AroundItem("HOLIDAY", rs.getObject("holiday_date", LocalDate.class), "ON",
                            rs.getString("holiday_name"), branches == null || branches.isBlank() ? label : label + " · " + branches,
                            type, rs.getObject("id", UUID.class), null, null, null, "/hrms/leave?tab=holidays");
                }, caller.tenantId(), me.getCompanyId(), from, to);
    }
}
