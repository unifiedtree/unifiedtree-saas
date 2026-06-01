package com.hrms.letters.service;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
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

    private static String wrapHtml(String body) {
        if (body.trim().toLowerCase().startsWith("<!doctype") ||
            body.trim().toLowerCase().startsWith("<html")) {
            return body;
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
               """.formatted(body);
    }
}
