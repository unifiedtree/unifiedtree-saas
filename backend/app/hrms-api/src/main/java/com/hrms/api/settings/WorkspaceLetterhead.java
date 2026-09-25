package com.hrms.api.settings;

import com.hrms.letters.service.LetterheadDecorator;
import com.unifiedtree.settings.branding.BrandingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * The customer's own letterhead for generated documents (white label):
 * payslips, the salary register and letters open with the workspace's logo
 * and the company name, and say nothing about the vendor.
 *
 * <p>The logo is the workspace's wide logo (else its square mark) from
 * Settings → Branding, embedded as a data URI so the PDF renderer needs no
 * network access. With no logo uploaded, the header is the company name alone.
 */
@Component
public class WorkspaceLetterhead implements LetterheadDecorator {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceLetterhead.class);

    /** Used only if the workspace name itself can't be read. Never the vendor's name. */
    static final String NEUTRAL_SENDER = "HR Team";

    private final BrandingService branding;
    private final JdbcTemplate jdbc;

    public WorkspaceLetterhead(BrandingService branding, JdbcTemplate jdbc) {
        this.branding = branding;
        this.jdbc = jdbc;
    }

    /** The workspace (tenant) display name, or null. platform.tenants has no RLS. */
    public String workspaceName(UUID tenantId) {
        if (tenantId == null) return null;
        try {
            return jdbc.query("SELECT display_name FROM platform.tenants WHERE id = ?",
                    rs -> rs.next() ? rs.getString(1) : null, tenantId);
        } catch (Exception e) {
            log.warn("Workspace name lookup failed for tenant {}: {}", tenantId, e.getMessage());
            return null;
        }
    }

    /** The letterhead block: logo (when uploaded) and the company or workspace name. */
    public String headerHtml(UUID tenantId, String companyName) {
        String name = firstNonBlank(companyName, workspaceName(tenantId));
        Optional<String> logo = Optional.empty();
        try {
            logo = tenantId == null ? Optional.empty() : branding.pdfImageDataUri(tenantId);
        } catch (Exception e) {
            log.warn("Letterhead logo unavailable for tenant {}: {}", tenantId, e.getMessage());
        }
        return block(logo.orElse(null), name);
    }

    /** Insert the letterhead right after {@code <body>} of a full HTML document. */
    public String applyToDocument(String html, UUID tenantId, String companyName) {
        String header = headerHtml(tenantId, companyName);
        if (header.isEmpty() || html == null) return html;
        int body = html.toLowerCase(java.util.Locale.ROOT).indexOf("<body");
        if (body < 0) return header + html;
        int close = html.indexOf('>', body);
        if (close < 0) return header + html;
        return html.substring(0, close + 1) + header + html.substring(close + 1);
    }

    @Override
    public String decorate(String bodyHtml, UUID tenantId, String companyName) {
        return headerHtml(tenantId, companyName) + (bodyHtml == null ? "" : bodyHtml);
    }

    @Override
    public String senderName(UUID tenantId, String companyName) {
        return firstNonBlank(companyName, firstNonBlank(workspaceName(tenantId), NEUTRAL_SENDER));
    }

    /** Pure HTML for the block, so it is unit-tested without Spring. */
    static String block(String logoDataUri, String name) {
        boolean hasLogo = logoDataUri != null && logoDataUri.startsWith("data:image/");
        boolean hasName = name != null && !name.isBlank();
        if (!hasLogo && !hasName) return "";
        StringBuilder b = new StringBuilder();
        b.append("<table style='width:100%;border-collapse:collapse;margin:0 0 14pt 0;border-bottom:1pt solid #e2e8f0'><tr>");
        if (hasLogo) {
            b.append("<td style='width:1%;padding:0 10pt 8pt 0;vertical-align:middle;white-space:nowrap'>")
             .append("<img src=\"").append(logoDataUri.replace("\"", "")).append("\" alt=\"\" style=\"max-height:36pt;max-width:160pt\"/>")
             .append("</td>");
        }
        b.append("<td style='padding:0 0 8pt 0;vertical-align:middle;font-size:13pt;font-weight:bold;color:#0f172a'>")
         .append(hasName ? esc(name.strip()) : "")
         .append("</td></tr></table>");
        return b.toString();
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a.strip() : b;
    }

    static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }
}
