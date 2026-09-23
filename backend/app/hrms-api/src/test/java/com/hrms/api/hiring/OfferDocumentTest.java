package com.hrms.api.hiring;

import com.hrms.hiring.dto.HiringOfferResponse;
import com.hrms.hiring.enums.OfferStatus;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class OfferDocumentTest {
    @Test void documentEscapesCandidateContentAndExcludesInternalNotes() {
        var offer = new HiringOfferResponse(UUID.randomUUID(), UUID.randomUUID(), null, null,
                "Candidate <script>", "Engineer", new BigDecimal("600000"), null,
                OfferStatus.DRAFT, null, null, "CONFIDENTIAL_INTERNAL_NOTE", Instant.now(),
                "Approved terms\n<img src='http://localhost/private' />", null, null);
        String html = OfferDocumentController.documentHtml(offer, "Company & Sons");
        assertTrue(html.contains("Company &amp; Sons"));
        assertTrue(html.contains("Candidate &lt;script&gt;"));
        assertTrue(html.contains("Approved terms<br />"));
        assertFalse(html.contains("<img"));
        assertFalse(html.contains("CONFIDENTIAL_INTERNAL_NOTE"));
        assertTrue(html.contains("DRAFT"));
    }
}
