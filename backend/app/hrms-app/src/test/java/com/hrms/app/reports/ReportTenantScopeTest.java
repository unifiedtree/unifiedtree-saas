package com.hrms.app.reports;

import com.hrms.attendance.policy.EffectiveDay;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Every report query filters every table it reads by the bound tenant
 * (BW-86..88 rule: parameters only), and the diversity report as of a date
 * counts the same people the headcount report counts on that date, from the
 * same status-history query.
 */
class ReportTenantScopeTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final LocalDate D = LocalDate.of(2026, 9, 15);
    /** schema.table alias, as it appears after FROM or JOIN. */
    private static final Pattern TABLE = Pattern.compile("(?:FROM|JOIN)\\s+([a-z_]+\\.[a-z_]+)\\s+([a-z]+)\\b", Pattern.CASE_INSENSITIVE);

    private JdbcTemplate jdbc;
    private ReportService reports;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(new ArrayList<>());
        reports = new ReportService(jdbc);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    /** Every schema.table alias in the SQL has "alias.tenant_id = ?", and the args carry the tenant that many times or more. */
    private static void assertTenantScoped(String sql, Object[] args) {
        Matcher m = TABLE.matcher(sql);
        int tables = 0;
        while (m.find()) {
            tables++;
            String alias = m.group(2);
            assertThat(sql).as("%s (%s) is filtered by tenant", m.group(1), alias).contains(alias + ".tenant_id = ?");
        }
        assertThat(tables).as("the query reads tables").isPositive();
        long bound = Arrays.stream(args).filter(TENANT::equals).count();
        int clauses = sql.split("tenant_id = \\?", -1).length - 1;
        assertThat(bound).as("the tenant is bound once per tenant clause").isEqualTo(clauses);
    }

    private void captureAndAssert(int calls) {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc, atLeastOnce()).queryForList(sql.capture(), args.capture());
        assertThat(sql.getAllValues()).hasSize(calls);
        for (int i = 0; i < calls; i++) assertTenantScoped(sql.getAllValues().get(i), args.getAllValues().get(i));
    }

    @Test
    void headcountQueryIsTenantScopedAndReadsTheStatusOnTheDate() {
        reports.headcountReport(CO, D);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(sql.capture(), args.capture());
        assertTenantScoped(sql.getValue(), args.getValue());
        assertThat(sql.getValue()).contains(ReportService.STATUS_ON).contains(ReportService.EMPLOYED_ON);
        assertThat(args.getValue()).containsExactly(TENANT, D, TENANT, D, D, TENANT, TENANT, CO, D, D);
    }

    @Test
    void diversityAsOfCountsTheSamePeopleAsHeadcountOnThatDate() {
        reports.diversityReport(CO, D);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(sql.capture(), args.capture());
        String q = sql.getValue();
        assertTenantScoped(q, args.getValue());
        // Same status-history CTEs and the same "employed on" rule as the headcount report…
        assertThat(q).contains(ReportService.STATUS_ON).contains(ReportService.EMPLOYED_ON);
        assertThat(q).contains("hrms.employee_status_history");
        // …and exactly its active + on notice + probation people (suspended and others are not counted).
        assertThat(q).contains("l.employee_id IS NOT NULL")
                .contains("IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD', 'EXITED', 'TERMINATED', 'RESIGNED')");
        assertThat(args.getValue()).containsExactly(TENANT, D, TENANT, D, D, TENANT, TENANT, CO, D, D);
    }

    @Test
    void diversityWithoutADateIsTodaysReportUnchanged() {
        reports.diversityReport(CO, null);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(sql.capture(), args.capture());
        assertThat(sql.getValue()).doesNotContain("employee_status_history")
                .contains("e.employment_status IN ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD')");
        assertTenantScoped(sql.getValue(), args.getValue());
    }

    @Test
    void theOtherReportsAreTenantScoped() {
        reports.attritionReport(CO, D.minusMonths(5), D);
        reports.attendanceSummaryReport(CO, D.minusDays(6), D);
        reports.leaveBalanceReport(CO, 2026);
        reports.lateMarksReport(CO, D.minusDays(6), D);
        captureAndAssert(4);
    }

    @Test
    @SuppressWarnings("unchecked")
    void attendanceDailyListsEveryDayAndIsTenantScoped() {
        UUID emp = UUID.randomUUID();
        when(jdbc.queryForList(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(List.of(emp));
        List<Map<String, Object>> days = reports.attendanceDaily(CO, D.minusDays(2), D);
        assertThat(days).extracting(x -> x.get("date")).containsExactly("2026-09-13", "2026-09-14", "2026-09-15");
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(sql.capture(), eq(UUID.class), args.capture());
        assertTenantScoped(sql.getValue(), args.getValue());
        // Without the policy service: one per attendance record, counted per day, tenant-scoped.
        ArgumentCaptor<String> perDay = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> perDayArgs = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(perDay.capture(), any(org.springframework.jdbc.core.RowCallbackHandler.class), perDayArgs.capture());
        assertTenantScoped(perDay.getValue(), perDayArgs.getValue());
    }

    @Test
    void workedDaysAreCountedPerDayLikeTheSummaryCountsPresentDays() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        Map<LocalDate, Long> perDay = new TreeMap<>(Map.of(D, 0L, D.plusDays(1), 0L));
        Map<UUID, Map<LocalDate, EffectiveDay>> eff = Map.of(
                a, Map.of(D, day(a, D, EffectiveDay.LATE), D.plusDays(1), day(a, D.plusDays(1), EffectiveDay.ABSENT)),
                b, Map.of(D, day(b, D, EffectiveDay.HALF_DAY), D.plusDays(1), day(b, D.plusDays(1), EffectiveDay.PRESENT)));
        ReportService.countWorkedDays(perDay, List.of(a, b), eff);
        assertThat(perDay).containsEntry(D, 2L).containsEntry(D.plusDays(1), 1L);
    }

    private static EffectiveDay day(UUID emp, LocalDate d, String status) {
        return new EffectiveDay(emp, d, status, status, null, null, null, null, null, false, null, false, null, null,
                null, false, 1.0, false, null, null, null, null, false, false, null, null, null, null, 15, null);
    }
}
