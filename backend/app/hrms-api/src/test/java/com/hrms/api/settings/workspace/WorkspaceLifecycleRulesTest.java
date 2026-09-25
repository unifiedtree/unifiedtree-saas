package com.hrms.api.settings.workspace;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceLifecycleRulesTest {

    @Test
    void typedNameMustMatchTheWorkspaceName() {
        assertTrue(WorkspaceLifecycleService.nameMatches("Acme Industries", "Acme Industries"));
        assertTrue(WorkspaceLifecycleService.nameMatches("  acme   industries ", "Acme Industries"), "case and extra spaces are forgiven");
        assertFalse(WorkspaceLifecycleService.nameMatches("Acme", "Acme Industries"));
        assertFalse(WorkspaceLifecycleService.nameMatches("Acme Industries Ltd", "Acme Industries"));
        assertFalse(WorkspaceLifecycleService.nameMatches("", "Acme Industries"));
        assertFalse(WorkspaceLifecycleService.nameMatches(null, "Acme Industries"));
    }

    @Test
    void waitIsSevenDaysAndTheScopeIsWrittenDown() {
        assertEquals(7, WorkspaceLifecycleService.COOLING_OFF_DAYS);
        assertTrue(WorkspaceLifecycleService.RESET_REMOVES.stream().anyMatch(s -> s.startsWith("Employee records")));
        assertTrue(WorkspaceLifecycleService.RESET_REMOVES.stream().anyMatch(s -> s.contains("except the workspace owners")));
        assertTrue(WorkspaceLifecycleService.RESET_KEEPS.stream().anyMatch(s -> s.startsWith("Owner sign-in accounts")));
        assertTrue(WorkspaceLifecycleService.DELETE_REMOVES.contains("Everything a reset removes"));
        for (List<String> l : List.of(WorkspaceLifecycleService.RESET_REMOVES, WorkspaceLifecycleService.RESET_KEEPS,
                WorkspaceLifecycleService.DELETE_REMOVES)) {
            l.forEach(s -> assertFalse(s.toLowerCase().contains("unifiedtree"), s));
        }
    }

    @Test
    void emailsAreEscapedAndWhiteLabelled() {
        String html = WorkspaceMailer.html("Acme <Test>", "Heading", List.of("Body"), "Open", "https://acme.example.com/x?a=1&b=2");
        assertTrue(html.contains("Acme &lt;Test&gt;"));
        assertTrue(html.contains("a=1&amp;b=2"));
        assertFalse(html.toLowerCase().contains("unifiedtree"));
    }
}
