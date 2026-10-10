package com.hrms.api.attendance;

import com.hrms.attendance.service.EffectiveShiftResolver;
import com.unifiedtree.security.tenant.TenantContext;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * People per shift (BW-32, the design's "People" column and the Shift change
 * page's "41 people"): for one company, how many people are on each shift
 * today.
 *
 * <p>"On a shift today" is the assignment in force today, by the same rule as
 * the team schedule and the overtime list (started on or before today, not
 * ended before it, the latest start wins). "People" are the company's staff who
 * are still employed, the set attendance counts
 * ({@code EmployeeRepository.findActiveByCompany}): everyone except TERMINATED,
 * RESIGNED, RETIRED and EXITED. Read-only.
 */
@Component
public class ShiftHeadcount {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    static final String SQL = """
            SELECT cur.shift_policy_id AS shift_policy_id, count(*) AS people
              FROM hrms.employees e
              JOIN LATERAL (
                    %s
              ) cur ON true
             WHERE e.tenant_id = :tenant AND e.company_id = :company
               AND e.employment_status NOT IN ('TERMINATED', 'RESIGNED', 'RETIRED', 'EXITED')
             GROUP BY cur.shift_policy_id
            """.formatted(EffectiveShiftResolver.scheduleAssignment("e.tenant_id", "e.id", ":today"));

    private final NamedParameterJdbcTemplate jdbc;

    public ShiftHeadcount(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Shift policy id → people on it today, for {@code companyId}. Shifts nobody is on are absent. */
    @Transactional(readOnly = true)
    public Map<UUID, Integer> byShift(UUID companyId) {
        Map<UUID, Integer> out = new HashMap<>();
        if (companyId == null) return out;
        jdbc.query(SQL, Map.of("today", LocalDate.now(IST), "tenant", TenantContext.requireTenantId(), "company", companyId),
                rs -> {
                    UUID shift = rs.getObject("shift_policy_id", UUID.class);
                    if (shift != null) out.put(shift, rs.getInt("people"));
                });
        return out;
    }
}
