package com.hrms.api.me;

import com.hrms.api.me.AdminContactsService.AdminContact;
import com.hrms.api.me.AdminContactsService.Row;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Help &amp; support's contacts: who counts as an admin, how they are named and ordered, and the tenant fence. */
class AdminContactsServiceTest {

    private static Row row(String email, String display, String first, String last, String code, String name) {
        return new Row(email, display, first, last, code, name);
    }

    @Test void ownersComeFirstThenAdminsThenOthersByName() {
        List<AdminContact> out = AdminContactsService.toContacts(List.of(
                row("zed@x.io", "Zed", null, null, "CUSTOM_IT", "IT desk"),
                row("adm@x.io", "Asha Admin", null, null, "ADMIN", "Admin"),
                row("own@x.io", "Omar Owner", null, null, "OWNER", "Owner"),
                row("ann@x.io", "Ann", null, null, "CUSTOM_IT", "IT desk")));
        assertEquals(List.of("Omar Owner", "Asha Admin", "Ann", "Zed"), out.stream().map(AdminContact::name).toList());
        assertEquals("Owner", out.get(0).roleLabel());
        assertEquals("own@x.io", out.get(0).email());
    }

    @Test void atMostTenAndNeverWithoutAnEmail() {
        List<Row> rows = new ArrayList<>();
        for (int i = 0; i < 14; i++) rows.add(row("p" + i + "@x.io", "P" + i, null, null, "ADMIN", "Admin"));
        rows.add(row(null, "No mail", null, null, "OWNER", "Owner"));
        rows.add(row("  ", "Blank mail", null, null, "OWNER", "Owner"));
        List<AdminContact> out = AdminContactsService.toContacts(rows);
        assertEquals(AdminContactsService.MAX_CONTACTS, out.size());
        assertTrue(out.stream().noneMatch(c -> c.name().contains("mail")));
    }

    @Test void theNameIsTheDisplayNameElseTheEmployeeNameElseTheEmail() {
        assertEquals("Shown", AdminContactsService.name(row("a@x.io", " Shown ", "First", "Last", null, null)));
        assertEquals("First Last", AdminContactsService.name(row("a@x.io", " ", "First", "Last", null, null)));
        assertEquals("First", AdminContactsService.name(row("a@x.io", null, "First", null, null, null)));
        assertEquals("a.person", AdminContactsService.name(row("a.person@x.io", null, null, null, null, null)));
        assertNull(AdminContactsService.label(row("a@x.io", null, null, null, null, " ")));
    }

    @Test void theQueryAsksForActiveAdminsByPermissionInTheCallersTenant() {
        String sql = AdminContactsService.SQL;
        // Active logins only, and not people who have left.
        assertTrue(sql.contains("uc.is_active = TRUE"));
        assertTrue(sql.contains("employment_status NOT IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')"));
        // By permission (roles and per-person grants), minus denials; never by a role name.
        assertTrue(sql.contains("rp.permission_code = c.code"));
        assertTrue(sql.contains("o.effect = 'GRANT'"));
        assertTrue(sql.contains("o.effect = 'DENY'"));
        assertFalse(sql.contains("ro.code IN"), "a role name must never decide who is an admin");
        // Every table is fenced by the tenant.
        assertTrue(sql.contains("uc.tenant_id = ?"));
        assertTrue(sql.contains("ur.tenant_id = ?"));
        assertEquals(List.of("workspace.users.manage", "rbac.role.write"), AdminContactsService.ADMIN_PERMISSIONS);
    }

    @SuppressWarnings("unchecked")
    @Test void itBindsTheTwoPermissionsAndTheTenantTwice() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID tenant = UUID.randomUUID();
        new AdminContactsService(jdbc).contacts(tenant);
        verify(jdbc).query(eq(AdminContactsService.SQL), any(RowMapper.class),
                eq("workspace.users.manage"), eq("rbac.role.write"), eq(tenant), eq(tenant));
    }

    @Test void noTenantNoContacts() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        assertEquals(List.of(), new AdminContactsService(jdbc).contacts(null));
        verifyNoInteractions(jdbc);
    }
}
