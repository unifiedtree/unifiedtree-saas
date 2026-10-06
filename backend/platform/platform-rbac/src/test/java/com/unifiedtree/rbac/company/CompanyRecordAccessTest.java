package com.unifiedtree.rbac.company;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.company.CompanyAccess.Grant;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import com.unifiedtree.rbac.company.CompanyAccessService.RecordOwner;
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
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Company access, part 3 (COMPANY_ACCESS.md "Records addressed by id" and
 * "Tenant-wide views"): the one record check and the company a tenant-wide view
 * is narrowed to.
 */
class CompanyRecordAccessTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID me = UUID.randomUUID();
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
        return new Profile(user, true, me, home, List.of(deptManager),
                List.of(new Grant(granted, employeeRole, UUID.randomUUID(), OffsetDateTime.now())));
    }

    private Profile workspaceWide() {
        return new Profile(user, true, me, home, List.of(hrManager), List.of());
    }

    private CompanyContext.Scope scopeIn(UUID company) {
        return new CompanyContext.Scope(company, Set.of(employeeRole.id()), List.of("EMPLOYEE"), Set.of("leave.request.self"));
    }

    private static RecordOwner in(UUID company) {
        return RecordOwner.ofCompany(company);
    }

    private static void assertNotFound(Runnable r) {
        HrmsException e = assertThrows(HrmsException.class, r::run);
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("RESOURCE_NOT_FOUND", e.getErrorCode());
    }

    private static void assertSwitchFirst(Runnable r) {
        HrmsException e = assertThrows(HrmsException.class, r::run);
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertEquals("COMPANY_ACCESS_DENIED", e.getErrorCode());
    }

    // ── a record addressed by id ────────────────────────────────────────────

    @Test
    void aRecordInACompanyTheyCannotAccessIsNotFound() {
        UUID id = UUID.randomUUID();
        HrmsException e = assertThrows(HrmsException.class,
                () -> CompanyAccessService.checkRecord(scoped(), "Department", id, in(other), null));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        // The same answer as an unknown id: nothing says the record exists.
        assertEquals("Department not found with id: " + id, e.getMessage());
        assertNotFound(() -> CompanyAccessService.checkRecord(scoped(), "Department", id, in(other), scopeIn(granted)));
    }

    @Test
    void aRecordIsActedOnOnlyInTheCompanyTheRequestRunsIn() {
        // No header: the home company's records.
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Shift", 1, in(home), null));
        // A granted company's record with their home roles: switch first.
        assertSwitchFirst(() -> CompanyAccessService.checkRecord(scoped(), "Shift", 1, in(granted), null));
        // Working in the granted company: its records, not the home company's.
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Shift", 1, in(granted), scopeIn(granted)));
        assertSwitchFirst(() -> CompanyAccessService.checkRecord(scoped(), "Shift", 1, in(home), scopeIn(granted)));
    }

    @Test
    void theirOwnTheirTeamsAndTheirApprovalsAreAlwaysAllowed() {
        UUID someone = UUID.randomUUID();
        // In a company they cannot access at all, and in one they are not working in.
        for (UUID company : List.of(other, granted)) {
            assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Expense claim", 1,
                    new RecordOwner(company, me, null, null), null), "their own");
            assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Employee", 1,
                    new RecordOwner(company, someone, me, null), null), "a direct report");
            assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Advance request", 1,
                    new RecordOwner(company, someone, null, me), null), "sent to them for approval");
        }
        assertNotFound(() -> CompanyAccessService.checkRecord(scoped(), "Employee", 1,
                new RecordOwner(other, someone, UUID.randomUUID(), UUID.randomUUID()), null));
    }

    @Test
    void peopleWhoReachEveryCompanyAndUnknownRecordsAreNotChecked() {
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(workspaceWide(), "Payroll run", 1, in(other), null));
        Profile noEmployee = new Profile(user, true, null, null, List.of(employeeRole), List.of());
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(noEmployee, "Payroll run", 1, in(other), null));
        Profile unknown = new Profile(user, false, null, null, List.of(), List.of());
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(unknown, "Payroll run", 1, in(other), null));
        // An unknown id (no owner) or a record with no company: the endpoint answers as before.
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Payroll run", 1, null, null));
        assertDoesNotThrow(() -> CompanyAccessService.checkRecord(scoped(), "Payroll run", 1, in(null), null));
    }

    @Test
    void theServiceReadsTheOwnerOnlyForCompanyScopedPeople() {
        AtomicInteger reads = new AtomicInteger();
        Supplier<RecordOwner> owner = () -> { reads.incrementAndGet(); return in(other); };

        doReturn(workspaceWide()).when(service).profile(user);
        service.checkRecord("Branch", 1, owner);
        assertEquals(0, reads.get(), "nothing is read for people who reach every company");

        doReturn(scoped()).when(service).profile(user);
        assertNotFound(() -> service.checkRecord("Branch", 1, owner));
        assertEquals(1, reads.get());
        CompanyContext.setScope(scopeIn(granted));
        assertDoesNotThrow(() -> service.checkRecord("Branch", 1, () -> in(granted)));
        assertDoesNotThrow(() -> service.checkRecord("Branch", 1, null));
    }

    @Test
    void noRecordCheckWithoutAWorkspaceUserOrWithTheKillSwitchOff() {
        Supplier<RecordOwner> owner = () -> { throw new AssertionError("must not be read"); };
        doReturn(scoped()).when(service).profile(user);
        TenantContext.setTenantId(TenantContext.PLATFORM_TENANT_ID);
        assertDoesNotThrow(() -> service.checkRecord("Branch", 1, owner));
        TenantContext.clear();
        assertDoesNotThrow(() -> service.checkRecord("Branch", 1, owner));

        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
        CompanyAccessService off = new CompanyAccessService(mock(JdbcTemplate.class), mock(RolePermissionRepository.class),
                mock(EmployeeBaselinePermissions.class), mock(PermissionOverrides.class), false);
        assertDoesNotThrow(() -> off.checkRecord("Branch", 1, owner));
    }

    // ── the company a tenant-wide view covers ───────────────────────────────

    @Test
    void aCompanyScopedPersonsTenantWideViewCoversTheSelectedCompanyElseHome() {
        doReturn(scoped()).when(service).profile(user);
        assertEquals(home, service.scopedViewCompanyId());
        CompanyContext.setCompanyId(granted);
        assertEquals(granted, service.scopedViewCompanyId());
    }

    @Test
    void peopleWhoReachEveryCompanyKeepTheWholeWorkspaceHeaderOrNot() {
        doReturn(workspaceWide()).when(service).profile(user);
        assertNull(service.scopedViewCompanyId());
        CompanyContext.setCompanyId(granted);
        assertNull(service.scopedViewCompanyId(), "unchanged for them, even with a company selected");
        doReturn(new Profile(user, false, null, null, List.of(), List.of())).when(service).profile(user);
        assertNull(service.scopedViewCompanyId());
    }

    @Test
    void noNarrowingWithoutTheBeanAWorkspaceUserOrWithTheKillSwitchOff() {
        assertNull(CompanyAccessService.scopedViewCompanyId(null));
        doReturn(scoped()).when(service).profile(user);
        TenantContext.setTenantId(TenantContext.PLATFORM_TENANT_ID);
        assertNull(service.scopedViewCompanyId());
        TenantContext.setTenantId(tenant);
        CompanyAccessService off = new CompanyAccessService(mock(JdbcTemplate.class), mock(RolePermissionRepository.class),
                mock(EmployeeBaselinePermissions.class), mock(PermissionOverrides.class), false);
        assertNull(off.scopedViewCompanyId());
    }
}
