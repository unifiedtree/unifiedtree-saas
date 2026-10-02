package com.hrms.app.reports;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

import java.sql.Date;
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
 * BW-86/87/88: each tile series only with its own report's permission, built
 * from the report's own rows; the headcount change and trend use the headcount
 * report's totals; the fiscal year comes from the company in this tenant.
 */
class ReportInsightsServiceTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 2);

    private ReportService reports;
    private JdbcTemplate jdbc;
    private ReportInsightsService insights;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        reports = mock(ReportService.class);
        jdbc = mock(JdbcTemplate.class);
        insights = new ReportInsightsService(reports, jdbc);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void eachSeriesOnlyWithItsOwnPermission() {
        when(reports.headcountReport(CO, TODAY)).thenReturn(List.of(row("department_id", null, "department", "Ops", "total", 4L)));
        when(reports.attendanceDaily(eq(CO), any(), any())).thenReturn(List.of());
        when(reports.lateMarksReport(eq(CO), any(), any())).thenReturn(List.of());
        Set<String> held = Set.of("hrms.report.headcount", "hrms.report.attendance");

        Map<String, Object> out = insights.summary(CO, TODAY, held::contains);

        assertThat(out).containsKeys("headcount", "attendance", "lateMarks");
        assertThat(out).doesNotContainKeys("attrition", "diversity", "leaveBalance");
        verify(reports, never()).attritionReport(any(), any(), any());
        verify(reports, never()).diversityReport(any());
        verify(reports, never()).leaveBalanceReport(any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void noPermissionNoSeriesAtAll() {
        Map<String, Object> out = insights.summary(CO, TODAY, code -> false);
        assertThat(out).containsOnlyKeys("companyId", "asOf");
        verify(reports, never()).headcountReport(any(), any());
    }

    @Test
    void everySeriesWithEveryPermissionAndTheRightRanges() {
        when(reports.headcountReport(CO, TODAY)).thenReturn(List.of());
        when(reports.attritionReport(CO, LocalDate.of(2026, 5, 1), TODAY)).thenReturn(List.of(
                row("month", "2026-09", "exits", 2L, "headcount", 40L, "attrition_pct", new java.math.BigDecimal("4.88"))));
        when(reports.diversityReport(CO)).thenReturn(List.of());
        when(reports.attendanceDaily(CO, TODAY.minusDays(6), TODAY)).thenReturn(List.of());
        when(reports.lateMarksReport(CO, TODAY.minusDays(13), TODAY)).thenReturn(List.of());
        when(reports.leaveBalanceReport(CO, 2026)).thenReturn(List.of());

        Map<String, Object> out = insights.summary(CO, TODAY, code -> true);

        assertThat(out).containsKeys("headcount", "attrition", "diversity", "attendance", "lateMarks", "leaveBalance");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> months = (List<Map<String, Object>>) ((Map<String, Object>) out.get("attrition")).get("months");
        assertThat(months).singleElement().satisfies(m -> {
            assertThat(m.get("pct")).isEqualTo(4.88);
            assertThat(m.get("exits")).isEqualTo(2L);
        });
    }

    @Test
    void headcountSeriesIsTheReportsDepartmentsBiggestFirst() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        Map<String, Object> s = ReportInsightsService.headcountSeries(List.of(
                row("department_id", null, "department", null, "total", 9L),
                row("department_id", a, "department", "Sales", "total", 3L),
                row("department_id", b, "department", "Eng", "total", 7L)));
        assertThat(s.get("total")).isEqualTo(19L);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> d = (List<Map<String, Object>>) s.get("departments");
        assertThat(d).extracting(x -> x.get("name")).containsExactly("Eng", "Sales", null);
    }

    @Test
    void diversityLateAndLeaveSeriesAddUpTheReportRows() {
        Map<String, Object> div = ReportInsightsService.diversitySeries(List.of(
                row("gender", "FEMALE", "count", 3L), row("gender", "MALE", "count", 5L),
                row("gender", "NOT_SPECIFIED", "count", 2L), row("gender", "FEMALE", "count", 1L)));
        assertThat(div).containsEntry("women", 4L).containsEntry("men", 5L).containsEntry("other", 2L).containsEntry("total", 11L);

        LocalDate from = LocalDate.of(2026, 9, 29);
        Map<String, Object> late = ReportInsightsService.lateSeries(List.of(
                row("attendance_date", Date.valueOf(from)), row("attendance_date", Date.valueOf(from)),
                row("attendance_date", from.plusDays(2))), from, from.plusDays(3));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> days = (List<Map<String, Object>>) late.get("days");
        assertThat(days).extracting(x -> x.get("count")).containsExactly(2L, 0L, 1L, 0L);

        Map<String, Object> leave = ReportInsightsService.leaveSeries(List.of(
                row("total_entitlement", 12, "carry_forward", 2, "used", 4.5, "pending", 1, "available", 8.5),
                row("total_entitlement", 6, "carry_forward", 0, "used", 1, "pending", 0, "available", 5)), 2026);
        assertThat(leave).containsEntry("entitlement", 20.0).containsEntry("used", 5.5).containsEntry("pending", 1.0)
                .containsEntry("available", 13.5).containsEntry("year", 2026);
    }

    @Test
    void headcountChangeUsesTheReportTotalsAndTheTenant() {
        LocalDate from = LocalDate.of(2026, 9, 30);
        when(reports.headcountReport(CO, from)).thenReturn(List.of(row("total", 30L), row("total", 4L)));
        when(reports.headcountReport(CO, TODAY)).thenReturn(List.of(row("total", 36L)));
        when(jdbc.queryForMap(anyString(), any(Object[].class))).thenReturn(row("joined", 3L, "left_count", 1L));

        Map<String, Object> out = insights.headcountChange(CO, from, TODAY);

        assertThat(out).containsEntry("headcountFrom", 34L).containsEntry("headcountTo", 36L).containsEntry("change", 2L)
                .containsEntry("joined", 3L).containsEntry("left", 1L);
        verify(jdbc).queryForMap(org.mockito.ArgumentMatchers.contains("e.tenant_id = ?"), eq(from), eq(TODAY), eq(from), eq(TODAY), eq(TENANT), eq(CO));
    }

    @Test
    void headcountChangeRefusesDatesTheWrongWayRound() {
        assertThatThrownBy(() -> insights.headcountChange(CO, TODAY, TODAY.minusDays(1))).hasMessageContaining("start date");
    }

    @Test
    void trendIsMonthEndHeadcountWithTheLastPointOnTheDate() {
        when(reports.headcountReport(eq(CO), any())).thenAnswer(inv -> {
            LocalDate d = inv.getArgument(1);
            return List.of(row("total", (long) d.getMonthValue() * 10));
        });
        List<Map<String, Object>> t = insights.headcountTrend(CO, 3, null, TODAY);
        assertThat(t).extracting(p -> p.get("month")).containsExactly("2026-08", "2026-09", "2026-10");
        assertThat(t).extracting(p -> p.get("asOf")).containsExactly("2026-08-31", "2026-09-30", "2026-10-02");
        assertThat(t).extracting(p -> p.get("headcount")).containsExactly(80L, 90L, 100L);
        // A date in the future is today; months are kept within 1..24.
        assertThat(insights.headcountTrend(CO, 99, TODAY.plusDays(40), TODAY)).hasSize(24).last()
                .satisfies(p -> assertThat(p.get("asOf")).isEqualTo("2026-10-02"));
        assertThat(insights.headcountTrend(CO, 0, null, TODAY)).hasSize(1);
    }

    @Test
    @SuppressWarnings("unchecked")
    void fiscalYearComesFromTheCompanyInThisTenant() {
        when(jdbc.query(org.mockito.ArgumentMatchers.contains("tenant_id = ?"), any(ResultSetExtractor.class), eq(CO), eq(TENANT)))
                .thenReturn("JANUARY");
        assertThat(insights.fiscalYear(CO, TODAY)).containsEntry("from", "2026-01-01").containsEntry("to", "2026-12-31")
                .containsEntry("label", "FY 2026");
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(CO), eq(TENANT))).thenReturn(null);
        assertThat(insights.fiscalYear(CO, TODAY)).containsEntry("from", "2026-04-01").containsEntry("label", "FY 2026-27");
    }
}
