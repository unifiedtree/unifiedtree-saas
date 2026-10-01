package com.hrms.app.reports;

import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.transaction.PlatformTransactionManager;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * BW-89: daily and weekday emails and the send hour, the new CHECKs, the
 * FEATURE_NOT_READY answer before V143.62, the CSV next to the PDF, and the
 * job sending only on the right day and hour.
 */
class ReportScheduleOptionsTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID HRM = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Set<String> OWNER = Set.of("hrms.report.headcount", "hrms.report.attendance", "hrms.report.schedule.manage");

    private JdbcTemplate jdbc;
    private ReportService reports;
    private ReportScheduleService service;

    @BeforeEach
    void setUp() throws Exception {
        TenantContext.setTenantId(TENANT);
        jdbc = mock(JdbcTemplate.class);
        reports = mock(ReportService.class);
        service = new ReportScheduleService(jdbc, mock(ReportPdfService.class), reports, mock(ReportExportLog.class),
                mock(MailService.class), mock(AuditService.class), mock(PlatformTransactionManager.class));
        // The company is in this tenant.
        when(jdbc.queryForList(contains("FROM org.companies"), eq(Integer.class), eq(CO), eq(TENANT))).thenReturn(List.of(1));
        // One recipient who can open the headcount report.
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            ResultSet rs = mock(ResultSet.class);
            String sql = inv.getArgument(0);
            if (sql.contains("auth.user_credentials")) {
                when(rs.getObject("id", UUID.class)).thenReturn(HRM);
                when(rs.getString("name")).thenReturn("Hema");
                when(rs.getString("email")).thenReturn("hrm@example.test");
            } else {
                when(rs.getObject("user_id", UUID.class)).thenReturn(HRM);
                when(rs.getString("permission_code")).thenReturn("hrms.report.headcount");
            }
            h.processRow(rs);
            return null;
        }).when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static ReportScheduleService.Request req(String frequency, Integer dow, Integer dom, Integer hour) {
        return new ReportScheduleService.Request("headcount", CO, frequency, dow, dom, List.of(HRM), true, hour);
    }

    @Test
    void dailyAndWeekdaysNeedNoDayAndKeepTheHour() {
        ReportScheduleService.Checked daily = service.check(req("daily", 3, 9, 11), OWNER, true);
        assertThat(daily.frequency()).isEqualTo(ReportPeriods.Frequency.DAILY);
        assertThat(daily.dayOfWeek()).isNull();
        assertThat(daily.dayOfMonth()).isNull();
        assertThat(daily.sendHour()).isEqualTo(11);
        ReportScheduleService.Checked weekdays = service.check(req("WEEKDAYS", null, null, null), OWNER, true);
        assertThat(weekdays.frequency()).isEqualTo(ReportPeriods.Frequency.WEEKDAYS);
        assertThat(weekdays.sendHour()).isNull();
    }

    @Test
    void weeklyAndMonthlyStillNeedTheirDay() {
        assertThatThrownBy(() -> service.check(req("WEEKLY", null, null, null), OWNER, true)).isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> service.check(req("MONTHLY", null, 29, null), OWNER, true)).isInstanceOf(BusinessRuleException.class);
        assertThat(service.check(req("WEEKLY", 1, null, 9), OWNER, true).dayOfWeek()).isEqualTo(1);
        assertThatThrownBy(() -> service.check(req("HOURLY", null, null, null), OWNER, true))
                .isInstanceOf(BusinessRuleException.class).hasMessageContaining("how often");
    }

    @Test
    void theSendHourIsSevenToEleven() {
        assertThatThrownBy(() -> service.check(req("DAILY", null, null, 6), OWNER, true)).isInstanceOf(BusinessRuleException.class);
        assertThatThrownBy(() -> service.check(req("DAILY", null, null, 24), OWNER, true)).isInstanceOf(BusinessRuleException.class);
        assertThat(service.check(req("DAILY", null, null, 7), OWNER, true).sendHour()).isEqualTo(7);
        assertThat(service.check(req("DAILY", null, null, 23), OWNER, true).sendHour()).isEqualTo(23);
    }

    @Test
    void beforeTheMigrationTheNewOptionsAreNotReadyButWeeklyStillWorks() {
        assertThatThrownBy(() -> service.check(req("DAILY", null, null, null), OWNER, false)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> service.check(req("WEEKDAYS", null, null, null), OWNER, false)).isInstanceOf(FeatureNotReady.class);
        assertThatThrownBy(() -> service.check(req("WEEKLY", 1, null, 9), OWNER, false)).isInstanceOf(FeatureNotReady.class);
        assertThat(service.check(req("WEEKLY", 1, null, null), OWNER, false).frequency()).isEqualTo(ReportPeriods.Frequency.WEEKLY);
    }

    @Test
    void youCantScheduleAReportYouCantOpen() {
        assertThatThrownBy(() -> service.check(req("DAILY", null, null, null), Set.of("hrms.report.leave"), true))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    }

    @Test
    void optionsFollowTheCatalog() {
        when(jdbc.queryForObject(contains("send_hour"), eq(Boolean.class))).thenReturn(true);
        ReportScheduleService.Options on = service.options();
        assertThat(on.ready()).isTrue();
        assertThat(on.frequencies()).containsExactly("DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY");
        assertThat(on.firstHour()).isEqualTo(7);
        assertThat(on.lastHour()).isEqualTo(23);
        when(jdbc.queryForObject(contains("send_hour"), eq(Boolean.class))).thenReturn(false);
        assertThat(service.options().frequencies()).containsExactly("WEEKLY", "MONTHLY");
    }

    @Test
    void theJobWaitsForTheSendHourAndClaimsOnlyWhenDue() {
        LocalDate today = LocalDate.of(2026, 10, 2);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", UUID.randomUUID());
        row.put("next_run_on", java.sql.Date.valueOf(today));
        row.put("frequency", "WEEKDAYS");
        row.put("send_hour", (short) 11);
        row.put("recipient_user_ids", List.of(HRM));
        when(jdbc.queryForList(contains("next_run_on <= ?"), eq(TENANT), eq(today))).thenReturn(new ArrayList<>(List.of(row)));

        assertThat(service.sendDue(today, 9)).isZero();
        verify(jdbc, never()).update(contains("SET next_run_on = ?"), any(Object[].class));

        // At 11 it is claimed (another instance got it first here, so nothing is sent twice).
        when(jdbc.update(contains("SET next_run_on = ?"), any(Object[].class))).thenReturn(0);
        assertThat(service.sendDue(today, 11)).isZero();
        verify(jdbc).update(contains("SET next_run_on = ?"), eq(LocalDate.of(2026, 10, 5)), eq(row.get("id")), eq(TENANT), eq(today));
    }

    @Test
    void anEmailCarriesTheReportsCsvAndWorkforceAnalyticsOnePerSectionTheGroupMayRead() {
        when(reports.headcountReport(CO, LocalDate.of(2026, 9, 30))).thenReturn(new ArrayList<>(List.of(Map.of("department", "Ops", "total", 3))));
        ReportPeriods.Period period = new ReportPeriods.Period(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30));
        ReportPdfService.Params p = ReportPeriods.params(ReportKind.HEADCOUNT, CO, period);
        List<ReportScheduleService.CsvFile> one = service.csvFiles(ReportKind.HEADCOUNT, p, Set.of("hrms.report.headcount"), "Acme Retail", period);
        assertThat(one).singleElement().satisfies(c -> {
            assertThat(c.fileName()).isEqualTo("headcount-acme-retail-2026-09-30.csv");
            assertThat(new String(c.bytes(), StandardCharsets.UTF_8)).contains("Ops");
            assertThat(c.rows()).isEqualTo(1);
        });

        ReportPdfService.Params wfa = ReportPeriods.params(ReportKind.WORKFORCE_ANALYTICS, CO, period);
        when(reports.diversityReport(CO)).thenReturn(new ArrayList<>());
        List<ReportScheduleService.CsvFile> parts = service.csvFiles(ReportKind.WORKFORCE_ANALYTICS, wfa,
                Set.of("hrms.report.headcount", "hrms.report.diversity"), "Acme Retail", period);
        assertThat(parts).extracting(ReportScheduleService.CsvFile::kind).containsExactly(ReportKind.HEADCOUNT, ReportKind.DIVERSITY);
        verify(reports, never()).attritionReport(any(), any(), any());
    }

    @Test
    void csvMatchesTheDownloadFormat() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("name", "Rao, Asha");
        r.put("note", "said \"hi\"");
        r.put("n", null);
        String csv = new String(ReportCsv.bytes(List.of(r)), StandardCharsets.UTF_8);
        assertThat(csv).isEqualTo("﻿name,note,n\r\n\"Rao, Asha\",\"said \"\"hi\"\"\",\r\n");
        assertThat(new String(ReportCsv.bytes(List.of()), StandardCharsets.UTF_8)).isEqualTo("﻿");
    }

    @Test
    void theMigrationWidensBothChecksAndAddsTheHourIdempotently() throws Exception {
        Path f = Path.of("src/main/resources/db/canonical/V143_62__report_schedule_daily_weekdays_send_hour.sql");
        String sql = Files.readString(f);
        assertThat(sql).contains("CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'DAILY', 'WEEKDAYS'))")
                .contains("frequency IN ('DAILY', 'WEEKDAYS') AND day_of_week IS NULL AND day_of_month IS NULL")
                .contains("ADD COLUMN IF NOT EXISTS send_hour SMALLINT")
                .contains("send_hour IS NULL OR send_hour BETWEEN 7 AND 23");
        // Each constraint swap is guarded, so the file can run twice.
        assertThat(sql.split("IF NOT EXISTS \\(SELECT 1 FROM pg_constraint", -1)).hasSize(4);
        assertThat(sql).doesNotContain("rbac.permissions");
    }
}
