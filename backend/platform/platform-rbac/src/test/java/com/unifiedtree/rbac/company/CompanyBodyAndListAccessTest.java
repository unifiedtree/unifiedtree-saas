package com.unifiedtree.rbac.company;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.company.CompanyAccess.Grant;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import com.unifiedtree.rbac.repository.RolePermissionRepository;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.security.PermissionOverrides;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * The checks that close the gaps listed in COMPANY_ACCESS.md "Not enforced yet":
 * a {@code companyId} in a request body, and a list whose optional
 * {@code companyId} was left out.
 */
class CompanyBodyAndListAccessTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID home = UUID.randomUUID();
    private final UUID granted = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();

    private final RoleRef employeeRole = new RoleRef(UUID.randomUUID(), "EMPLOYEE", "Employee", true);
    private final RoleRef deptManager = new RoleRef(UUID.randomUUID(), "DEPT_MANAGER", "Dept Manager", true);
    private final RoleRef hrManager = new RoleRef(UUID.randomUUID(), "HR_MANAGER", "HR Manager", true);

    private CompanyAccessService service;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
        service = spy(new CompanyAccessService(mock(JdbcTemplate.class), mock(RolePermissionRepository.class),
                mock(EmployeeBaselinePermissions.class), mock(PermissionOverrides.class), true));
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        CompanyContext.clear();
    }

    private Profile scoped() {
        return new Profile(user, true, UUID.randomUUID(), home, List.of(deptManager),
                List.of(new Grant(granted, employeeRole, UUID.randomUUID(), OffsetDateTime.now())));
    }

    private Profile workspaceWide() {
        return new Profile(user, true, UUID.randomUUID(), home, List.of(hrManager), List.of());
    }

    private Profile noEmployeeRecord() {
        return new Profile(user, true, null, null, List.of(employeeRole), List.of());
    }

    private CompanyContext.Scope scopeIn(UUID company) {
        return new CompanyContext.Scope(company, Set.of(employeeRole.id()), List.of("EMPLOYEE"), Set.of("leave.request.self"));
    }

    private static void assertDenied(Runnable r) {
        HrmsException e = assertThrows(HrmsException.class, r::run);
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("COMPANY_ACCESS_DENIED", e.getErrorCode());
    }

    // ── a companyId in the body ─────────────────────────────────────────────

    @Test
    void aCompanyScopedPersonWritesOnlyInTheCompanyTheRequestRunsIn() {
        // No header: the request runs with their home roles, so only the home company.
        assertDoesNotThrow(() -> CompanyAccessService.checkBodyCompany(scoped(), home, null));
        assertDenied(() -> CompanyAccessService.checkBodyCompany(scoped(), other, null));
        // A granted company named only in the body would be written with their HOME roles: refused.
        assertDenied(() -> CompanyAccessService.checkBodyCompany(scoped(), granted, null));
        // With the granted company selected (scope = their roles there): that company only.
        assertDoesNotThrow(() -> CompanyAccessService.checkBodyCompany(scoped(), granted, scopeIn(granted)));
        assertDenied(() -> CompanyAccessService.checkBodyCompany(scoped(), home, scopeIn(granted)));
        assertDenied(() -> CompanyAccessService.checkBodyCompany(scoped(), other, scopeIn(granted)));
    }

    @Test
    void peopleWhoReachEveryCompanyAreNotCheckedAsBefore() {
        assertDoesNotThrow(() -> CompanyAccessService.checkBodyCompany(workspaceWide(), other, null));
        assertDoesNotThrow(() -> CompanyAccessService.checkBodyCompany(noEmployeeRecord(), other, null));
        Profile unknown = new Profile(user, false, null, null, List.of(), List.of());
        assertDoesNotThrow(() -> CompanyAccessService.checkBodyCompany(unknown, other, null));
    }

    @Test
    void theServiceCheckUsesTheSignedInPersonAndTheRequestsScope() {
        doReturn(scoped()).when(service).profile(user);
        assertDoesNotThrow(() -> service.checkBodyCompany(home));
        assertDenied(() -> service.checkBodyCompany(granted));
        CompanyContext.setScope(scopeIn(granted));
        assertDoesNotThrow(() -> service.checkBodyCompany(granted));
        assertDoesNotThrow(() -> service.checkBodyCompany(null));
    }

    @Test
    void noCheckWithoutAWorkspaceUserOrWithTheKillSwitchOff() {
        doReturn(scoped()).when(service).profile(user);
        TenantContext.setTenantId(TenantContext.PLATFORM_TENANT_ID);
        assertDoesNotThrow(() -> service.checkBodyCompany(other));
        TenantContext.clear();
        assertDoesNotThrow(() -> service.checkBodyCompany(other));

        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
        CompanyAccessService off = new CompanyAccessService(mock(JdbcTemplate.class), mock(RolePermissionRepository.class),
                mock(EmployeeBaselinePermissions.class), mock(PermissionOverrides.class), false);
        assertDoesNotThrow(() -> off.checkBodyCompany(other));
        assertFalse(new CompanyBodyAccessAdvice(off).supports(null, Object.class, null));
    }

    // ── reading companyId out of a body ─────────────────────────────────────

    public record WithCompany(UUID companyId, String name) {}

    public record WithTextCompany(String companyId) {}

    public static class Bean {
        private final UUID companyId;
        public Bean(UUID companyId) { this.companyId = companyId; }
        public UUID getCompanyId() { return companyId; }
    }

    public record Nested(WithCompany inner) {}

    @Test
    void readsTheBodysOwnCompanyIdInEveryShape() throws Exception {
        assertEquals(Set.of(home), CompanyBodyAccessAdvice.companies(new WithCompany(home, "x")));
        assertEquals(Set.of(home), CompanyBodyAccessAdvice.companies(new WithTextCompany(home.toString())));
        assertEquals(Set.of(home), CompanyBodyAccessAdvice.companies(new Bean(home)));
        assertEquals(Set.of(home), CompanyBodyAccessAdvice.companies(Map.of("companyId", home.toString())));
        assertEquals(Set.of(home), CompanyBodyAccessAdvice.companies(
                new ObjectMapper().readTree("{\"companyId\":\"" + home + "\"}")));
        // List bodies: each item.
        assertEquals(Set.of(home, other), CompanyBodyAccessAdvice.companies(
                List.of(new WithCompany(home, "a"), new WithCompany(other, "b"), new WithCompany(null, "c"))));
        assertEquals(Set.of(home, other), CompanyBodyAccessAdvice.companies(
                new ObjectMapper().readTree("[{\"companyId\":\"" + home + "\"},{\"companyId\":\"" + other + "\"}]")));
    }

    @Test
    void leavesEverythingElseAlone() {
        assertTrue(CompanyBodyAccessAdvice.companies(null).isEmpty());
        assertTrue(CompanyBodyAccessAdvice.companies("text").isEmpty());
        assertTrue(CompanyBodyAccessAdvice.companies(new WithTextCompany("not-a-uuid")).isEmpty());
        assertTrue(CompanyBodyAccessAdvice.companies(new WithTextCompany(" ")).isEmpty());
        assertTrue(CompanyBodyAccessAdvice.companies(Map.of("name", "x")).isEmpty());
        assertTrue(CompanyBodyAccessAdvice.companies(new Nested(new WithCompany(other, "x"))).isEmpty());
        assertTrue(CompanyBodyAccessAdvice.companies(List.of("a", 1)).isEmpty());
    }

    @Test
    void theAdviceRefusesABodyForAnotherCompanyAndPassesTheRestThrough() {
        doReturn(scoped()).when(service).profile(user);
        CompanyBodyAccessAdvice advice = new CompanyBodyAccessAdvice(service);
        assertTrue(advice.supports(null, Object.class, null));
        Object ok = new WithCompany(home, "x");
        assertSame(ok, advice.afterBodyRead(ok, null, null, Object.class, null));
        assertDenied(() -> advice.afterBodyRead(new WithCompany(other, "x"), null, null, Object.class, null));
        assertDenied(() -> advice.afterBodyRead(List.of(new WithCompany(home, "a"), new WithCompany(other, "b")),
                null, null, Object.class, null));
    }

    // ── a list whose optional companyId was left out ────────────────────────

    @Test
    void aListWithoutCompanyIdCoversTheSelectedCompanyElseTheHomeCompanyForScopedPeople() {
        doReturn(scoped()).when(service).profile(user);
        assertEquals(other, service.listCompanyId(other));          // a companyId sent wins (the filter checked it)
        assertEquals(home, service.listCompanyId(null));            // no header: home, never every company
        CompanyContext.setCompanyId(granted);
        assertEquals(granted, service.listCompanyId(null));         // the selected company
    }

    @Test
    void peopleWhoReachEveryCompanyStillGetEveryCompanyWithoutAHeader() {
        doReturn(workspaceWide()).when(service).profile(user);
        assertNull(service.listCompanyId(null));
        CompanyContext.setCompanyId(granted);
        assertEquals(granted, service.listCompanyId(null));

        CompanyContext.clear();
        doReturn(noEmployeeRecord()).when(service).profile(user);
        assertNull(service.listCompanyId(null));
        doReturn(new Profile(user, false, null, null, List.of(), List.of())).when(service).profile(user);
        assertNull(service.listCompanyId(null));
    }

    @Test
    void listsAreUnchangedOutsideAWorkspaceWithTheKillSwitchOffOrWithoutTheBean() {
        doReturn(scoped()).when(service).profile(user);
        TenantContext.clear();
        assertNull(service.listCompanyId(null));
        TenantContext.setTenantId(TenantContext.PLATFORM_TENANT_ID);
        TenantContext.setUserId(user);
        assertNull(service.listCompanyId(null));

        TenantContext.setTenantId(tenant);
        CompanyAccessService off = new CompanyAccessService(mock(JdbcTemplate.class), mock(RolePermissionRepository.class),
                mock(EmployeeBaselinePermissions.class), mock(PermissionOverrides.class), false);
        assertNull(off.listCompanyId(null));
        assertNull(CompanyAccessService.listCompanyId(null, null));
        assertEquals(other, CompanyAccessService.listCompanyId(null, other));
        assertEquals(home, CompanyAccessService.listCompanyId(service, null));
    }

    @Test
    void adminViewsUseTheSelectedCompanyElseTheirOwn() {
        assertEquals(home, CompanyContext.currentOr(home));
        assertNull(CompanyContext.currentOr(null));
        CompanyContext.setCompanyId(granted);
        assertEquals(granted, CompanyContext.currentOr(home));
        assertEquals(granted, CompanyContext.currentOr(null));
    }
}
