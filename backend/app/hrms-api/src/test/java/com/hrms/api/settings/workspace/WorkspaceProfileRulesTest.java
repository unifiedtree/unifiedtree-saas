package com.hrms.api.settings.workspace;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceProfileRulesTest {

    private static WorkspaceProfileRules.Profile p(String name, String email, String phone, String pin, String gstin, String pan) {
        return WorkspaceProfileRules.normalize(new WorkspaceProfileRules.Profile(name, email, phone, "12 MG Road", null, "Pune",
                "Maharashtra", pin, gstin, pan));
    }

    @Test
    void acceptsAFullValidProfile() {
        assertTrue(WorkspaceProfileRules.validate(p("Acme Industries", "accounts@acme.in", "+91 98765 43210", "411001",
                "27AAPFU0939F1ZV", "AAPFU0939F")).isEmpty());
    }

    @Test
    void acceptsTheMinimum() {
        assertTrue(WorkspaceProfileRules.validate(p("Acme", null, "", "  ", null, null)).isEmpty());
    }

    @Test
    void normalizesSpacingAndCase() {
        WorkspaceProfileRules.Profile n = p("  Acme   Industries ", " accounts@acme.in ", null, null, " 27aapfu0939f1zv ", "aapfu 0939f");
        assertEquals("Acme Industries", n.displayName());
        assertEquals("accounts@acme.in", n.contactEmail());
        assertEquals("27AAPFU0939F1ZV", n.gstin());
        assertEquals("AAPFU0939F", n.pan());
        assertNull(n.contactPhone());
    }

    @Test
    void explainsEachProblem() {
        Map<String, String> e = WorkspaceProfileRules.validate(p("A", "not-an-email", "call me", "0110", "12345", "ABC"));
        assertTrue(e.get("displayName").contains("at least 2"));
        assertTrue(e.containsKey("contactEmail"));
        assertTrue(e.containsKey("contactPhone"));
        assertTrue(e.get("postalCode").contains("6-digit"));
        assertTrue(e.get("gstin").contains("15-character"));
        assertTrue(e.get("pan").contains("ABCDE1234F"));
    }

    @Test
    void checksTheGstinCheckCharacterAndItsPan() {
        assertTrue(WorkspaceProfileRules.gstinChecksumOk("27AAPFU0939F1ZV"));
        assertTrue(WorkspaceProfileRules.gstinChecksumOk("29AAGCB7383J1Z4"));
        assertFalse(WorkspaceProfileRules.gstinChecksumOk("27AAPFU0939F1ZW"));
        assertTrue(WorkspaceProfileRules.validate(p("Acme", null, null, null, "27AAPFU0939F1ZW", null)).get("gstin").contains("last character"));
        assertTrue(WorkspaceProfileRules.validate(p("Acme", null, null, null, "27AAPFU0939F1ZV", "ABCDE1234F")).get("gstin").contains("must be the PAN"));
    }
}
