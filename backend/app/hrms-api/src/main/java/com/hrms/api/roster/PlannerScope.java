package com.hrms.api.roster;

import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Collection;
import java.util.UUID;

/**
 * Who may plan which roster (D-S1, design §1.5 "Planner scope"). Every roster endpoint asks this
 * first. Implemented by package A ({@code PlannerScopeService}).
 */
public interface PlannerScope {

    /**
     * The caller as a planner of {@code companyId}. Refuses with 403 {@code ROSTER_SCOPE} when they
     * can't plan there (no {@code attendance.roster.plan}, or a department planner who heads no
     * department of the company).
     */
    Actor actor(Jwt jwt, UUID companyId);

    /**
     * Refuses with 403 {@code ROSTER_SCOPE} (check E5) when a department planner works on a roster
     * outside the departments they head, or with people outside them. A company-wide planner passes.
     */
    void check(Actor a, UUID departmentId, Collection<UUID> employeeIds);
}
