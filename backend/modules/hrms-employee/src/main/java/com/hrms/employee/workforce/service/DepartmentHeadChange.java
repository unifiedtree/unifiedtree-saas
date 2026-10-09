package com.hrms.employee.workforce.service;

import com.hrms.employee.workforce.entity.WorkforceEmployee;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * What a new department head means for the people in it. A new hire with no
 * manager picked reports to the department head (WorkforceEmployeeService), and
 * that head is copied onto their record. Without this, giving the department a
 * new head left everyone still reporting to the old one, so their leave and WFH
 * requests kept going to someone who no longer runs the team.
 *
 * <p>Every place that changes a head calls {@link #moveReports}: Organization
 * setup (DepartmentService), the phone's department screen and Users &amp; access
 * when someone is made a department manager.
 */
public final class DepartmentHeadChange {

    private DepartmentHeadChange() {}

    /**
     * Point the department's people who report to {@code oldHead} at
     * {@code newHead}, leaving out the new head themself, people who have
     * left, and anyone the new head already reports up to (they would end up
     * reporting to each other). Nothing happens when either head is missing,
     * they are the same person (clearing a head keeps everyone's manager as it
     * is), or the new head no longer works here: the rule a hand-picked manager
     * must meet (WorkforceEmployeeService.checkManager).
     *
     * @return how many people now report to the new head
     */
    public static int moveReports(JdbcTemplate jdbc, UUID departmentId, UUID oldHead, UUID newHead) {
        if (departmentId == null || oldHead == null || newHead == null || oldHead.equals(newHead)) return 0;
        WorkforceEmployee head = find(jdbc, newHead);
        if (head == null || !WorkforceEmployeeService.inWorkspace(head) || !WorkforceEmployeeService.stillWorksHere(head)) return 0;
        Set<UUID> above = WorkforceEmployeeService.reportsUpTo(head, id -> {
            WorkforceEmployee p = find(jdbc, id);
            return p == null ? null : p.getReportingManagerId();
        });
        List<Object> args = new ArrayList<>(List.of(newHead, departmentId, oldHead, newHead));
        args.addAll(above);
        return jdbc.update("""
                UPDATE hrms.employees
                   SET reporting_manager_id = ?, version = version + 1
                 WHERE department_id = ? AND reporting_manager_id = ? AND id <> ?
                   AND employment_status NOT IN ('EXITED', 'TERMINATED')
                """ + (above.isEmpty() ? "" : "   AND id NOT IN (" + String.join(",", Collections.nCopies(above.size(), "?")) + ")"),
                args.toArray());
    }

    /** What the move needs to know about someone, or null when nobody has this id. */
    private static WorkforceEmployee find(JdbcTemplate jdbc, UUID id) {
        List<WorkforceEmployee> rows = jdbc.query(
                "SELECT tenant_id, is_active, employment_status, reporting_manager_id FROM hrms.employees WHERE id = ?",
                (rs, n) -> {
                    WorkforceEmployee e = new WorkforceEmployee();
                    e.setTenantId(rs.getObject("tenant_id", UUID.class));
                    e.setActive(rs.getBoolean("is_active"));
                    e.setEmploymentStatus(WorkforceEmployee.EmploymentStatus.valueOf(rs.getString("employment_status")));
                    e.setReportingManagerId(rs.getObject("reporting_manager_id", UUID.class));
                    return e;
                }, id);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
