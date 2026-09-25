package com.hrms.api.document;

import com.hrms.document.dto.DocumentResponse;
import com.hrms.document.enums.DocumentCategory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.HashSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Document edit rules (a new type must fit the kept file) and the new-workspace type seed. */
class DocumentEditAndDefaultsTest {

    @AfterEach void clearTenant() { com.hrms.core.tenant.TenantContext.clear(); }

    private static DocumentResponse stored(String contentType, Long size) {
        return new DocumentResponse(UUID.randomUUID(), UUID.randomUUID(), null, null, UUID.randomUUID(),
                "PAN", DocumentCategory.TAX, "r2://employee-documents/x/y.pdf", null, null, null, Instant.now(),
                UUID.randomUUID(), "PAN", "PAN Card", "VERIFIED", null, null, null, "pan.pdf", size, contentType);
    }

    private static DocumentUploadController.DocumentType type(String formats, int maxMb) {
        return new DocumentUploadController.DocumentType(UUID.randomUUID(), "PHOTO", "Passport-size Photograph", formats, maxMb);
    }

    @Test void typeChangeMustFitTheKeptFile() {
        ResponseStatusException format = assertThrows(ResponseStatusException.class,
                () -> DocumentUploadController.assertFileFitsType(stored("application/pdf", 1000L), type("jpg,jpeg,png", 2)));
        assertTrue(format.getReason().contains("Replace the file"));
        ResponseStatusException size = assertThrows(ResponseStatusException.class,
                () -> DocumentUploadController.assertFileFitsType(stored("image/png", 3L * 1024 * 1024), type("jpg,jpeg,png", 2)));
        assertTrue(size.getReason().contains("2 MB"));
        assertDoesNotThrow(() -> DocumentUploadController.assertFileFitsType(stored("image/jpeg", 1000L), type("jpeg,png", 2)));
        // A link document carries no file facts, so any type fits.
        assertDoesNotThrow(() -> DocumentUploadController.assertFileFitsType(stored(null, null), type("pdf", 1)));
    }

    @Test void defaultsMatchV143_7() {
        assertEquals(10, DocumentTypeDefaults.DEFAULTS.size());
        var codes = new HashSet<String>();
        for (var d : DocumentTypeDefaults.DEFAULTS) {
            assertTrue(d.code().matches("^[A-Z0-9_]{2,50}$"), d.code());
            assertTrue(d.maxSizeMb() >= 1 && d.maxSizeMb() <= 50);
            assertTrue(codes.add(d.code()), "duplicate " + d.code());
        }
        assertTrue(codes.containsAll(java.util.List.of("AADHAAR", "PAN", "PHOTO", "RESUME", "OTHER")));
    }

    @Test void seedsAWorkspaceThatHasNoTypes() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID tenant = UUID.randomUUID();
        com.hrms.core.tenant.TenantContext.setTenantId(tenant);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(tenant))).thenReturn(0);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        assertEquals(10, new DocumentTypeDefaults(jdbc).ensureDefaults());
        verify(jdbc, times(10)).update(contains("ON CONFLICT (tenant_id, code) DO NOTHING"), any(Object[].class));
    }

    @Test void leavesAWorkspaceWithTypesAlone() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID tenant = UUID.randomUUID();
        com.hrms.core.tenant.TenantContext.setTenantId(tenant);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(tenant))).thenReturn(3);
        assertEquals(0, new DocumentTypeDefaults(jdbc).ensureDefaults());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void noTenantNoSeed() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        assertEquals(0, new DocumentTypeDefaults(jdbc).ensureDefaults());
        verifyNoInteractions(jdbc);
    }
}
