package com.hrms.app.reports;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The server-side report PDFs: real PDFs with the report's numbers, the
 * company's name (never the product's), and Workforce Analytics sections that
 * follow the reader's permissions. No Spring context, no database.
 */
class ReportPdfServiceTest {

    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID ENG = UUID.fromString("dddddddd-dddd-dddd-dddd-dddddddddddd");

    private ReportService reports;
    private ReportPdfService service;

    @BeforeEach
    void setUp() {
        reports = mock(ReportService.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(UUID.class))).thenReturn(List.of("Acme <Retail> & Co"));
        service = new ReportPdfService(reports, jdbc);
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static String text(byte[] pdf) throws Exception {
        try (PDDocument doc = PDDocument.load(pdf)) {
            return new PDFTextStripper().getText(doc);
        }
    }

    @Test
    void headcountPdfCarriesTheNumbersAndTheCompanyName() throws Exception {
        LocalDate asOf = LocalDate.of(2026, 9, 1);
        when(reports.headcountReport(CO, asOf)).thenReturn(List.of(
                row("department_id", null, "department", null, "total", 2L, "active", 2L, "on_notice", 0L, "probation", 0L),
                row("department_id", ENG, "department", "Engineering", "total", 12L, "active", 9L, "on_notice", 1L, "probation", 2L)));

        ReportPdfService.Rendered r = service.render(ReportKind.HEADCOUNT, new ReportPdfService.Params(CO, null, null, asOf, null),
                Set.of("hrms.report.headcount"), "Downloaded by Asha Rao");

        assertThat(new String(r.bytes(), 0, 5)).isEqualTo("%PDF-");
        assertThat(r.fileName()).isEqualTo("headcount-acme-retail-co-2026-09-01.pdf");
        assertThat(r.rowCount()).isEqualTo(2);
        String t = text(r.bytes());
        assertThat(t).contains("Headcount report", "Acme <Retail> & Co", "Engineering", "No department", "Downloaded by Asha Rao", "1 Sep 2026");
        assertThat(t).contains("14"); // total headcount
        assertThat(t.toLowerCase()).doesNotContain("unifiedtree").doesNotContain("unified tree");
    }

    @Test
    void attritionAndLateMarksRender() throws Exception {
        LocalDate from = LocalDate.of(2026, 7, 1), to = LocalDate.of(2026, 9, 30);
        when(reports.attritionReport(CO, from, to)).thenReturn(List.of(
                row("month", "2026-07", "exits", 0L, "resignations", 0L, "terminations", 0L, "other_exits", 0L, "headcount", 20L, "attrition_pct", 0),
                row("month", "2026-08", "exits", 2L, "resignations", 1L, "terminations", 1L, "other_exits", 0L, "headcount", 18L, "attrition_pct", 10.53)));
        String t = text(service.render(ReportKind.ATTRITION, new ReportPdfService.Params(CO, from, to, null, null), Set.of(), null).bytes());
        assertThat(t).contains("Attrition report", "Aug 2026", "10.5");

        when(reports.lateMarksReport(CO, from, to)).thenReturn(List.of(
                row("employee_code", "E1", "employee_name", "Rahul Verma", "department", "Sales", "attendance_date", java.sql.Date.valueOf("2026-09-02"),
                        "late_by_minutes", 25, "check_in_at", java.sql.Timestamp.from(java.time.Instant.parse("2026-09-02T04:25:00Z")))));
        String late = text(service.render(ReportKind.LATE_MARKS, new ReportPdfService.Params(CO, from, to, null, null), Set.of(), null).bytes());
        assertThat(late).contains("Rahul Verma", "9:55 am", "2 Sep 2026");
    }

    @Test
    void workforceAnalyticsIncludesOnlyTheSectionsTheReaderMayOpen() throws Exception {
        LocalDate from = LocalDate.of(2025, 10, 1), to = LocalDate.of(2026, 9, 25);
        when(reports.headcountReport(eq(CO), any())).thenReturn(List.of(
                row("department_id", ENG, "department", "Engineering", "total", 5L, "active", 5L, "on_notice", 0L, "probation", 0L)));

        String t = text(service.render(ReportKind.WORKFORCE_ANALYTICS, new ReportPdfService.Params(CO, from, to, to, null),
                Set.of("hrms.report.headcount"), null).bytes());
        assertThat(t).contains("Headcount by department", "Engineering").doesNotContain("Gender diversity").doesNotContain("Monthly attrition");
        verify(reports, never()).diversityReport(any());
        verify(reports, never()).attritionReport(any(), any(), any());
    }

    @Test
    void anUnknownCompanyIsNotFound() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(String.class), any(UUID.class))).thenReturn(List.of());
        ReportPdfService s = new ReportPdfService(reports, jdbc);
        assertThatThrownBy(() -> s.render(ReportKind.DIVERSITY, new ReportPdfService.Params(CO, null, null, null, null), Set.of(), null))
                .isInstanceOf(com.hrms.core.exception.ResourceNotFoundException.class);
    }

    @Test
    void formattingHelpers() {
        assertThat(ReportPdfService.num(1234567)).isEqualTo("12,34,567");
        assertThat(ReportPdfService.num(999)).isEqualTo("999");
        assertThat(ReportPdfService.num(-1000)).isEqualTo("-1,000");
        assertThat(ReportPdfService.month("2026-01")).isEqualTo("Jan 2026");
        assertThat(ReportPdfService.slug("  Acme Retail Pvt. Ltd ")).isEqualTo("acme-retail-pvt-ltd");
        assertThat(ReportPdfService.slug("")).isEqualTo("company");
        assertThat(ReportPdfService.typeLabel("CASUAL_LEAVE")).isEqualTo("Casual leave");
        assertThat(ReportPdfService.typeLabel("Sick leave")).isEqualTo("Sick leave");
        assertThat(ReportPdfService.hm(125)).isEqualTo("2h 05m");
        assertThat(ReportPdfService.mins(75)).isEqualTo("1h 15m");
        assertThat(ReportHtml.esc("<b>\"x\" & 'y'</b>")).isEqualTo("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
        assertThat(ReportHtml.cssString("a\"b\\c\n</style>")).doesNotContain("\n").doesNotContain("<").contains("\\\"");
    }
}
