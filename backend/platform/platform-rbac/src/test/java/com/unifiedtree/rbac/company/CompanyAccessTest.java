package com.unifiedtree.rbac.company;

import com.unifiedtree.rbac.company.CompanyAccess.Grant;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The company-access rules (docs/redesign/COMPANY_ACCESS.md): home company with
 * the person's roles, workspace-wide roles everywhere, grants for the rest.
 */
class CompanyAccessTest {

    private final UUID user = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID companyA = UUID.randomUUID();
    private final UUID companyB = UUID.randomUUID();
    private final UUID companyC = UUID.randomUUID();

    private static RoleRef system(String code) {
        return new RoleRef(UUID.randomUUID(), code, code, true);
    }

    private static RoleRef custom(String code) {
        return new RoleRef(UUID.randomUUID(), code, code, false);
    }

    private Grant grant(UUID company, RoleRef role) {
        return new Grant(company, role, UUID.randomUUID(), OffsetDateTime.now());
    }

    private Profile person(List<RoleRef> roles, List<Grant> grants) {
        return new Profile(user, true, employee, companyA, roles, grants);
    }

    @Test
    void aPersonWithNoGrantsReachesOnlyTheirHomeCompanyWithTheirOwnPermissions() {
        Profile p = person(List.of(system("DEPT_MANAGER")), List.of());
        assertFalse(p.allCompanies());
        assertTrue(p.canAccess(companyA));
        assertFalse(p.canAccess(companyB));
        assertFalse(p.needsScope(companyA), "home company: the session's own permissions");
        assertEquals(Set.of(companyA), p.accessibleCompanyIds());
    }

    @Test
    void aGrantAddsThatCompanyWithTheGrantedRolesOnly() {
        RoleRef manager = system("DEPT_MANAGER");
        RoleRef employeeRole = system("EMPLOYEE");
        Profile p = person(List.of(system("DEPT_MANAGER")),
                List.of(grant(companyB, manager), grant(companyC, employeeRole), grant(companyB, manager)));
        assertTrue(p.canAccess(companyB));
        assertTrue(p.canAccess(companyC));
        assertTrue(p.needsScope(companyB));
        assertEquals(List.of(manager), p.grantedRoles(companyB), "de-duplicated");
        assertEquals(List.of(employeeRole), p.grantedRoles(companyC));
        assertEquals(Set.of(companyA, companyB, companyC), p.accessibleCompanyIds());
    }

    @Test
    void everyWorkspaceWideRoleReachesEveryCompanyWithTheSamePermissions() {
        for (String code : List.of("OWNER", "SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "HR_MANAGER", "FINANCE_LEAD")) {
            Profile p = person(List.of(system("EMPLOYEE"), system(code)), List.of());
            assertTrue(p.allCompanies(), code);
            assertTrue(p.canAccess(companyB), code);
            assertFalse(p.needsScope(companyB), code + ": never a per-company permission set");
            assertNull(p.accessibleCompanyIds(), code);
        }
    }

    @Test
    void theOtherBuiltInRolesAreCompanyScoped() {
        for (String code : List.of("EMPLOYEE", "DEPT_MANAGER", "MANAGER")) {
            assertFalse(person(List.of(system(code)), List.of()).allCompanies(), code);
        }
    }

    @Test
    void aCustomRoleIsCompanyScopedEvenWhenItsCodeLooksLikeAnAdminRole() {
        Profile p = person(List.of(custom("ADMIN"), custom("PAYROLL_OFFICER")), List.of());
        assertFalse(p.workspaceWide());
        assertFalse(p.canAccess(companyB));
    }

    @Test
    void aLoginWithNoEmployeeRecordKeepsEveryCompanyAsBefore() {
        Profile p = new Profile(user, true, null, null, List.of(system("DEPT_MANAGER")), List.of());
        assertTrue(p.allCompanies());
        assertTrue(p.canAccess(companyB));
        assertFalse(p.needsScope(companyB));
    }

    @Test
    void aLoginNotFoundInTheWorkspaceReachesNothing() {
        Profile p = new Profile(user, false, null, null, List.of(), List.of());
        assertFalse(p.allCompanies());
        assertFalse(p.canAccess(companyA));
        assertFalse(p.needsScope(companyA));
        assertEquals(Set.of(), p.accessibleCompanyIds());
    }

    @Test
    void aGrantForTheHomeCompanyNeverReplacesTheHomeRoles() {
        Profile p = person(List.of(system("DEPT_MANAGER")), List.of(grant(companyA, system("EMPLOYEE"))));
        assertFalse(p.needsScope(companyA));
        assertEquals(Set.of(companyA), p.accessibleCompanyIds());
    }

    @Test
    void wholeBusinessRolesAreNotGrantedPerCompany() {
        assertEquals(Set.of("OWNER", "SUPER_ADMIN", "ADMIN"), CompanyAccess.NOT_GRANTABLE_PER_COMPANY);
        assertTrue(CompanyAccess.WORKSPACE_WIDE_ROLES.containsAll(CompanyAccess.NOT_GRANTABLE_PER_COMPANY));
    }

    @Test
    void nullCompanyIsNeverAccessible() {
        assertFalse(person(List.of(), List.of()).canAccess(null));
        assertFalse(person(List.of(), List.of()).needsScope(null));
    }
}
