package com.hrms.api.access;

import com.hrms.api.attendance.AttendancePolicyController;
import com.hrms.api.payroll.PayrollRunController;
import com.hrms.api.payroll.PayrollRunService;
import com.hrms.api.pli.PliController;
import com.hrms.attendance.policy.AttendancePolicyService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.pli.dto.PliTargetRequest;
import com.hrms.pli.service.PliService;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.security.EmployeeBaselinePermissions;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Company access in the HRMS endpoints (COMPANY_ACCESS.md): lists whose optional
 * companyId was left out, admin views that default to the caller's company, the
 * acting admin's permissions and the cache after a role change.
 */
class CompanyAccessEnforcementTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID home = UUID.randomUUID();
    private final UUID selected = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        CompanyContext.clear();
    }

    private Jwt token(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(user.toString())
                .claim("employee_id", employeeId.toString()).build();
    }

    // ── lists: an optional companyId left out ───────────────────────────────

    @Test
    void aListWithoutCompanyIdAsksCompanyAccessWhichCompanyToCover() {
        PayrollRunService runs = mock(PayrollRunService.class);
        PayrollRunController controller = new PayrollRunController(runs);
        CompanyAccessService access = mock(CompanyAccessService.class);
        ReflectionTestUtils.setField(controller, "companyAccess", access);

        when(access.listCompanyId(null)).thenReturn(home);           // company-scoped person, no header
        controller.list(null, 2026, null);
        verify(runs).listRuns(tenant, home, 2026, null);

        UUID asked = UUID.randomUUID();
        when(access.listCompanyId(asked)).thenReturn(asked);         // a companyId sent is kept
        controller.list(asked, 2026, null);
        verify(runs).listRuns(tenant, asked, 2026, null);
    }

    @Test
    void withoutTheBeanAListKeepsTheCompanyIdItWasGiven() {
        PayrollRunService runs = mock(PayrollRunService.class);
        new PayrollRunController(runs).list(null, null, null);
        verify(runs).listRuns(tenant, null, null, null);
    }

    // ── admin views: the selected company, else the caller's own ────────────

    @Test
    void theAttendancePolicyFollowsTheSelectedCompany() {
        AttendancePolicyService policies = mock(AttendancePolicyService.class);
        EmployeeRepository employees = mock(EmployeeRepository.class);
        AttendancePolicyController controller = new AttendancePolicyController(policies, employees);
        UUID me = UUID.randomUUID();
        Employee mine = new Employee();
        mine.setId(me);
        mine.setCompanyId(home);
        when(employees.findById(me)).thenReturn(Optional.of(mine));

        controller.get(null, token(me));
        verify(policies).getOrCreate(home);                            // no header: as before

        CompanyContext.setCompanyId(selected);
        controller.get(null, token(me));
        verify(policies).getOrCreate(selected);                        // header: that company

        UUID named = UUID.randomUUID();
        controller.get(named, token(me));
        verify(policies).getOrCreate(named);                           // a named company still wins
    }

    @Test
    void anAdminCreateWithoutCompanyIdLandsInTheSelectedCompany() {
        PliService pli = mock(PliService.class);
        EmployeeRepository employees = mock(EmployeeRepository.class);
        PliController controller = new PliController(pli, employees, mock(JdbcTemplate.class), null, null);
        PliTargetRequest request = mock(PliTargetRequest.class);
        UUID me = UUID.randomUUID();

        CompanyContext.setCompanyId(selected);
        controller.createTarget(request, token(me));
        verify(pli).createTarget(eq(selected), any());
        verifyNoInteractions(employees);

        CompanyContext.clear();
        Employee mine = new Employee();
        mine.setId(me);
        mine.setCompanyId(home);
        when(employees.findById(me)).thenReturn(Optional.of(mine));
        controller.createTarget(request, token(me));
        verify(pli).createTarget(eq(home), any());
    }

    // ── the acting admin's permissions (only give what you hold) ────────────

    @Test
    void inAGrantedCompanyTheActorHoldsTheirPermissionsThere() {
        AccessGuard guard = spy(new AccessGuard(mock(JdbcTemplate.class), mock(EmployeeBaselinePermissions.class),
                mock(PermissionChecker.class)));
        doReturn(List.of("hrms.employee.read", "workspace.users.manage")).when(guard).effectivePermissions(user);

        assertEquals(List.of("hrms.employee.read", "workspace.users.manage"), guard.actingPermissions(user, null));
        CompanyContext.Scope there = new CompanyContext.Scope(selected, Set.of(), List.of("EMPLOYEE"), Set.of("leave.request.self"));
        assertEquals(List.of("leave.request.self"), guard.actingPermissions(user, there));
        // Someone else's permissions are never the request's scope.
        UUID otherUser = UUID.randomUUID();
        doReturn(List.of("x")).when(guard).effectivePermissions(otherUser);
        assertEquals(List.of("x"), guard.actingPermissions(otherUser, there));
    }

    // ── the company-access cache after a role or override change ────────────

    @Test
    void evictingAPersonAlsoDropsTheirCompanyAccess() {
        PermissionChecker checker = mock(PermissionChecker.class);
        EmployeeBaselinePermissions baseline = mock(EmployeeBaselinePermissions.class);
        AccessGuard guard = new AccessGuard(mock(JdbcTemplate.class), baseline, checker);
        guard.evict(user);                                              // without the bean: as before
        CompanyAccessService access = mock(CompanyAccessService.class);
        ReflectionTestUtils.setField(guard, "companyAccess", access);
        guard.evict(user);
        verify(checker, times(2)).evictUser(tenant, user);
        verify(access).evictUser(tenant, user);
        verify(baseline, times(2)).invalidate();
    }

    @Test
    void noHeaderMeansTheCallersOwnCompanyForAdminViews() {
        assertEquals(home, CompanyContext.currentOr(home));
        CompanyContext.setCompanyId(selected);
        assertEquals(selected, CompanyContext.currentOr(home));
        assertEquals(selected, CompanyContext.currentOr(null));
    }
}
