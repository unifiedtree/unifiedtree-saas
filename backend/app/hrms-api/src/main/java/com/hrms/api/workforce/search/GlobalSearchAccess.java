package com.hrms.api.workforce.search;

import java.util.Set;

/**
 * How far each search type reaches for one caller. Pure, so the rules can be
 * unit-tested without a database.
 *
 * <p>Every rule is the one the type's own list endpoint already applies; search
 * is never looser than the page it links to:
 * <ul>
 *   <li>People: the Workforce Directory's {@code hrms.employee.read}, whole tenant.</li>
 *   <li>Leave, expense claims: the employee workspace rule ({@code EmployeeRecordAccess}):
 *       the "anyone" permission reads everyone, the manager's approval permission
 *       reads their team, otherwise the caller's own.</li>
 *   <li>Payslips: {@code payroll.runs.read} (the run pages) or your own from
 *       {@code payroll.payslip.read.self} (locked and paid runs only).</li>
 *   <li>Documents, letters: the admin read permission, or your own.</li>
 *   <li>Candidates and job openings: {@code hrms.hiring.read}; offers carry salary,
 *       so {@code hrms.hiring.offer.read} only.</li>
 *   <li>Policies: authors see every status, readers only published ones
 *       (PolicyController.listPolicies).</li>
 * </ul>
 * "Own" and "team" need the caller's employee record; without one those types
 * return nothing.
 */
public final class GlobalSearchAccess {

    private GlobalSearchAccess() {}

    public enum Reach { NONE, OWN, TEAM, ALL, PUBLISHED }

    public static Reach reach(SearchType type, Set<String> perms, boolean hasEmployee) {
        return switch (type) {
            case EMPLOYEE -> perms.contains("hrms.employee.read") ? Reach.ALL : Reach.NONE;
            case LEAVE -> anyTeamOwn(perms, hasEmployee, "hrms.leave.employee.read", "hrms.leave.approve.l1",
                    "leave.balance.read", "leave.request.self");
            case EXPENSE -> anyTeamOwn(perms, hasEmployee, "hrms.expense.employee.read", "hrms.expense.claim.approve",
                    "hrms.expense.claim.self");
            case PAYSLIP -> perms.contains("payroll.runs.read") ? Reach.ALL
                    : hasEmployee && perms.contains("payroll.payslip.read.self") ? Reach.OWN : Reach.NONE;
            case DOCUMENT -> perms.contains("hrms.document.read") ? Reach.ALL
                    : hasEmployee && perms.contains("hrms.document.read.self") ? Reach.OWN : Reach.NONE;
            case LETTER -> perms.contains("hrms.letters.read") ? Reach.ALL
                    : hasEmployee && perms.contains("hrms.letters.read.self") ? Reach.OWN : Reach.NONE;
            case CANDIDATE, JOB -> perms.contains("hrms.hiring.read") ? Reach.ALL : Reach.NONE;
            case OFFER -> perms.contains("hrms.hiring.offer.read") ? Reach.ALL : Reach.NONE;
            case POLICY -> {
                boolean reader = perms.contains("hrms.policy.read") || perms.contains("hrms.policy.acknowledge.self");
                yield !reader ? Reach.NONE : perms.contains("hrms.policy.write") ? Reach.ALL : Reach.PUBLISHED;
            }
        };
    }

    private static Reach anyTeamOwn(Set<String> perms, boolean hasEmployee, String anyone, String team, String... self) {
        if (perms.contains(anyone)) return Reach.ALL;
        if (!hasEmployee) return Reach.NONE;
        if (perms.contains(team)) return Reach.TEAM;
        for (String s : self) if (perms.contains(s)) return Reach.OWN;
        return Reach.NONE;
    }
}
