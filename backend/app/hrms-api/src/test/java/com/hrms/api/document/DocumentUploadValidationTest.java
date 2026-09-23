package com.hrms.api.document;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class DocumentUploadValidationTest {
    @Test void validatesContentInsteadOfTrustingAnExtension() {
        assertEquals("application/pdf", DocumentUploadController.documentType("%PDF-1.7".getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
        assertEquals("image/jpeg", DocumentUploadController.documentType(new byte[] {(byte) 255, (byte) 216, (byte) 255}));
        assertEquals("image/png", DocumentUploadController.documentType(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10}));
        assertThrows(ResponseStatusException.class, () -> DocumentUploadController.documentType("<script>alert(1)</script>".getBytes()));
        assertThrows(ResponseStatusException.class, () -> DocumentUploadController.documentType(new byte[0]));
    }
}
