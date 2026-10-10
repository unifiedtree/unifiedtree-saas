package com.hrms.api.roster.plan;

import com.hrms.api.roster.Actor;
import com.hrms.api.roster.PlannerScope;
import com.hrms.api.roster.RosterContract.IssueId;
import com.hrms.api.roster.RosterContract.MemberIn;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PlanResponse;
import com.hrms.api.roster.RosterContract.PlannerPerson;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static com.hrms.api.roster.plan.PlanFixture.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Endpoints 8 and 9 with a fake planner scope and fake facts: the preview loads the facts from the day before
 * the period, plans with the caller's scope (E5), and refuses a department planner outside their departments.
 */
class RosterPlanningControllerTest {

    private static final LocalDate OCT1 = LocalDate.of(2026, 10, 1), OCT31 = LocalDate.of(2026, 10, 31);
    private final UUID tenant = UUID.randomUUID();
    private final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString()).build();
    private final PlanFixture fx = new PlanFixture();

    private Actor actor;
    private final List<Object[]> loads = new ArrayList<>();
    private final List<Object[]> checks = new ArrayList<>();
    private final List<Object[]> lists = new ArrayList<>();

    private final PlannerScope scope = new PlannerScope() {
        @Override public Actor actor(Jwt j, UUID companyId) {
            if (actor == null) throw new HrmsException("You can't plan rosters here.", HttpStatus.FORBIDDEN, "ROSTER_SCOPE");
            return actor;
        }
        @Override public void check(Actor a, UUID departmentId, Collection<UUID> employeeIds) {
            checks.add(new Object[]{departmentId, employeeIds});
            if (!a.companyWide() && (departmentId == null || !a.headedDepartmentIds().contains(departmentId))) {
                throw new HrmsException("Only HR can plan people outside your department.", HttpStatus.FORBIDDEN, "ROSTER_SCOPE");
            }
        }
    };

    private final PlanFactsLoader loader = (tenantId, companyId, rosterId, employeeIds, from, to) -> {
        loads.add(new Object[]{tenantId, companyId, rosterId, List.copyOf(employeeIds), from, to});
        return fx.facts();
    };

    private final PlannerPeople people = new PlannerPeople(null) {
        @Override public List<PlannerPerson> list(UUID tenantId, UUID companyId, UUID departmentId, UUID branchId,
                                                  Set<UUID> departmentIds, LocalDate from, LocalDate to) {
            lists.add(new Object[]{tenantId, companyId, departmentId, branchId, departmentIds, from, to});
            return List.of();
        }
    };

    private RosterPlanningController controller(PlannerScope s) {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        if (s != null) beans.addBean("plannerScope", s);
        return new RosterPlanningController(beans.getBeanProvider(PlannerScope.class), loader, people);
    }

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private PlanRequest request(UUID department, UUID... members) {
        List<MemberIn> list = new ArrayList<>();
        for (UUID m : members) list.add(new MemberIn(m, -1));
        return new PlanRequest(OCT1, OCT31, department, null, UUID.randomUUID(),
                config(fx.pattern("A A B B C C WO"), WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD), list, List.of(),
                List.of(), true, true);
    }

    @Test
    void thePreviewLoadsTheFactsFromTheDayBeforeAndPlans() {
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "HR", COMPANY, true, Set.of(), true);
        UUID a = fx.person("A1", TECH), b = fx.person("A2", TECH);
        PlanRequest in = request(null, a, b, a);
        PlanResponse out = controller(scope).preview(jwt, COMPANY, in);
        assertEquals(1, loads.size());
        Object[] load = loads.get(0);
        assertEquals(tenant, load[0]);
        assertEquals(COMPANY, load[1]);
        assertEquals(in.rosterId(), load[2], "its own published days are not another roster's");
        assertEquals(List.of(a, b), load[3], "each member once");
        assertEquals(OCT1.minusDays(1), load[4], "from the day before, for the rest check");
        assertEquals(OCT31, load[5]);
        assertEquals(2, out.rows().size());
        assertEquals(List.of(0, 3), out.members().stream().map(MemberIn::rotationOffset).toList());
        assertTrue(checks.isEmpty(), "a company-wide planner needs no department check");
    }

    @Test
    void aDepartmentPlannerSeesPeopleOutsideTheirDepartmentAsE5() {
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(DEPT), false);
        UUID mine = fx.person("Mine", TECH, DEPT, null, null, null), theirs = fx.person("Theirs", TECH, DEPT_2, null, null, null);
        PlanResponse out = controller(scope).preview(jwt, COMPANY, request(DEPT, mine, theirs));
        assertEquals(List.of(theirs), out.checks().errors().stream().filter(i -> i.id() == IssueId.E5).map(i -> i.employeeId()).toList());
        assertEquals(DEPT, checks.get(0)[0]);
    }

    @Test
    void aDepartmentPlannerCannotPreviewAnotherDepartmentOrTheWholeCompany() {
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(DEPT), false);
        RosterPlanningController c = controller(scope);
        HrmsException other = assertThrows(HrmsException.class, () -> c.preview(jwt, COMPANY, request(DEPT_2)));
        assertEquals("ROSTER_SCOPE", other.getErrorCode());
        assertThrows(HrmsException.class, () -> c.preview(jwt, COMPANY, request(null)));
        assertTrue(loads.isEmpty(), "nothing is loaded for a refused preview");
    }

    @Test
    void someoneWhoCannotPlanHereIsRefused() {
        actor = null;
        HrmsException e = assertThrows(HrmsException.class, () -> controller(scope).preview(jwt, COMPANY, request(null)));
        assertEquals("ROSTER_SCOPE", e.getErrorCode());
    }

    @Test
    void aBadPeriodIsRefusedBeforeAnythingIsLoaded() {
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "HR", COMPANY, true, Set.of(), true);
        PlanRequest tooLong = new PlanRequest(OCT1, OCT1.plusDays(62), null, null, null, null, List.of(), List.of(),
                List.of(), true, true);
        HrmsException e = assertThrows(HrmsException.class, () -> controller(scope).preview(jwt, COMPANY, tooLong));
        assertEquals("ROSTER_RANGE_INVALID", e.getErrorCode());
        assertTrue(loads.isEmpty());
        assertThrows(HrmsException.class, () -> controller(scope).people(jwt, COMPANY, null, null, OCT31, OCT1));
    }

    @Test
    void withoutThePlannerScopeBuiltYetTheEndpointsAreNotSwitchedOn() {
        assertThrows(FeatureNotReady.class, () -> controller(null).preview(jwt, COMPANY, request(null)));
        assertThrows(FeatureNotReady.class, () -> controller(null).people(jwt, COMPANY, null, null, OCT1, OCT31));
    }

    @Test
    void peopleForACompanyWidePlannerAreTheWholeScope() {
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "HR", COMPANY, true, Set.of(), true);
        controller(scope).people(jwt, COMPANY, DEPT, BRANCH, OCT1, OCT31);
        Object[] call = lists.get(0);
        assertEquals(List.of(tenant, COMPANY, DEPT, BRANCH), List.of(call[0], call[1], call[2], call[3]));
        assertNull(call[4], "no department limit");
        assertEquals(List.of(OCT1, OCT31), List.of(call[5], call[6]));
    }

    @Test
    void peopleForADepartmentPlannerAreTheirDepartmentsOnly() {
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(DEPT, DEPT_2), false);
        RosterPlanningController c = controller(scope);
        c.people(jwt, COMPANY, null, null, OCT1, OCT31);
        assertEquals(Set.of(DEPT, DEPT_2), lists.get(0)[4]);
        assertTrue(checks.isEmpty());
        c.people(jwt, COMPANY, DEPT, null, OCT1, OCT31);
        assertEquals(DEPT, checks.get(0)[0]);
        actor = new Actor(UUID.randomUUID(), UUID.randomUUID(), "Head", COMPANY, false, Set.of(DEPT), false);
        assertThrows(HrmsException.class, () -> c.people(jwt, COMPANY, DEPT_2, null, OCT1, OCT31));
    }
}
