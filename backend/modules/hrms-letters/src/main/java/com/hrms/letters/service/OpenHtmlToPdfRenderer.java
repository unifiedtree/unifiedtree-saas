package com.hrms.letters.service;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Entities;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;

@Service
public class OpenHtmlToPdfRenderer implements PdfRenderer {

    private static final Logger log = LoggerFactory.getLogger(OpenHtmlToPdfRenderer.class);

    @Override
    public byte[] render(String htmlContent) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            builder.withHtmlContent(wrapHtml(htmlContent), null);
            builder.toStream(out);
            builder.run();
            return out.toByteArray();
        } catch (Exception e) {
            log.error("PDF rendering failed", e);
            throw new RuntimeException("PDF generation failed: " + e.getMessage(), e);
        }
    }

    /**
     * Wraps the user's TipTap-authored body in a full XHTML document.
     *
     * <p>OpenHtmlToPdf feeds this string into its Xerces-based parser in strict
     * XHTML mode. TipTap's {@code getHTML()} serialises HTML5 void elements
     * ({@code <br>}, {@code <hr>}, {@code <img>}, {@code <meta>}) without a
     * self-closing slash, which Xerces rejects with
     * {@code SAXParseException: The element type "br" must be terminated by
     * the matching end-tag "</br>".} That was the sole cause of both the
     * synchronous /v1/letters/generate 500 and the "must be terminated"
     * errors on every failed recipient in distribution jobs (Anil Issue
     * Document 2, items 5 &amp; 6, 2026-09-01).
     *
     * <p>We normalise the body through Jsoup and re-emit it in XML syntax so
     * every void tag becomes self-closing before Xerces sees it. Cheap
     * (~5ms per letter) and handles the wider class of HTML5-vs-XHTML
     * mismatches (attribute quoting, unclosed &lt;img&gt;, etc.) in one place.
     */
    static String wrapHtml(String body) {
        String normalized = toXhtml(body == null ? "" : body);
        if (normalized.trim().toLowerCase().startsWith("<!doctype") ||
            normalized.trim().toLowerCase().startsWith("<html")) {
            return normalized;
        }
        return """
               <!DOCTYPE html>
               <html>
               <head>
               <meta charset="UTF-8"/>
               <style>
                 body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.6;
                        margin: 40pt; color: #1a1a1a; }
                 h1 { font-size: 18pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; }
                 p  { margin: 0 0 8pt 0; }
               </style>
               </head>
               <body>
               %s
               </body>
               </html>
               """.formatted(normalized);
    }

    /**
     * Parse the user HTML as an HTML5 fragment and re-serialise it in XML
     * syntax. Preserves the DOM (tag order, attributes, text) while forcing
     * every void tag to close itself so a downstream XHTML parser accepts it.
     *
     * <p>Falls back to the raw input on parse failure — we would rather feed
     * Xerces the original string (and let it throw its familiar error) than
     * silently corrupt a letter body.
     */
    private static String toXhtml(String html) {
        try {
            Document doc = Jsoup.parseBodyFragment(html);
            doc.outputSettings()
               .syntax(Document.OutputSettings.Syntax.xml)
               .escapeMode(Entities.EscapeMode.xhtml)
               .prettyPrint(false);
            // Body-fragment mode wraps input in <html><head/><body>...</body></html>;
            // we want just the body contents to slot into our own scaffold.
            return doc.body().html();
        } catch (Exception e) {
            log.warn("Jsoup XHTML normalize failed, falling back to raw HTML: {}", e.getMessage());
            return html;
        }
    }
}
