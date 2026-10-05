package com.hrms.api.access;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.rbac.service.PersonalPagesService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Roles &amp; permissions › Personal pages (V143.90): only the workspace owner
 * changes a role's setting, built-in roles included; the write names this
 * workspace; a role this workspace can't see is not found; before the migration
 * saving answers FEATURE_NOT_READY and every role reads its default.
 */
class RolePersonalPagesServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID owner = UUID.randomUUID();
    private final UUID hr = UUID.randomUUID();
    private final UUID adminRole = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PersonalPagesService rule = mock(PersonalPagesService.class);
    private final AccessGuard guard = mock(AccessGuard.class);
    private final AccessAudit audit = mock(AccessAudit.class);
    private final RolePersonalPagesService service = new RolePersonalPagesService(rule, guard, audit, jdbc);

    @BeforeEach
    void signIn() {
        TenantContext.setTenantId(tenant);
        when(guard.isOwner(owner)).thenReturn(true);
        when(guard.isOwner(hr)).thenReturn(false);
        when(rule.ready()).thenReturn(true);
        when(rule.overrides(tenant)).thenReturn(Map.of());
    }

    @AfterEach
    void clear() { TenantContext.clear(); }

    private void visibleRole(UUID id, String code, String name, boolean system) {
        Map<String, Object> row = new HashMap<>();
        row.put("code", code);
        row.put("display_name", name);
        row.put("is_system", system);
        when(jdbc.queryForList(contains("FROM rbac.roles"), eq(id), eq(tenant))).thenReturn(List.of(row));
    }

    @Test
    void onlyTheOwnerCanChangeIt() {
        visibleRole(adminRole, "ADMIN", "Admin", true);
        assertThatThrownBy(() -> service.set(adminRole, true, hr))
                .isInstanceOf(HrmsException.class)
                .satisfies(e -> {
                    assertThat(((HrmsException) e).getErrorCode()).isEqualTo("OWNER_ONLY");
                    assertThat(((HrmsException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
                });
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(audit, never()).record(any(), any(), any(), any(), any(), anyMap());
    }

    @Test
    void theOwnerTurnsThemOnForTheBuiltInAdminRoleInThisWorkspace() {
        visibleRole(adminRole, "ADMIN", "Admin", true);
        RolePersonalPagesService.RoleSetting out = service.set(adminRole, true, owner);
        assertThat(out.enabled()).isTrue();
        assertThat(out.overridden()).isTrue();
        assertThat(out.defaultEnabled()).isFalse();
        verify(jdbc).update(contains("INSERT INTO rbac.role_personal_pages"), eq(tenant), eq(adminRole), eq(true), eq(owner));
        verify(audit).record(eq(owner), eq("UPDATE"), eq("ROLE"), eq(adminRole), contains("on for the Admin role"), anyMap());
    }

    @Test
    void turningARoleBackToItsDefaultRemovesTheOverride() {
        visibleRole(adminRole, "ADMIN", "Admin", true);
        when(rule.overrides(tenant)).thenReturn(Map.of(adminRole, true));
        RolePersonalPagesService.RoleSetting out = service.set(adminRole, false, owner);
        assertThat(out.enabled()).isFalse();
        assertThat(out.overridden()).isFalse();
        verify(jdbc).update(contains("DELETE FROM rbac.role_personal_pages"), eq(tenant), eq(adminRole));
        verify(jdbc, never()).update(contains("INSERT INTO rbac.role_personal_pages"), any(Object[].class));
        verify(audit).record(eq(owner), eq("UPDATE"), eq("ROLE"), eq(adminRole), contains("off for the Admin role"), anyMap());
    }

    @Test
    void theOwnerCanTurnThemOffForEmployees() {
        UUID employeeRole = UUID.randomUUID();
        visibleRole(employeeRole, "EMPLOYEE", "Employee", true);
        RolePersonalPagesService.RoleSetting out = service.set(employeeRole, false, owner);
        assertThat(out.enabled()).isFalse();
        assertThat(out.overridden()).isTrue();
        verify(jdbc).update(contains("INSERT INTO rbac.role_personal_pages"), eq(tenant), eq(employeeRole), eq(false), eq(owner));
    }

    @Test
    void aRoleThisWorkspaceCannotSeeIsNotFoundAndNothingIsWritten() {
        UUID otherWorkspacesRole = UUID.randomUUID();
        when(jdbc.queryForList(contains("FROM rbac.roles"), eq(otherWorkspacesRole), eq(tenant))).thenReturn(List.of());
        assertThatThrownBy(() -> service.set(otherWorkspacesRole, true, owner)).isInstanceOf(ResourceNotFoundException.class);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void beforeTheMigrationSavingIsNotReady() {
        visibleRole(adminRole, "ADMIN", "Admin", true);
        when(rule.ready()).thenReturn(false);
        assertThatThrownBy(() -> service.set(adminRole, true, owner)).isInstanceOf(FeatureNotReady.class);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void onOrOffMustBeSaid() {
        assertThatThrownBy(() -> service.set(adminRole, null, owner))
                .isInstanceOf(HrmsException.class)
                .extracting(e -> ((HrmsException) e).getErrorCode()).isEqualTo("ENABLED_REQUIRED");
    }

    @Test
    void noWorkspaceNoChange() {
        TenantContext.clear();
        assertThatThrownBy(() -> service.set(adminRole, true, owner)).isInstanceOf(RuntimeException.class);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void theListSaysWhoMayChangeItAndReadsThisWorkspacesRoles() {
        when(jdbc.query(contains("FROM rbac.roles"), any(RowMapper.class), eq(tenant))).thenReturn(List.of());
        assertThat(service.list(owner).canEdit()).isTrue();
        assertThat(service.list(hr).canEdit()).isFalse();
        assertThat(service.list(owner).ready()).isTrue();
        verify(rule, org.mockito.Mockito.atLeastOnce()).overrides(tenant);
    }

    @Test
    void theEndpointsUseTheRolesPagesGuards() throws Exception {
        Class<?> c = com.hrms.api.rbac.RbacController.class;
        String read = c.getMethod("personalPages", Jwt.class).getAnnotation(PreAuthorize.class).value();
        String listRoles = c.getMethod("listRoles").getAnnotation(PreAuthorize.class).value();
        assertThat(read).isEqualTo(listRoles);
        String write = c.getMethod("setPersonalPages", UUID.class, com.hrms.api.rbac.RbacController.PersonalPagesRequest.class, Jwt.class)
                .getAnnotation(PreAuthorize.class).value();
        assertThat(write).isEqualTo("hasAuthority('rbac.role.write')");
    }
}
