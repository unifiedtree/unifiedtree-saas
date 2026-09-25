package com.hrms.api.access;

import com.hrms.api.access.UserPermissionService.Existing;
import com.hrms.api.access.UserPermissionService.OverrideInput;
import com.hrms.api.access.UserPermissionService.Plan;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Which parts of a PUT /v1/workspace/users/{id}/permissions count as giving
 * access. Clearing a "removed" override hands the permission back, so it must
 * be checked exactly like a grant; an untouched row must not be re-checked.
 */
class OverridePlanTest {

    private static Map<String, Existing> existing(Existing... rows) {
        Map<String, Existing> m = new LinkedHashMap<>();
        for (Existing e : rows) m.put(e.code(), e);
        return m;
    }

    private static Map<String, OverrideInput> wanted(OverrideInput... rows) {
        Map<String, OverrideInput> m = new LinkedHashMap<>();
        for (OverrideInput i : rows) m.put(i.permissionCode(), i);
        return m;
    }

    @Test void newGrantGivesAccessNewDenyDoesNot() {
        Plan p = UserPermissionService.plan(existing(), wanted(
                new OverrideInput("payroll.structure.read", "GRANT", "cover", null),
                new OverrideInput("hrms.advance.approve", "DENY", "conflict", null)));
        assertEquals(List.of("payroll.structure.read", "hrms.advance.approve"), p.added());
        assertEquals(Set.of("payroll.structure.read"), p.givesAccess());
    }

    @Test void clearingADenyGivesThePermissionBack() {
        Plan p = UserPermissionService.plan(
                existing(new Existing("hrms.advance.approve", "DENY", "conflict", null),
                         new Existing("payroll.structure.read", "GRANT", "cover", null)),
                wanted());
        assertEquals(List.of("hrms.advance.approve", "payroll.structure.read"), p.removed());
        assertEquals(Set.of("hrms.advance.approve"), p.givesAccess());
    }

    @Test void untouchedRowsAreNotRechecked() {
        OffsetDateTime until = OffsetDateTime.parse("2026-10-01T18:29:59Z");
        Plan p = UserPermissionService.plan(
                existing(new Existing("payroll.structure.read", "GRANT", "cover", until)),
                // Same instant written in IST: not a change.
                wanted(new OverrideInput("payroll.structure.read", "GRANT", "cover", until.withOffsetSameInstant(ZoneOffset.ofHoursMinutes(5, 30)))));
        assertTrue(p.added().isEmpty() && p.changed().isEmpty() && p.removed().isEmpty());
        assertTrue(p.givesAccess().isEmpty());
    }

    @Test void extendingAGrantOrTurningADenyIntoAGrantIsAGrant() {
        Plan extend = UserPermissionService.plan(
                existing(new Existing("payroll.structure.read", "GRANT", "cover", OffsetDateTime.parse("2026-10-01T00:00:00Z"))),
                wanted(new OverrideInput("payroll.structure.read", "GRANT", "cover", null)));
        assertEquals(List.of("payroll.structure.read"), extend.changed());
        assertEquals(Set.of("payroll.structure.read"), extend.givesAccess());

        Plan flip = UserPermissionService.plan(
                existing(new Existing("hrms.advance.approve", "DENY", "conflict", null)),
                wanted(new OverrideInput("hrms.advance.approve", "GRANT", "resolved", null)));
        assertEquals(Set.of("hrms.advance.approve"), flip.givesAccess());
    }

    @Test void shorteningADenyIsAGrantButTurningAGrantIntoADenyIsNot() {
        Plan shorten = UserPermissionService.plan(
                existing(new Existing("hrms.advance.approve", "DENY", "conflict", null)),
                wanted(new OverrideInput("hrms.advance.approve", "DENY", "conflict", OffsetDateTime.parse("2026-10-01T00:00:00Z"))));
        assertEquals(Set.of("hrms.advance.approve"), shorten.givesAccess());

        Plan revoke = UserPermissionService.plan(
                existing(new Existing("payroll.structure.read", "GRANT", "cover", null)),
                wanted(new OverrideInput("payroll.structure.read", "DENY", "no longer needed", null)));
        assertEquals(List.of("payroll.structure.read"), revoke.changed());
        assertTrue(revoke.givesAccess().isEmpty());
    }
}
