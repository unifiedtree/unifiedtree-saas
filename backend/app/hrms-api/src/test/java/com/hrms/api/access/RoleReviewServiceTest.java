package com.hrms.api.access;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * V143.69 is applied by hand in production, so until then the new columns are
 * missing: the notice must simply not appear (no 500), and "Mark as reviewed"
 * answers FEATURE_NOT_READY. Built-in roles have nothing to review.
 */
class RoleReviewServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID role = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final RoleReviewService service = new RoleReviewService(jdbc);

    @BeforeEach void signIn() { TenantContext.setTenantId(tenant); }

    @AfterEach void clear() { TenantContext.clear(); }

    private void columns(boolean there) {
        when(jdbc.queryForObject(contains("pg_attribute"), eq(Boolean.class))).thenReturn(there);
    }

    private void roleRow(UUID tenantId) {
        Map<String, Object> row = new HashMap<>();
        row.put("tenant_id", tenantId);
        when(jdbc.queryForList(contains("SELECT tenant_id FROM rbac.roles"), eq(role), eq(tenant))).thenReturn(List.of(row));
    }

    @Test
    void withoutTheMigrationThereIsNoNoticeAndTheNewColumnsAreNeverRead() {
        columns(false);
        assertThat(service.counts()).isEmpty();
        verify(jdbc).queryForObject(contains("pg_attribute"), eq(Boolean.class));
        verifyNoMoreInteractions(jdbc);
    }

    @Test
    void withoutTheMigrationOneRolesListIsEmpty() {
        columns(false);
        roleRow(tenant);
        assertThat(service.forRole(role)).isEmpty();
    }

    @Test
    void withoutTheMigrationMarkingAsReviewedIsNotReadyAndWritesNothing() {
        columns(false);
        assertThatThrownBy(() -> service.markReviewed(role)).isInstanceOf(FeatureNotReady.class);
        verify(jdbc).queryForObject(contains("pg_attribute"), eq(Boolean.class));
        verifyNoMoreInteractions(jdbc);
    }

    @Test
    void noWorkspaceMeansNoNotice() {
        TenantContext.clear();
        assertThat(service.counts()).isEmpty();
        verifyNoInteractions(jdbc);
    }

    @Test
    void aBuiltInRoleCannotBeMarkedAsReviewed() {
        columns(true);
        roleRow(null);
        assertThatThrownBy(() -> service.markReviewed(role))
                .isInstanceOf(HrmsException.class)
                .extracting(e -> ((HrmsException) e).getErrorCode()).isEqualTo("SYSTEM_ROLE_LOCKED");
        verify(jdbc, never()).queryForList(contains("UPDATE rbac.roles"), eq(java.sql.Timestamp.class), any(Object[].class));
    }

    @Test
    void aBuiltInRoleHasNoNewPermissions() {
        columns(true);
        when(jdbc.query(contains("permissions_reviewed_at"), any(org.springframework.jdbc.core.RowMapper.class), eq(role), eq(tenant)))
                .thenReturn(List.of(new NewPermissions.RoleDates(role, null, java.time.Instant.parse("2025-01-01T00:00:00Z"), null)));
        assertThat(service.forRole(role)).isEmpty();
        verify(jdbc, never()).query(contains("FROM rbac.permissions"), any(org.springframework.jdbc.core.RowMapper.class));
    }

    @Test
    void markingABusinessRoleStampsItForThisWorkspaceOnly() {
        columns(true);
        roleRow(tenant);
        java.sql.Timestamp now = java.sql.Timestamp.from(java.time.Instant.parse("2026-10-04T09:30:00Z"));
        when(jdbc.queryForList(contains("UPDATE rbac.roles SET permissions_reviewed_at = now()"), eq(java.sql.Timestamp.class), eq(role), eq(tenant)))
                .thenReturn(List.of(now));
        assertThat(service.markReviewed(role)).isEqualTo(now.toInstant());
    }

    @Test
    void theEndpointsUseTheRolesPagesGuards() throws Exception {
        Class<?> c = com.hrms.api.rbac.RbacController.class;
        String listRoles = c.getMethod("listRoles").getAnnotation(PreAuthorize.class).value();
        String editRole = c.getMethod("setRolePermissions", UUID.class, List.class, boolean.class, Jwt.class)
                .getAnnotation(PreAuthorize.class).value();
        assertThat(editRole).isEqualTo("hasAuthority('rbac.role.write')");
        // the count reads like the roles list; the list for one role and marking it need the edit permission
        assertThat(c.getMethod("newPermissionCounts").getAnnotation(PreAuthorize.class).value()).isEqualTo(listRoles);
        assertThat(c.getMethod("newPermissions", UUID.class).getAnnotation(PreAuthorize.class).value()).isEqualTo(editRole);
        assertThat(c.getMethod("markPermissionsReviewed", UUID.class).getAnnotation(PreAuthorize.class).value()).isEqualTo(editRole);
        assertThat(c.getMethod("newPermissionCounts").getAnnotation(GetMapping.class).value()).containsExactly("/roles/new-permissions");
        assertThat(c.getMethod("newPermissions", UUID.class).getAnnotation(GetMapping.class).value()).containsExactly("/roles/{roleId}/new-permissions");
        assertThat(c.getMethod("markPermissionsReviewed", UUID.class).getAnnotation(PostMapping.class).value()).containsExactly("/roles/{roleId}/permissions-reviewed");
    }
}
