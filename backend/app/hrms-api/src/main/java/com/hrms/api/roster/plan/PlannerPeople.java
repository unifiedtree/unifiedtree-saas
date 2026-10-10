package com.hrms.api.roster.plan;

import com.hrms.api.roster.RosterContract.OtherRoster;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.core.exception.FeatureNotReady;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Array;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The people a roster can plan (endpoint 8, {@code GET /v1/rosters/people}): the company's working people
 * (not exited, terminated, resigned or retired; an active record) who are employed at some point of the period,
 * optionally narrowed to a department and a branch ("Building"), sorted by name. Each comes with the PUBLISHED
 * rosters that already plan them in the period, so the people step can tag them ("On 'October – HVAC',
 * 1–31 Oct"). The caller's own roster is in that list too when it is published; the web leaves it out by id.
 */
@Component
public class PlannerPeople {

    /** Employment statuses that are no longer working (the attendance scope's rule, {@code ShiftHeadcount}). */
    static final String SEPARATED = "('TERMINATED', 'RESIGNED', 'RETIRED', 'EXITED')";

    private final JdbcTemplate jdbc;

    public PlannerPeople(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param departmentIds when not null, only people of these departments (a department planner's own); an
     *                      empty set gives nobody
     */
    @Transactional(readOnly = true)
    public List<PlannerPerson> list(UUID tenantId, UUID companyId, UUID departmentId, UUID branchId,
                                    Set<UUID> departmentIds, LocalDate from, LocalDate to) {
        if (departmentIds != null && departmentIds.isEmpty()) return List.of();
        return FeatureNotReady.guard(() -> {
            Map<UUID, Object[]> rows = new LinkedHashMap<>();
            jdbc.query(con -> {
                var ps = con.prepareStatement("""
                        SELECT e.id, concat_ws(' ', e.first_name, e.last_name) AS name, e.employee_code,
                               e.designation_id, ds.title AS designation_name,
                               e.department_id, dp.name AS department_name,
                               e.branch_id, b.name AS branch_name,
                               e.date_of_joining, e.last_working_day
                          FROM hrms.employees e
                          LEFT JOIN hrms.designations ds ON ds.id = e.designation_id AND ds.tenant_id = e.tenant_id
                          LEFT JOIN hrms.departments dp ON dp.id = e.department_id AND dp.tenant_id = e.tenant_id
                          LEFT JOIN org.branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
                         WHERE e.tenant_id = ? AND e.company_id = ? AND e.is_active = TRUE
                           AND e.employment_status NOT IN %s
                           AND (e.date_of_joining IS NULL OR e.date_of_joining <= ?)
                           AND (e.last_working_day IS NULL OR e.last_working_day >= ?)
                           AND (CAST(? AS uuid) IS NULL OR e.department_id = ?)
                           AND (CAST(? AS uuid) IS NULL OR e.branch_id = ?)
                           AND (CAST(? AS uuid[]) IS NULL OR e.department_id = ANY (?))
                         ORDER BY e.first_name, e.last_name, e.id
                        """.formatted(SEPARATED));
                Array departments = departmentIds == null ? null : con.createArrayOf("uuid", departmentIds.toArray(new UUID[0]));
                ps.setObject(1, tenantId);
                ps.setObject(2, companyId);
                ps.setDate(3, Date.valueOf(to));
                ps.setDate(4, Date.valueOf(from));
                ps.setObject(5, departmentId);
                ps.setObject(6, departmentId);
                ps.setObject(7, branchId);
                ps.setObject(8, branchId);
                ps.setArray(9, departments);
                ps.setArray(10, departments);
                return ps;
            }, (RowCallbackHandler) rs -> {
                Date joined = rs.getDate("date_of_joining"), left = rs.getDate("last_working_day");
                rows.put(rs.getObject("id", UUID.class), new Object[]{rs.getString("name"), rs.getString("employee_code"),
                        rs.getObject("designation_id", UUID.class), rs.getString("designation_name"),
                        rs.getObject("department_id", UUID.class), rs.getString("department_name"),
                        rs.getObject("branch_id", UUID.class), rs.getString("branch_name"),
                        joined == null ? null : joined.toLocalDate(), left == null ? null : left.toLocalDate()});
            });
            Map<UUID, List<OtherRoster>> rosters = rosters(tenantId, new ArrayList<>(rows.keySet()), from, to);
            List<PlannerPerson> out = new ArrayList<>(rows.size());
            rows.forEach((id, r) -> out.add(new PlannerPerson(id, (String) r[0], (String) r[1], (UUID) r[2], (String) r[3],
                    (UUID) r[4], (String) r[5], (UUID) r[6], (String) r[7], (LocalDate) r[8], (LocalDate) r[9],
                    rosters.getOrDefault(id, List.of()))));
            return out;
        });
    }

    /** The published rosters that plan each person on at least one day of {@code from..to}. */
    private Map<UUID, List<OtherRoster>> rosters(UUID tenantId, List<UUID> ids, LocalDate from, LocalDate to) {
        Map<UUID, List<OtherRoster>> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        jdbc.query(con -> {
            var ps = con.prepareStatement("""
                    SELECT DISTINCT sd.employee_id, r.id, r.name, r.start_date, r.end_date
                      FROM attendance.schedule_days sd
                      JOIN attendance.rosters r ON r.id = sd.roster_id AND r.tenant_id = sd.tenant_id
                     WHERE sd.tenant_id = ? AND sd.employee_id = ANY (?) AND sd.work_date BETWEEN ? AND ?
                     ORDER BY sd.employee_id, r.start_date, r.id
                    """);
            ps.setObject(1, tenantId);
            ps.setArray(2, con.createArrayOf("uuid", ids.toArray(new UUID[0])));
            ps.setDate(3, Date.valueOf(from));
            ps.setDate(4, Date.valueOf(to));
            return ps;
        }, (RowCallbackHandler) rs -> out.computeIfAbsent(rs.getObject("employee_id", UUID.class), k -> new ArrayList<>())
                .add(new OtherRoster(rs.getObject("id", UUID.class), rs.getString("name"),
                        rs.getDate("start_date").toLocalDate(), rs.getDate("end_date").toLocalDate())));
        return out;
    }
}
