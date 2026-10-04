package com.hrms.api.payroll;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** My pay beyond the payslip list (BW-55): schedule, this year's totals, the month being prepared. */
class MyPayServiceTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID COMPANY = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID READER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 27);

    private JdbcTemplate jdbc;
    private MyPayService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        service = new MyPayService(jdbc);
        service.setClock(Clock.fixed(TODAY.atTime(12, 0).atZone(IST).toInstant(), IST));
    }

    private void settings(Integer startDay, Integer processingDay) {
        doReturn(startDay == null ? null : Map.of("start", startDay, "day", processingDay))
                .when(jdbc).query(contains("FROM payroll.settings"), any(ResultSetExtractor.class), any(Object[].class));
    }

    private void company(UUID company) {
        doReturn(company).when(jdbc).query(contains("SELECT company_id FROM hrms.employees"),
                any(ResultSetExtractor.class), any(Object[].class));
    }

    private void nextRunPayDate(LocalDate date) {
        doReturn(date).when(jdbc).query(contains("SELECT min(pay_date) FROM payroll.runs"),
                any(ResultSetExtractor.class), any(Object[].class));
    }

    private void runsInMonths(int... yearMonthPairs) {
        doAnswer(inv -> {
            RowCallbackHandler handler = inv.getArgument(1);
            for (int i = 0; i < yearMonthPairs.length; i += 2) {
                ResultSet rs = mock(ResultSet.class);
                when(rs.getInt("period_year")).thenReturn(yearMonthPairs[i]);
                when(rs.getInt("period_month")).thenReturn(yearMonthPairs[i + 1]);
                handler.processRow(rs);
            }
            return null;
        }).when(jdbc).query(contains("SELECT period_year, period_month FROM payroll.runs"),
                any(RowCallbackHandler.class), any(Object[].class));
    }

    // ── schedule ──────────────────────────────────────────────────────────────

    @Test
    void theNextRunsPayDateWins() {
        settings(1, 28);
        company(COMPANY);
        nextRunPayDate(LocalDate.of(2026, 9, 25).plusDays(3));
        runsInMonths(2026, 9);
        assertEquals(new MyPayService.PayScheduleDto("2026-09-28", 28), service.schedule(TENANT, READER));
        // Only the caller's own company's runs, still ahead and not paid.
        verify(jdbc).query(contains("status IN ('DRAFT','PROCESSING','LOCKED')"), any(ResultSetExtractor.class),
                eq(TENANT), eq(COMPANY), eq(TODAY));
        verify(jdbc).execute("SET LOCAL app.tenant_id = '" + TENANT + "'");
    }

    @Test
    void withoutARunTheProcessingDayOfTheNextMonthWithoutARun() {
        settings(1, 28);
        company(COMPANY);
        nextRunPayDate(null);
        runsInMonths();
        assertEquals(new MyPayService.PayScheduleDto("2026-09-28", 28), service.schedule(TENANT, READER));

        runsInMonths(2026, 9); // September's run is paid already (or its date has passed)
        assertEquals(new MyPayService.PayScheduleDto("2026-10-28", 28), service.schedule(TENANT, READER));
    }

    @Test
    void aLaterMonthsDraftDoesNotHideThisMonthsPayday() {
        // Audit 4 Oct: a November draft made early showed "Next payday 28 Nov"
        // although October had no run yet and is paid on the 28th.
        service.setClock(Clock.fixed(LocalDate.of(2026, 10, 4).atTime(12, 0).atZone(IST).toInstant(), IST));
        settings(1, 28);
        company(COMPANY);
        nextRunPayDate(LocalDate.of(2026, 11, 28));
        runsInMonths(2026, 9, 2026, 11);
        assertEquals(new MyPayService.PayScheduleDto("2026-10-28", 28), service.schedule(TENANT, READER));
    }

    @Test
    void aRunPaidEarlierThanTheProcessingDayStillWins() {
        settings(1, 28);
        company(COMPANY);
        nextRunPayDate(LocalDate.of(2026, 10, 5));
        runsInMonths(2026, 9, 2026, 10); // September paid; October's run pays on the 5th
        assertEquals(new MyPayService.PayScheduleDto("2026-10-05", 28), service.schedule(TENANT, READER));
    }

    @Test
    void noPayrollSettingsMeansNoDate() {
        settings(null, null);
        company(COMPANY);
        nextRunPayDate(null);
        runsInMonths();
        assertEquals(new MyPayService.PayScheduleDto(null, null), service.schedule(TENANT, READER));
    }

    @Test
    void anAccountWithoutAnEmployeeRecordGetsTheWorkspacesDateOnly() {
        settings(1, 30);
        assertEquals(new MyPayService.PayScheduleDto("2026-09-30", 30), service.schedule(TENANT, null));
        verify(jdbc, never()).query(contains("FROM payroll.runs"), any(ResultSetExtractor.class), any(Object[].class));
    }

    // ── this financial year ───────────────────────────────────────────────────

    @Test
    void theYearFollowsTheCompanyAndCountsOnlyFinalPayslips() {
        doReturn("APRIL").when(jdbc).query(contains("c.fiscal_year_start"), any(ResultSetExtractor.class), any(Object[].class));
        MyPayService.YtdDto sums = new MyPayService.YtdDto("FY 2026–27", "2026-04-01", "2027-03-31", "2026-09", "2027-03",
                4, new BigDecimal("120000"), new BigDecimal("2140.30"), new BigDecimal("117859.70"), BigDecimal.ZERO, null, null);
        doReturn(sums).when(jdbc).query(contains("r.status IN ('LOCKED','PAID')"), any(ResultSetExtractor.class), any(Object[].class));
        doReturn("NEW").when(jdbc).query(contains("SELECT tax_regime"), any(ResultSetExtractor.class), any(Object[].class));

        MyPayService.YtdDto ytd = service.ytd(TENANT, READER);

        assertEquals("FY 2026–27", ytd.label());
        assertEquals(4, ytd.payslips());
        assertEquals(new BigDecimal("117859.70"), ytd.net());
        assertNull(ytd.tds(), "no TDS line: payroll doesn't calculate income tax yet");
        assertEquals("NEW", ytd.taxRegime());
        verify(jdbc).query(contains("l.employee_id = ?"), any(ResultSetExtractor.class),
                eq(READER), eq(TENANT), eq(LocalDate.of(2026, 4, 1)), eq(LocalDate.of(2027, 3, 31)));
    }

    @Test
    void noEmployeeRecordMeansAnEmptyYear() {
        MyPayService.YtdDto ytd = service.ytd(TENANT, null);
        assertEquals(0, ytd.payslips());
        assertEquals(BigDecimal.ZERO, ytd.gross());
        assertEquals("2026-04-01", ytd.fyStart(), "April when nothing says otherwise");
    }

    // ── the month being prepared ──────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void theMonthBeingPreparedIsThePeriodOnlyForTheCallersCompanyAndEmployment() {
        doReturn(Map.of("company", COMPANY, "joined", LocalDate.of(2023, 9, 1)))
                .when(jdbc).query(contains("SELECT company_id, date_of_joining"), any(ResultSetExtractor.class), any(Object[].class));
        List<MyPayService.UpcomingDto> rows = List.of(new MyPayService.UpcomingDto("Oct 2026", 10, 2026, "2026-10-28", "BEING_PREPARED"));
        doReturn(rows).when(jdbc).query(contains("status IN ('DRAFT','PROCESSING')"), any(RowMapper.class), any(Object[].class));

        assertEquals(rows, service.upcoming(TENANT, READER));
        verify(jdbc).query(contains("AND period_end >= ?"), any(RowMapper.class),
                eq(TENANT), eq(COMPANY), eq(LocalDate.of(2023, 9, 1)));
    }

    @Test
    @SuppressWarnings("unchecked")
    void nobodyToPrepareForMeansNothing() {
        assertEquals(List.of(), service.upcoming(TENANT, null));
        doReturn(null).when(jdbc).query(contains("SELECT company_id, date_of_joining"), any(ResultSetExtractor.class), any(Object[].class));
        assertEquals(List.of(), service.upcoming(TENANT, READER));
        verify(jdbc, never()).query(contains("status IN ('DRAFT','PROCESSING')"), any(RowMapper.class), any(Object[].class));
    }
}
