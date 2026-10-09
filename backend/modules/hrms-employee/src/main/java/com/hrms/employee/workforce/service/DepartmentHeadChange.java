package com.hrms.employee.workforce.service;

import org.springframework.jdbc.core.JdbcTemplate;

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
     * {@code newHead}, leaving out the new head themself and people who have
     * left. Nothing happens when either head is missing or they are the same
     * person (clearing a head keeps everyone's manager as it is).
     *
     * @return how many people now report to the new head
     */
    public static int moveReports(JdbcTemplate jdbc, UUID departmentId, UUID oldHead, UUID newHead) {
        if (departmentId == null || oldHead == null || newHead == null || oldHead.equals(newHead)) return 0;
        return jdbc.update("""
                UPDATE hrms.employees
                   SET reporting_manager_id = ?, version = version + 1
                 WHERE department_id = ? AND reporting_manager_id = ? AND id <> ?
                   AND employment_status NOT IN ('EXITED', 'TERMINATED')
                """, newHead, departmentId, oldHead, newHead);
    }
}
