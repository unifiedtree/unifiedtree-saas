package com.hrms.api.roster;

import java.util.Set;
import java.util.UUID;

/**
 * Who is planning, as {@link PlannerScope#actor} worked it out for one company (design §1.5).
 *
 * @param userId              the signed-in user
 * @param employeeId          their employee record (null for a user with none)
 * @param name                their display name, written to the "who" columns
 * @param companyId           the company the call is about
 * @param companyWide         holds {@code attendance.roster.plan} and {@code attendance.workforce.admin}:
 *                            any roster of the company, any scope
 * @param headedDepartmentIds for a department planner, the active departments of the company they
 *                            head ({@code hrms.departments.department_head_employee_id}); empty when
 *                            {@code companyWide}
 * @param canPublish          holds {@code attendance.roster.publish}
 */
public record Actor(UUID userId, UUID employeeId, String name, UUID companyId,
                    boolean companyWide, Set<UUID> headedDepartmentIds, boolean canPublish) {}
