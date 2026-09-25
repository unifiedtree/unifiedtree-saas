package com.hrms.api.settings.workspace;

import org.junit.jupiter.api.Test;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceExportWriterTest {

    @Test
    void neverExportsSecretsOrFullIdentityNumbers() {
        for (String c : List.of("password_hash", "token_hash", "mfa_secret_enc", "mfa_pending_secret_enc", "pan_encrypted",
                "account_number_encrypted", "aadhaar_number", "passport_number", "bank_account_number", "face_embedding",
                "refresh_token", "api_secret", "tenant_id")) {
            assertTrue(WorkspaceExportWriter.excluded(c, "text"), c);
        }
        assertTrue(WorkspaceExportWriter.excluded("photo", "bytea"));
        for (String c : List.of("id", "employee_id", "first_name", "pan_number", "account_number_last4", "aadhaar_last4",
                "ctc_annual", "template_key", "created_at")) {
            assertFalse(WorkspaceExportWriter.excluded(c, "character varying(100)"), c);
        }
    }

    @Test
    void writesSafeCsvCells() throws Exception {
        assertEquals("plain", WorkspaceExportWriter.csv("plain"));
        assertEquals("\"a,b\"", WorkspaceExportWriter.csv("a,b"));
        assertEquals("\"say \"\"hi\"\"\"", WorkspaceExportWriter.csv("say \"hi\""));
        assertEquals("\"two\nlines\"", WorkspaceExportWriter.csv("two\nlines"));
        // Cells a spreadsheet would run as a formula stay text; numbers don't change.
        assertEquals("'=SUM(A1)", WorkspaceExportWriter.format("=SUM(A1)"));
        assertEquals("'@cmd", WorkspaceExportWriter.format("@cmd"));
        assertEquals("'-x", WorkspaceExportWriter.format("-x"));
        assertEquals("-5", WorkspaceExportWriter.format("-5"));
        assertEquals("-5.25", WorkspaceExportWriter.format(new java.math.BigDecimal("-5.25")));
        assertEquals("true", WorkspaceExportWriter.format(Boolean.TRUE));
        assertEquals("", WorkspaceExportWriter.format(null));
        // Times are India time.
        assertEquals("2026-09-25T15:30+05:30", WorkspaceExportWriter.format(Timestamp.from(Instant.parse("2026-09-25T10:00:00Z"))));
    }

    @Test
    void quotesIdentifiers() {
        assertEquals("\"hrms\"", WorkspaceExportWriter.ident("hrms"));
        assertEquals("\"we\"\"ird\"", WorkspaceExportWriter.ident("we\"ird"));
    }

    @Test
    void readmeListsFilesWhatWasLeftOutAndFailures() {
        String r = WorkspaceExportWriter.readme("Acme Industries", "owner@acme.in",
                List.of(new WorkspaceExportWriter.TableResult("02-people/employees.csv", 56, List.of("aadhaar_number")),
                        new WorkspaceExportWriter.TableResult("04-leave/leave-requests.csv", 1, List.of())),
                List.of("05-payroll/payslips.csv (permission denied)"));
        assertTrue(r.startsWith("Acme Industries: full data export"));
        assertTrue(r.contains("requested by owner@acme.in"));
        assertTrue(r.contains("02-people/employees.csv  56 rows  (left out: aadhaar_number)"));
        assertTrue(r.contains("04-leave/leave-requests.csv  1 row"));
        assertTrue(r.contains("COULD NOT BE EXPORTED"));
        assertTrue(r.contains("Passwords"));
        assertFalse(r.toLowerCase().contains("unifiedtree"));
    }

    @Test
    void everyBusinessSchemaHasAFolder() {
        assertEquals("02-people", WorkspaceExportWriter.FOLDERS.get("hrms"));
        assertEquals(19, WorkspaceExportWriter.FOLDERS.size());
        assertFalse(WorkspaceExportWriter.FOLDERS.containsKey("auth"), "sign-in data is exported only as users-and-access.csv");
    }
}
