package com.unifiedtree.rbac.service;

import com.unifiedtree.rbac.service.PersonalPagesService.RoleSetting;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Personal pages per role (V143.90). With no overrides the rule is exactly the
 * role rule the web and the app used before (OWNER, SUPER_ADMIN, COMPANY_ADMIN
 * and ADMIN don't get them); an override wins for its role; one role that is
 * off hides them for a person holding several.
 */
class PersonalPagesServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID employee = UUID.randomUUID();
    private final UUID admin = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PersonalPagesService service = new PersonalPagesService(jdbc);

    private static RoleSetting role(String code) {
        return new RoleSetting(UUID.randomUUID(), code, null);
    }

    private static RoleSetting role(String code, boolean override) {
        return new RoleSetting(UUID.randomUUID(), code, override);
    }

    // ── the default rule ─────────────────────────────────────────────────────

    @Test
    void theRolesThatRunTheWorkspaceAreOffByDefault() {
        for (String code : List.of("OWNER", "SUPER_ADMIN", "COMPANY_ADMIN", "ADMIN")) {
            assertFalse(PersonalPagesService.defaultFor(code), code);
        }
    }

    @Test
    void everyOtherRoleIsOnByDefaultBuiltInOrMadeByTheBusiness() {
        for (String code : List.of("EMPLOYEE", "HR_MANAGER", "DEPT_MANAGER", "MANAGER", "FINANCE_LEAD",
                "PLATFORM_SUPER_ADMIN", "STORE_LEAD", "SENIOR_MANAGER")) {
            assertTrue(PersonalPagesService.defaultFor(code), code);
        }
    }

    @Test
    void anEmployeeSeesThemAndAnOwnerDoesNot() {
        assertTrue(PersonalPagesService.shown(List.of(role("EMPLOYEE"))));
        assertFalse(PersonalPagesService.shown(List.of(role("OWNER"))));
    }

    @Test
    void oneRoleThatIsOffHidesThemForSomeoneWithSeveralRoles() {
        assertFalse(PersonalPagesService.shown(List.of(role("EMPLOYEE"), role("ADMIN"))));
        assertFalse(PersonalPagesService.shown(List.of(role("HR_MANAGER"), role("SUPER_ADMIN"))));
        assertTrue(PersonalPagesService.shown(List.of(role("EMPLOYEE"), role("DEPT_MANAGER"))));
    }

    @Test
    void someoneWithNoRolesSeesThem() {
        assertTrue(PersonalPagesService.shown(List.of()));
    }

    // ── overrides ────────────────────────────────────────────────────────────

    @Test
    void anOverrideWinsOverTheRolesDefault() {
        assertTrue(PersonalPagesService.shown(List.of(role("ADMIN", true))));
        assertFalse(PersonalPagesService.shown(List.of(role("EMPLOYEE", false))));
        assertTrue(role("ADMIN", true).overridden());
        assertFalse(role("ADMIN").overridden());
    }

    @Test
    void turningAdminOnShowsThemToAnEmployeeAdminButNotToSomeoneWhoIsAlsoOwner() {
        assertTrue(PersonalPagesService.shown(List.of(role("EMPLOYEE"), role("ADMIN", true))));
        assertFalse(PersonalPagesService.shown(List.of(role("ADMIN", true), role("OWNER"))));
    }

    @Test
    void turningEmployeeOffHidesThemEvenWithAnotherRoleThatIsOn() {
        assertFalse(PersonalPagesService.shown(List.of(role("EMPLOYEE", false), role("DEPT_MANAGER"))));
    }

    // ── reading a workspace's settings ───────────────────────────────────────

    private void ready(boolean there) {
        when(jdbc.queryForObject(contains("to_regclass('rbac.role_personal_pages')"), eq(Boolean.class))).thenReturn(there);
    }

    @SuppressWarnings("unchecked")
    private void heldRoles() {
        when(jdbc.query(contains("FROM rbac.roles"), any(RowMapper.class), eq(employee), eq(admin), eq(tenant)))
                .thenReturn(List.of(new RoleSetting(employee, "EMPLOYEE", null), new RoleSetting(admin, "ADMIN", null)));
    }

    private void overrides(Map<UUID, Boolean> rows) {
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            for (Map.Entry<UUID, Boolean> e : rows.entrySet()) {
                ResultSet rs = mock(ResultSet.class);
                when(rs.getObject(1, UUID.class)).thenReturn(e.getKey());
                when(rs.getBoolean(2)).thenReturn(e.getValue());
                h.processRow(rs);
            }
            return null;
        }).when(jdbc).query(contains("FROM rbac.role_personal_pages"), any(RowCallbackHandler.class), eq(tenant));
    }

    @Test
    void beforeTheMigrationTheDefaultRuleAnswersAndTheTableIsNeverRead() {
        ready(false);
        heldRoles();
        assertFalse(service.forRoles(tenant, List.of(employee, admin)));
        verify(jdbc, never()).query(contains("FROM rbac.role_personal_pages"), any(RowCallbackHandler.class), eq(tenant));
    }

    @Test
    void theWorkspacesOverrideForAdminShowsThemToAnEmployeeAdmin() {
        ready(true);
        heldRoles();
        overrides(Map.of(admin, true));
        assertTrue(service.forRoles(tenant, List.of(employee, admin)));
    }

    @Test
    void withTheMigrationButNoOverrideAnEmployeeAdminStillDoesNotSeeThem() {
        ready(true);
        heldRoles();
        overrides(Map.of());
        assertFalse(service.forRoles(tenant, List.of(employee, admin)));
    }

    @Test
    void overridesAreReadForThisWorkspaceOnly() {
        ready(true);
        overrides(Map.of(admin, true));
        assertEquals(Map.of(admin, true), service.overrides(tenant));
        verify(jdbc).query(contains("WHERE tenant_id = ?"), any(RowCallbackHandler.class), eq(tenant));
    }

    @Test
    void noRolesNeedsNoQuery() {
        assertTrue(service.forRoles(tenant, List.of()));
        verifyNoInteractions(jdbc);
    }

    @Test
    void noWorkspaceHasNoOverrides() {
        assertEquals(Map.of(), service.overrides(null));
        verifyNoInteractions(jdbc);
    }
}
