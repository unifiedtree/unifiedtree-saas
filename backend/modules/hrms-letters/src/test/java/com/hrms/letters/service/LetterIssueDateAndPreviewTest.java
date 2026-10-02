package com.hrms.letters.service;

import com.hrms.employee.entity.Employee;
import com.hrms.letters.domain.GeneratedLetter;
import com.hrms.letters.dto.GeneratedLetterDto;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * BW-74: the issue date prints in the "today" merge fields and is kept in the
 * generation context; the DTO reads it back. Preview helpers: example values
 * and the unresolved fields. The letter page is A4 (the preview shows it).
 */
class LetterIssueDateAndPreviewTest {

    private final MergeFieldResolver resolver = new MergeFieldResolver();

    private static Employee employee() {
        Employee e = new Employee();
        e.setFirstName("Asha");
        e.setLastName("Rao");
        e.setEmployeeCode("EMP-7");
        return e;
    }

    @Test void issueDatePrintsInTheTodayFieldsAndIsKept() {
        Map<String, String> ctx = resolver.buildContext(employee(), null, null, null, null, null, Map.of(), LocalDate.of(2026, 3, 9));
        assertEquals("09 Mar 2026", ctx.get("today"));
        assertEquals("9 March 2026", ctx.get("today:long"));
        assertEquals("2026-03-09", ctx.get("today:iso"));
        assertEquals("2026-03-09", ctx.get(GeneratedLetterDto.ISSUE_DATE_KEY));
        assertEquals("Dated 09 Mar 2026 for Asha Rao", resolver.resolve("Dated {{today}} for {{employee.fullName}}", ctx));
    }

    @Test void withoutAnIssueDateTheLetterIsDatedTodayAsBefore() {
        Map<String, String> ctx = resolver.buildContext(employee(), null, null, null, null, null, Map.of());
        assertEquals(LocalDate.now().toString(), ctx.get("today:iso"));
        assertFalse(ctx.containsKey(GeneratedLetterDto.ISSUE_DATE_KEY));
    }

    @Test void overridesStillWinOverTheIssueDate() {
        Map<String, String> ctx = resolver.buildContext(employee(), null, null, null, null, null,
                Map.of("today", "first of the month"), LocalDate.of(2026, 3, 9));
        assertEquals("first of the month", ctx.get("today"));
    }

    @Test void theDtoReadsTheIssueDateBack() {
        GeneratedLetter g = new GeneratedLetter();
        g.setId(UUID.randomUUID());
        g.setGenerationContext(Map.of(GeneratedLetterDto.ISSUE_DATE_KEY, "2026-03-09"));
        assertEquals(LocalDate.of(2026, 3, 9), GeneratedLetterDto.from(g).issueDate());
        g.setGenerationContext(Map.of(GeneratedLetterDto.ISSUE_DATE_KEY, "not a date"));
        assertNull(GeneratedLetterDto.from(g).issueDate());
        g.setGenerationContext(null);
        assertNull(GeneratedLetterDto.from(g).issueDate());
    }

    @Test void exampleValuesFillEveryCatalogueField() {
        Map<String, String> ctx = resolver.sampleContext(LocalDate.of(2026, 1, 2));
        for (var e : resolver.catalogue()) {
            if (e.key().startsWith("today")) continue;
            assertEquals(e.example(), ctx.get(e.key()), e.key());
        }
        assertEquals("02 Jan 2026", ctx.get("today"));
        assertEquals(List.of(), resolver.unresolvedKeys("{{employee.fullName}} {{company.name}}", ctx));
    }

    @Test void unresolvedFieldsAreListedOnceInOrder() {
        Map<String, String> ctx = resolver.sampleContext(null);
        assertEquals(List.of("nope.one", "nope.two"),
                resolver.unresolvedKeys("{{nope.one}} {{employee.code}} {{ nope.two }} {{nope.one}}", ctx));
        assertEquals(List.of(), resolver.unresolvedKeys(null, ctx));
    }

    @Test void theLetterPageIsA4WithItsMargins() {
        String html = OpenHtmlToPdfRenderer.wrapHtml("<p>Hi</p>");
        assertTrue(html.contains("@page { size: A4; margin: 0.5in; }"));
        assertEquals("A4", OpenHtmlToPdfRenderer.PAGE_SIZE);
        assertEquals(210, OpenHtmlToPdfRenderer.PAGE_WIDTH_MM);
        assertEquals(297, OpenHtmlToPdfRenderer.PAGE_HEIGHT_MM);
        // 0.5in page margin + 40pt body margin = 12.7 + 14.11 mm
        assertEquals(26.8, OpenHtmlToPdfRenderer.PAGE_MARGIN_MM, 0.05);
    }

    @Test void theRenderedPdfReallyIsA4() throws Exception {
        byte[] pdf = new OpenHtmlToPdfRenderer().render("<p>Page size check</p>");
        try (var doc = org.apache.pdfbox.pdmodel.PDDocument.load(pdf)) {
            var box = doc.getPage(0).getMediaBox();
            assertEquals(595.3, box.getWidth(), 0.5);   // 210 mm
            assertEquals(841.9, box.getHeight(), 0.5);  // 297 mm
        }
    }
}
