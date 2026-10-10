package com.hrms.api.roster;

import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Who may plan which roster (D-S1, design §1.5 "Planner scope"): HR/Admin plan any roster of the
 * company; a department head plans only the departments they head, with only their people, and
 * can't publish; a department head who heads nothing, and an employee, are refused (403
 * ROSTER_SCOPE).
 */
class PlannerScopeServiceTest {

    static final UUID TENANT = UUID.randomUUID(), COMPANY = UUID.randomUUID(), OTHER_COMPANY = UUID.randomUUID();
    static final UUID SALES = UUID.randomUUID(), SUPPORT = UUID.randomUUID(), HVAC = UUID.randomUUID();
    static final UUID OWNER = UUID.randomUUID(), HR = UUID.randomUUID(), HEAD1 = UUID.randomUUID(), HEAD2 = UUID.randomUUID(),
            MGR = UUID.randomUUID(), EMP = UUID.randomUUID();
    static final UUID IN_SALES = UUID.randomUUID(), IN_SUPPORT = UUID.randomUUID(), IN_HVAC = UUID.randomUUID(), NOWHERE = UUID.randomUUID();

    /** The database: who is in which company and department, and who heads what. */
    final Map<UUID, Set<UUID>> heads = new HashMap<>();
    final Map<UUID, PlannerScopeService.Person> people = new HashMap<>();
    final PlannerScopeService scope = new PlannerScopeService(null) {
        @Override boolean companyKnown(UUID tenant, UUID companyId) {
            return COMPANY.equals(companyId) || OTHER_COMPANY.equals(companyId);
        }

        @Override Me me(UUID tenant, UUID employeeId) {
            return new Me(COMPANY, "Person " + employeeId.toString().substring(0, 4));
        }

        @Override Set<UUID> headedDepartments(UUID tenant, UUID companyId, UUID employeeId) {
            return COMPANY.equals(companyId) ? heads.getOrDefault(employeeId, Set.of()) : Set.of();
        }

        @Override Map<UUID, Person> people(UUID tenant, List<UUID> ids) {
            Map<UUID, Person> out = new HashMap<>();
            for (UUID id : ids) if (people.containsKey(id)) out.put(id, people.get(id));
            return out;
        }
    };

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        heads.put(HEAD1, Set.of(SALES));
        heads.put(HEAD2, new LinkedHashSet<>(List.of(SALES, SUPPORT)));
        people.put(IN_SALES, new PlannerScopeService.Person(SALES, "Ravi Kumar"));
        people.put(IN_SUPPORT, new PlannerScopeService.Person(SUPPORT, "Sita Rao"));
        people.put(IN_HVAC, new PlannerScopeService.Person(HVAC, "Arun Das"));
        people.put(NOWHERE, new PlannerScopeService.Person(null, "Meera N"));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        CompanyContext.clear();
    }

    static Jwt jwt(UUID employee, String... permissions) {
        return RosterFakes.jwt(UUID.randomUUID(), employee, permissions);
    }

    static final String[] OWNER_PERMS = {RosterAuth.PLAN, RosterAuth.PUBLISH, RosterAuth.WORKFORCE_ADMIN, RosterAuth.POLICY_MANAGE};
    static final String[] DEPT_MANAGER_PERMS = {RosterAuth.PLAN, "attendance.team.read"};

    @Test
    void theOwnerAndHrPlanEveryRosterOfTheCompanyAndPublish() {
        for (UUID who : List.of(OWNER, HR)) {
            Actor a = scope.actor(jwt(who, OWNER_PERMS), COMPANY);
            assertTrue(a.companyWide());
            assertTrue(a.canPublish());
            assertEquals(COMPANY, a.companyId());
            assertEquals(who, a.employeeId());
            assertTrue(a.headedDepartmentIds().isEmpty());
            assertDoesNotThrow(() -> scope.check(a, null, List.of(IN_SALES, IN_HVAC, NOWHERE)));
            assertDoesNotThrow(() -> scope.check(a, HVAC, List.of(IN_SALES)));
            assertTrue(PlannerScopeService.covers(a, null));
            assertTrue(PlannerScopeService.covers(a, HVAC));
        }
    }

    @Test
    void aDepartmentHeadPlansOnlyTheirDepartmentAndItsPeople() {
        Actor a = scope.actor(jwt(HEAD1, DEPT_MANAGER_PERMS), COMPANY);
        assertFalse(a.companyWide());
        assertFalse(a.canPublish(), "only HR/Admin publish");
        assertEquals(Set.of(SALES), a.headedDepartmentIds());
        assertDoesNotThrow(() -> scope.check(a, SALES, List.of(IN_SALES)));
        assertTrue(PlannerScopeService.covers(a, SALES));
        assertFalse(PlannerScopeService.covers(a, null), "company-wide rosters are HR's");
        assertFalse(PlannerScopeService.covers(a, SUPPORT));

        HrmsException noDept = assertThrows(HrmsException.class, () -> scope.check(a, null, List.of(IN_SALES)));
        assertEquals("ROSTER_SCOPE", noDept.getErrorCode());
        assertEquals(403, noDept.getStatus().value());
        HrmsException otherDept = assertThrows(HrmsException.class, () -> scope.check(a, SUPPORT, List.of()));
        assertEquals("ROSTER_SCOPE", otherDept.getErrorCode());
        HrmsException outsider = assertThrows(HrmsException.class, () -> scope.check(a, SALES, List.of(IN_SALES, IN_HVAC)));
        assertEquals("ROSTER_SCOPE", outsider.getErrorCode(), "E5: someone outside the departments they head");
        assertEquals("Arun Das is outside the departments you head. Only HR can plan them.", outsider.getMessage());
        HrmsException several = assertThrows(HrmsException.class, () -> scope.check(a, SALES, List.of(IN_SUPPORT, IN_HVAC, NOWHERE)));
        assertEquals("Sita Rao and 2 others are outside the departments you head. Only HR can plan them.", several.getMessage());
        HrmsException unknown = assertThrows(HrmsException.class, () -> scope.check(a, SALES, List.of(UUID.randomUUID())));
        assertEquals("ROSTER_SCOPE", unknown.getErrorCode());
    }

    @Test
    void aHeadOfTwoDepartmentsPlansBoth() {
        Actor a = scope.actor(jwt(HEAD2, DEPT_MANAGER_PERMS), COMPANY);
        assertEquals(Set.of(SALES, SUPPORT), a.headedDepartmentIds());
        assertDoesNotThrow(() -> scope.check(a, SUPPORT, List.of(IN_SALES, IN_SUPPORT)));
        assertThrows(HrmsException.class, () -> scope.check(a, HVAC, List.of()));
    }

    @Test
    void aDepartmentManagerWhoHeadsNothingIsToldHrPlans() {
        HrmsException ex = assertThrows(HrmsException.class, () -> scope.actor(jwt(MGR, DEPT_MANAGER_PERMS), COMPANY));
        assertEquals("ROSTER_SCOPE", ex.getErrorCode());
        assertEquals("You don't head a department. HR plans rosters for the company.", ex.getMessage());
        // heading a department of another company doesn't count here
        assertThrows(HrmsException.class, () -> scope.actor(jwt(HEAD1, DEPT_MANAGER_PERMS), OTHER_COMPANY));
    }

    @Test
    void anEmployeeCantPlan() {
        HrmsException ex = assertThrows(HrmsException.class, () -> scope.actor(jwt(EMP, "attendance.checkin.self"), COMPANY));
        assertEquals("ROSTER_SCOPE", ex.getErrorCode());
        assertEquals(403, ex.getStatus().value());
        assertThrows(HrmsException.class, () -> scope.check(null, SALES, List.of()));
    }

    @Test
    void theCompanyIsTheParameterElseTheOneTheRequestRunsInElseTheCallersOwn() {
        assertEquals(OTHER_COMPANY, scope.actor(jwt(OWNER, OWNER_PERMS), OTHER_COMPANY).companyId());
        CompanyContext.setCompanyId(OTHER_COMPANY);
        assertEquals(OTHER_COMPANY, scope.actor(jwt(OWNER, OWNER_PERMS), null).companyId());
        CompanyContext.clear();
        assertEquals(COMPANY, scope.actor(jwt(OWNER, OWNER_PERMS), null).companyId());
        assertThrows(ResourceNotFoundException.class, () -> scope.actor(jwt(OWNER, OWNER_PERMS), UUID.randomUUID()));
        HrmsException none = assertThrows(HrmsException.class, () -> scope.actor(jwt(null, OWNER_PERMS), null));
        assertEquals("COMPANY_REQUIRED", none.getErrorCode());
    }

    @Test
    void publishWithoutPlanStillReadsWithinScope() {
        Actor a = scope.actor(jwt(HR, RosterAuth.PUBLISH, RosterAuth.WORKFORCE_ADMIN), COMPANY);
        assertTrue(a.canPublish());
        assertTrue(a.companyWide());
    }
}
