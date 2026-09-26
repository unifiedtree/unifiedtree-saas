package com.hrms.api.workforce.search;

import com.hrms.api.workforce.search.GlobalSearchAccess.Reach;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static com.hrms.api.workforce.search.GlobalSearchAccess.reach;
import static org.assertj.core.api.Assertions.assertThat;

/** Which search types reach how far, per role — the same permission each type's own list page needs. */
class GlobalSearchAccessTest {

    /** The EMPLOYEE role's relevant grants (rbac.role_permissions on the demo tenant). */
    static final Set<String> EMPLOYEE = Set.of("hrms.document.read.self", "hrms.expense.claim.self", "hrms.learning.read",
            "hrms.letters.read.self", "hrms.policy.acknowledge.self", "hrms.policy.read", "leave.balance.read",
            "leave.request.self", "payroll.payslip.read.self");
    static final Set<String> MANAGER = union(EMPLOYEE, Set.of("attendance.team.read", "hrms.expense.claim.approve",
            "hrms.hiring.read", "hrms.leave.approve.l1"));
    static final Set<String> HR = union(EMPLOYEE, Set.of("attendance.team.read", "hrms.document.read", "hrms.employee.read",
            "hrms.expense.claim.approve", "hrms.expense.employee.read", "hrms.hiring.offer.read", "hrms.hiring.read",
            "hrms.leave.approve.l1", "hrms.leave.approve.l2", "hrms.leave.employee.read", "hrms.letters.read",
            "hrms.policy.write", "payroll.runs.read"));

    static Set<String> union(Set<String> a, Set<String> b) {
        var s = new java.util.HashSet<>(a);
        s.addAll(b);
        return Set.copyOf(s);
    }

    @Test
    void anEmployeeReachesOnlyTheirOwnRecordsAndPublishedPolicies() {
        assertThat(reach(SearchType.EMPLOYEE, EMPLOYEE, true)).isEqualTo(Reach.NONE);
        for (SearchType t : new SearchType[]{SearchType.LEAVE, SearchType.EXPENSE, SearchType.PAYSLIP, SearchType.DOCUMENT, SearchType.LETTER}) {
            assertThat(reach(t, EMPLOYEE, true)).as(t.key).isEqualTo(Reach.OWN);
        }
        assertThat(reach(SearchType.CANDIDATE, EMPLOYEE, true)).isEqualTo(Reach.NONE);
        assertThat(reach(SearchType.OFFER, EMPLOYEE, true)).isEqualTo(Reach.NONE);
        assertThat(reach(SearchType.JOB, EMPLOYEE, true)).isEqualTo(Reach.NONE);
        assertThat(reach(SearchType.POLICY, EMPLOYEE, true)).isEqualTo(Reach.PUBLISHED);
    }

    @Test
    void withoutAnEmployeeRecordThereIsNothingOfYourOwnToFind() {
        for (SearchType t : new SearchType[]{SearchType.LEAVE, SearchType.EXPENSE, SearchType.PAYSLIP, SearchType.DOCUMENT, SearchType.LETTER}) {
            assertThat(reach(t, EMPLOYEE, false)).as(t.key).isEqualTo(Reach.NONE);
        }
        assertThat(reach(SearchType.POLICY, EMPLOYEE, false)).isEqualTo(Reach.PUBLISHED);
    }

    @Test
    void aManagerReachesTheirTeamsLeaveAndClaimsButNotTheDirectoryOrPayroll() {
        assertThat(reach(SearchType.LEAVE, MANAGER, true)).isEqualTo(Reach.TEAM);
        assertThat(reach(SearchType.EXPENSE, MANAGER, true)).isEqualTo(Reach.TEAM);
        assertThat(reach(SearchType.EMPLOYEE, MANAGER, true)).isEqualTo(Reach.NONE);
        assertThat(reach(SearchType.PAYSLIP, MANAGER, true)).isEqualTo(Reach.OWN);
        assertThat(reach(SearchType.DOCUMENT, MANAGER, true)).isEqualTo(Reach.OWN);
        assertThat(reach(SearchType.CANDIDATE, MANAGER, true)).isEqualTo(Reach.ALL);
        assertThat(reach(SearchType.JOB, MANAGER, true)).isEqualTo(Reach.ALL);
        // Offers carry salary: hiring.read alone is not enough.
        assertThat(reach(SearchType.OFFER, MANAGER, true)).isEqualTo(Reach.NONE);
    }

    @Test
    void hrReachesEveryone() {
        for (SearchType t : SearchType.values()) {
            assertThat(reach(t, HR, true)).as(t.key).isEqualTo(Reach.ALL);
        }
        // "Everyone" doesn't depend on having an employee record.
        assertThat(reach(SearchType.LEAVE, HR, false)).isEqualTo(Reach.ALL);
    }

    @Test
    void policyDraftsNeedTheAuthorPermission() {
        assertThat(reach(SearchType.POLICY, Set.of("hrms.policy.write"), true)).isEqualTo(Reach.NONE);
        assertThat(reach(SearchType.POLICY, Set.of("hrms.policy.write", "hrms.policy.acknowledge.self"), true)).isEqualTo(Reach.ALL);
        assertThat(reach(SearchType.POLICY, Set.of("hrms.policy.acknowledge.self"), true)).isEqualTo(Reach.PUBLISHED);
        assertThat(reach(SearchType.POLICY, Set.of(), true)).isEqualTo(Reach.NONE);
    }

    @Test
    void nothingWithoutPermissions() {
        for (SearchType t : SearchType.values()) {
            assertThat(reach(t, Set.of(), true)).as(t.key).isEqualTo(Reach.NONE);
        }
    }
}
