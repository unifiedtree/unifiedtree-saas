package com.unifiedtree.rbac.company;

import com.unifiedtree.rbac.company.CompanyAccess.Grant;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyAccessView;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyEntry;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.security.PermissionOverrides;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A person's permissions in a granted company, and the company list the
 * selector shows (home first, roles per company, archived ones only for admins).
 */
class CompanyAccessServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID companyA = UUID.randomUUID();   // home
    private final UUID companyB = UUID.randomUUID();   // granted
    private final UUID companyC = UUID.randomUUID();   // no access
    private final UUID companyD = UUID.randomUUID();   // granted, archived
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final RolePermissionRepository rolePerms = mock(RolePermissionRepository.class);
    private final EmployeeBaselinePermissions baseline = mock(EmployeeBaselinePermissions.class);
    private final PermissionOverrides overrides = mock(PermissionOverrides.class);
    private final CompanyAccessService service = new CompanyAccessService(jdbc, rolePerms, baseline, overrides, true);

    private final RoleRef deptManager = new RoleRef(UUID.randomUUID(), "DEPT_MANAGER", "Dept Manager", true);
    private final RoleRef employeeRole = new RoleRef(UUID.randomUUID(), "EMPLOYEE", "Employee", true);

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
        // Sorted by name as the query does: Alpha (home), Beta (granted), Gamma (no access), Zeta (granted, archived).
        when(jdbc.queryForList(contains("FROM org.companies ORDER BY"))).thenReturn(List.of(
                company(companyA, "Alpha", true), company(companyB, "Beta", true),
                company(companyC, "Gamma", true), company(companyD, "Zeta", false)));
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        CompanyContext.clear();
    }

    private static Map<String, Object> company(UUID id, String name, boolean active) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("logo_url", null);
        m.put("is_active", active);
        return m;
    }

    private Profile manager() {
        return new Profile(user, true, employee, companyA, List.of(deptManager),
                List.of(new Grant(companyB, employeeRole, UUID.randomUUID(), OffsetDateTime.now()),
                        new Grant(companyD, deptManager, UUID.randomUUID(), OffsetDateTime.now())));
    }

    // ── permissions in a granted company ────────────────────────────────────

    @Test
    void aGrantedCompanysPermissionsAreItsRolesPlusTheBaselineMinusDenies() {
        when(rolePerms.findPermissionCodesByRoleIds(Set.of(employeeRole.id()))).thenReturn(List.of("leave.request.self", "org.company.read"));
        when(baseline.effectiveFor(anyCollection(), eq(employee)))
                .thenAnswer(inv -> {
                    java.util.TreeSet<String> s = new java.util.TreeSet<>(inv.<java.util.Collection<String>>getArgument(0));
                    s.add("attendance.checkin.self");
                    return List.copyOf(s);
                });
        when(overrides.activeFor(user)).thenReturn(List.of(
                new PermissionOverrides.Override("org.company.read", "DENY", null),
                new PermissionOverrides.Override("hrms.employee.read", "GRANT", null)));

        CompanyContext.Scope scope = service.scope(manager(), companyB);
        assertNotNull(scope);
        assertEquals(companyB, scope.companyId());
        assertEquals(List.of("EMPLOYEE"), scope.roleCodes());
        assertEquals(Set.of(employeeRole.id()), scope.roleIds());
        assertEquals(Set.of("leave.request.self", "attendance.checkin.self"), scope.permissions(),
                "baseline kept, the DENY applies, the personal GRANT stays with the home company");
    }

    @Test
    void theHomeCompanyAndInaccessibleCompaniesHaveNoScope() {
        assertNull(service.scope(manager(), companyA));
        assertNull(service.scope(manager(), companyC));
        verifyNoInteractions(rolePerms);
    }

    // ── the company list ────────────────────────────────────────────────────

    @Test
    void aCompanyScopedPersonSeesHomeFirstThenTheirGrantsWithTheirRoleInEach() {
        CompanyAccessView v = service.view(manager(), false);
        assertFalse(v.allCompanies());
        assertEquals(companyA, v.homeCompanyId());
        assertEquals(List.of(companyA, companyB), v.companies().stream().map(CompanyEntry::companyId).toList(),
                "no access to Gamma; Zeta is archived");
        CompanyEntry home = v.companies().get(0);
        assertTrue(home.home());
        assertEquals("HOME", home.access());
        assertEquals(List.of("DEPT_MANAGER"), home.roles().stream().map(CompanyAccessService.RoleEntry::code).toList());
        assertEquals("ROLES", home.roles().get(0).source());
        CompanyEntry beta = v.companies().get(1);
        assertEquals("GRANT", beta.access());
        assertEquals("EMPLOYEE", beta.roles().get(0).code());
        assertEquals("GRANT", beta.roles().get(0).source());
        assertNotNull(beta.roles().get(0).grantedAt());
    }

    @Test
    void theAdminViewAlsoListsArchivedCompaniesTheyHoldAccessTo() {
        CompanyAccessView v = service.view(manager(), true);
        assertEquals(List.of(companyA, companyB, companyD), v.companies().stream().map(CompanyEntry::companyId).toList());
        assertFalse(v.companies().get(2).active());
    }

    @Test
    void anAllCompaniesPersonSeesEveryActiveCompanyWithTheirRoles() {
        RoleRef owner = new RoleRef(UUID.randomUUID(), "OWNER", "Owner", true);
        Profile p = new Profile(user, true, employee, companyB, List.of(owner), List.of());
        CompanyAccessView v = service.view(p, false);
        assertTrue(v.allCompanies());
        assertEquals(List.of(companyB, companyA, companyC), v.companies().stream().map(CompanyEntry::companyId).toList(),
                "home first, then by name");
        assertTrue(v.companies().stream().allMatch(c -> c.access().equals("WORKSPACE")));
        assertTrue(v.companies().stream().allMatch(c -> c.roles().get(0).code().equals("OWNER")));
    }

    // ── the current company and list narrowing ──────────────────────────────

    @Test
    void theCurrentCompanyIsTheSelectedOneElseHome() {
        stubProfileQueries(companyA);
        assertEquals(companyA, service.currentCompanyId());
        CompanyContext.setCompanyId(companyB);
        assertEquals(companyB, service.currentCompanyId());
    }

    @Test
    void listsAreNarrowedOnlyForCompanyScopedPeopleAndNotWithTheKillSwitch() {
        stubProfileQueries(companyA);
        assertEquals(Set.of(companyA), service.accessibleCompanyIds());
        CompanyAccessService off = new CompanyAccessService(jdbc, rolePerms, baseline, overrides, false);
        assertNull(off.accessibleCompanyIds());
        TenantContext.clear();
        assertNull(service.accessibleCompanyIds(), "no signed-in workspace user: no narrowing");
    }

    @Test
    void beforeTheMigrationEveryoneHasNoGrantsAndNothingFails() {
        stubProfileQueries(companyA);
        Profile p = service.profile(user);
        assertTrue(p.grants().isEmpty());
        assertFalse(service.tableReady());
        assertEquals(List.of(), service.listGrants(null));
        verify(jdbc, never()).query(contains("rbac.user_company_access"), any(org.springframework.jdbc.core.RowMapper.class), any(Object[].class));
    }

    @Test
    void aGrantOrRevokeDropsThePersonsCachedProfile() {
        stubProfileQueries(companyA);
        service.profile(user);
        service.profile(user);
        verify(jdbc, times(1)).queryForList(contains("FROM auth.user_credentials uc"), eq(user));
        service.revoke(user, companyB, null);
        service.profile(user);
        verify(jdbc, times(2)).queryForList(contains("FROM auth.user_credentials uc"), eq(user));
    }

    @SuppressWarnings("unchecked")
    private void stubProfileQueries(UUID home) {
        Map<String, Object> cred = new HashMap<>();
        cred.put("employee_id", employee);
        cred.put("company_id", home);
        when(jdbc.queryForList(contains("FROM auth.user_credentials uc"), eq(user))).thenReturn(List.of(cred));
        when(jdbc.query(contains("FROM rbac.user_roles"), any(org.springframework.jdbc.core.RowMapper.class), eq(user)))
                .thenReturn(List.of(deptManager));
        when(jdbc.queryForObject(contains("to_regclass('rbac.user_company_access')"), eq(Boolean.class))).thenReturn(false);
    }
}
