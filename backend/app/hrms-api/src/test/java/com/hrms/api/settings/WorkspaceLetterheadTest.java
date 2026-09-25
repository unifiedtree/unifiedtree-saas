package com.hrms.api.settings;

import com.unifiedtree.settings.branding.BrandingService;
import com.unifiedtree.settings.branding.R2Storage;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** White-label letterhead on payslips, the salary register and letters. */
class WorkspaceLetterheadTest {

    static final UUID TENANT = UUID.randomUUID();

    /** Branding with a fixed logo (or none); the workspace is called "Acme Works". */
    static WorkspaceLetterhead letterhead(String logoDataUri) {
        JdbcTemplate jdbc = new JdbcTemplate() {
            @SuppressWarnings("unchecked")
            @Override public <T> T query(String sql, ResultSetExtractor<T> rse, Object... args) {
                return sql.contains("platform.tenants") ? (T) "Acme Works" : null;
            }
        };
        BrandingService branding = new BrandingService(jdbc, new R2Storage("", "", "", "", "")) {
            @Override public Optional<String> pdfImageDataUri(UUID tenantId) { return Optional.ofNullable(logoDataUri); }
        };
        return new WorkspaceLetterhead(branding, jdbc);
    }

    @Test void headerCarriesTheCompanyNameAndTheWorkspaceLogoNeverTheVendor() {
        String h = letterhead("data:image/png;base64,AAAA").headerHtml(TENANT, "Acme Retail Pvt Ltd");
        assertTrue(h.contains("Acme Retail Pvt Ltd"));
        assertTrue(h.contains("src=\"data:image/png;base64,AAAA\""));
        assertFalse(h.toLowerCase().contains("unified"));
    }

    @Test void withoutACompanyTheWorkspaceNameIsUsed() {
        String h = letterhead(null).headerHtml(TENANT, null);
        assertTrue(h.contains("Acme Works"));
        assertFalse(h.contains("<img"), "no logo uploaded → name only");
    }

    @Test void theNameIsEscaped() {
        String h = WorkspaceLetterhead.block(null, "A&B <script>");
        assertTrue(h.contains("A&amp;B &lt;script&gt;"));
        assertFalse(h.contains("<script>"));
    }

    @Test void nothingToShowMeansNoBlock() {
        assertEquals("", WorkspaceLetterhead.block(null, " "));
        assertEquals("", WorkspaceLetterhead.block("javascript:alert(1)", null), "only data:image URIs are embedded");
    }

    @Test void theHeaderGoesRightAfterTheBodyTag() {
        String doc = "<!DOCTYPE html><html><head></head><body style='x'><h1>Payslip</h1></body></html>";
        String out = letterhead(null).applyToDocument(doc, TENANT, "Acme Retail");
        int body = out.indexOf("<body style='x'>");
        int header = out.indexOf("Acme Retail");
        int title = out.indexOf("<h1>Payslip</h1>");
        assertTrue(body >= 0 && body < header && header < title, out);
    }

    @Test void lettersAndEmailsGoOutUnderTheCompanyThenTheWorkspace() {
        var lh = letterhead(null);
        assertEquals("Acme Retail", lh.senderName(TENANT, "Acme Retail"));
        assertEquals("Acme Works", lh.senderName(TENANT, null));
        assertTrue(lh.decorate("<p>Dear A,</p>", TENANT, "Acme Retail").endsWith("<p>Dear A,</p>"));
    }
}
