package com.unifiedtree.auth.mfa;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** The rule and recovery-code logic of MfaService that needs no database. */
class MfaServiceRulesTest {

    private final MfaService service = new MfaService(null, null, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    @Test
    void workspaceRuleCoversTheRightPeople() {
        assertFalse(MfaService.policyCovers(MfaService.Policy.OFF, List.of("OWNER")));
        assertTrue(MfaService.policyCovers(MfaService.Policy.EVERYONE, List.of("EMPLOYEE")));
        assertTrue(MfaService.policyCovers(MfaService.Policy.EVERYONE, List.of()));
        for (String admin : List.of("OWNER", "SUPER_ADMIN", "ADMIN", "HR_MANAGER", "FINANCE_LEAD")) {
            assertTrue(MfaService.policyCovers(MfaService.Policy.ADMINS, List.of("EMPLOYEE", admin)), admin);
        }
        assertFalse(MfaService.policyCovers(MfaService.Policy.ADMINS, List.of("EMPLOYEE", "DEPT_MANAGER", "MANAGER")));
        assertFalse(MfaService.policyCovers(MfaService.Policy.ADMINS, null));
    }

    @Test
    void parsesPolicyLeniently() {
        assertEquals(MfaService.Policy.ADMINS, MfaService.Policy.parse(" admins "));
        assertEquals(MfaService.Policy.OFF, MfaService.Policy.parse(null));
        assertEquals(MfaService.Policy.OFF, MfaService.Policy.parse("sometimes"));
    }

    @Test
    void recoveryCodesAreUniqueReadableAndHashedWithTheServerKey() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 200; i++) {
            String c = MfaService.newRecoveryCode();
            assertTrue(c.matches("[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}"), c);
            assertTrue(seen.add(c));
        }
        String code = "ABCDE-23456";
        String h = service.hashRecoveryCode(code);
        assertEquals(64, h.length());
        assertEquals(h, service.hashRecoveryCode("abcde 23456"), "case and separators don't matter");
        assertNotEquals(h, service.hashRecoveryCode("ABCDE-23457"));
        MfaService otherKey = new MfaService(null, null, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=");
        assertNotEquals(h, otherKey.hashRecoveryCode(code), "a database copy alone isn't enough to check codes");
        assertTrue(MfaService.looksLikeRecoveryCode("abcde-23456"));
        assertFalse(MfaService.looksLikeRecoveryCode("123456"));
    }
}
