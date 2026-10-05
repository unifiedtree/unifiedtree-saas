package com.hrms.api.access;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Giving and taking away company access follows the same levels as giving a
 * role, plus: never the person's home company, never a whole-business role, and
 * only for a company the admin can reach themself. Every real change is audited.
 */
class CompanyAccessAdminServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID admin = UUID.randomUUID();
    private final UUID target = UUID.randomUUID();
    private final UUID home = UUID.randomUUID();
    private final UUID companyB = UUID.randomUUID();
    private final UUID roleId = UUID.randomUUID();
    private final CompanyAccessService access = mock(CompanyAccessService.class);
    private final AccessGuard guard = mock(AccessGuard.class);
    private final AccessAudit audit = mock(AccessAudit.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final CompanyAccessAdminService service = new CompanyAccessAdminService(access, guard, audit, jdbc);

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(admin);
        when(access.tableReady()).thenReturn(true);
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(String.class), eq(target)))
                .thenReturn(List.of("mgr@acme.in"));
        company(companyB, "Beta");
        company(home, "Alpha");
        role("DEPT_MANAGER", "Dept Manager");
        when(jdbc.queryForList(contains("FROM rbac.role_permissions rp"), eq(String.class), any(UUID.class))).thenReturn(List.of());
        when(guard.actor(admin)).thenReturn(new AccessPolicy.Actor(admin, true, Set.of("workspace.users.manage", "attendance.team.read")));
        when(guard.permissionsOfRole(any())).thenReturn(List.of("attendance.team.read"));
        when(guard.riskByCode()).thenReturn(Map.of("attendance.team.read", "LOW"));
        when(access.profile(admin)).thenReturn(new Profile(admin, true, UUID.randomUUID(), home,
                List.of(new RoleRef(UUID.randomUUID(), "OWNER", "Owner", true)), List.of()));
        when(access.profile(target)).thenReturn(new Profile(target, true, UUID.randomUUID(), home, List.of(), List.of()));
        when(access.grant(any(), any(), any(), any())).thenReturn(true);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    @SuppressWarnings("unchecked")
    private void company(UUID id, String name) {
        when(jdbc.query(contains("FROM org.companies WHERE id"), any(RowMapper.class), eq(id))).thenAnswer(inv -> {
            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject(1)).thenReturn(id);
            when(rs.getString(2)).thenReturn(name);
            return List.of(((RowMapper<Object>) inv.getArgument(1)).mapRow(rs, 0));
        });
    }

    @SuppressWarnings("unchecked")
    private void role(String code, String name) {
        when(jdbc.query(contains("FROM rbac.roles WHERE code"), any(RowMapper.class), eq(code))).thenAnswer(inv -> {
            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject(1)).thenReturn(code.equals("DEPT_MANAGER") ? roleId : UUID.randomUUID());
            when(rs.getString(2)).thenReturn(code);
            when(rs.getString(3)).thenReturn(name);
            return List.of(((RowMapper<Object>) inv.getArgument(1)).mapRow(rs, 0));
        });
    }

    private static String code(Runnable r) {
        return assertThrows(HrmsException.class, r::run).getErrorCode();
    }

    @Test
    void anOwnerGivesAManagerRoleInAnotherCompanyAndItIsAudited() {
        service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin);
        verify(access).grant(target, companyB, roleId, admin);
        verify(audit).record(eq(admin), eq(AccessAudit.PERMISSION_CHANGE), eq("USER"), eq(target),
                eq("Gave mgr@acme.in the Dept Manager role in Beta"), anyMap());
        verify(guard).evict(target);
    }

    @Test
    void grantingAgainChangesNothingAndWritesNoAudit() {
        when(access.grant(any(), any(), any(), any())).thenReturn(false);
        service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin);
        verify(audit, never()).record(any(), any(), any(), any(), any(), any());
    }

    @Test
    void theHomeCompanyIsChangedThroughTheirRoles() {
        assertEquals("HOME_COMPANY",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(home, "DEPT_MANAGER"), admin)));
        verify(access, never()).grant(any(), any(), any(), any());
    }

    @Test
    void wholeBusinessRolesAreGivenAsRolesNotPerCompany() {
        for (String r : List.of("OWNER", "SUPER_ADMIN", "ADMIN")) {
            role(r, r);
            assertEquals("ROLE_IS_WORKSPACE_WIDE",
                    code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, r), admin)), r);
        }
    }

    @Test
    void theLevelsRulesApply() {
        // nobody changes their own access
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(String.class), eq(admin))).thenReturn(List.of("me@acme.in"));
        assertEquals("CANNOT_EDIT_OWN_ACCESS",
                code(() -> service.grant(admin, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin)));
        // only roles whose permissions you hold
        when(guard.actor(admin)).thenReturn(new AccessPolicy.Actor(admin, false, Set.of("workspace.users.manage")));
        assertEquals("PERMISSION_NOT_HELD",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin)));
        // and the management permission, held right now
        when(guard.actor(admin)).thenReturn(new AccessPolicy.Actor(admin, false, Set.of()));
        assertEquals("PERMISSION_REQUIRED",
                code(() -> service.revoke(target, companyB, null, admin)));
    }

    @Test
    void anAdminOnlyChangesAccessToCompaniesTheyCanReach() {
        UUID elsewhere = UUID.randomUUID();
        when(access.profile(admin)).thenReturn(new Profile(admin, true, UUID.randomUUID(), elsewhere, List.of(), List.of()));
        assertEquals("COMPANY_ACCESS_DENIED",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin)));
        assertEquals("COMPANY_ACCESS_DENIED", code(() -> service.revoke(target, companyB, null, admin)));
    }

    @Test
    void unknownPeopleCompaniesAndRolesAreClearErrors() {
        UUID ghost = UUID.randomUUID();
        when(jdbc.queryForList(contains("FROM auth.user_credentials"), eq(String.class), eq(ghost))).thenReturn(List.of());
        assertEquals("USER_NOT_FOUND",
                code(() -> service.grant(ghost, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin)));
        UUID noCompany = UUID.randomUUID();
        when(jdbc.query(contains("FROM org.companies WHERE id"), any(RowMapper.class), eq(noCompany))).thenReturn(List.of());
        assertEquals("COMPANY_NOT_FOUND",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(noCompany, "DEPT_MANAGER"), admin)));
        when(jdbc.query(contains("FROM rbac.roles WHERE code"), any(RowMapper.class), eq("NOPE"))).thenReturn(List.of());
        assertEquals("ROLE_NOT_FOUND",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "NOPE"), admin)));
        role("PLATFORM_SUPER_ADMIN", "Platform");
        assertEquals("ROLE_NOT_ASSIGNABLE",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "PLATFORM_SUPER_ADMIN"), admin)));
        assertEquals("COMPANY_REQUIRED",
                code(() -> service.grant(target, new CompanyAccessAdminService.GrantRequest(null, "DEPT_MANAGER"), admin)));
    }

    @Test
    void beforeTheMigrationSavingAnswersFeatureNotReady() {
        when(access.tableReady()).thenReturn(false);
        HrmsException e = assertThrows(HrmsException.class,
                () -> service.grant(target, new CompanyAccessAdminService.GrantRequest(companyB, "DEPT_MANAGER"), admin));
        assertEquals("FEATURE_NOT_READY", e.getErrorCode());
        assertEquals(503, e.getStatus().value());
        assertEquals("FEATURE_NOT_READY", code(() -> service.revoke(target, companyB, null, admin)));
    }

    @Test
    void revokingOneRoleOrEverythingIsAuditedOnlyWhenSomethingWasRemoved() {
        when(access.revoke(target, companyB, roleId)).thenReturn(1);
        service.revoke(target, companyB, "DEPT_MANAGER", admin);
        verify(audit).record(eq(admin), eq(AccessAudit.PERMISSION_CHANGE), eq("USER"), eq(target),
                eq("Took away the Dept Manager role in Beta from mgr@acme.in"), anyMap());

        when(access.revoke(target, companyB, null)).thenReturn(0);
        service.revoke(target, companyB, null, admin);
        verify(audit, times(1)).record(any(), any(), any(), any(), any(), any());
    }
}
