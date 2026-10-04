package com.hrms.app.reports;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The attendance summary (and the muster download and Reports Center tile that
 * read it) counts everyone on the roll during the range: probation, notice
 * period and on-leave people too, and someone who left mid-range for the days
 * before they left. It used to read ACTIVE people only, so a company whose
 * staff were all still on probation showed one person and no present days.
 */
class ReportAttendanceRollTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final LocalDate FROM = LocalDate.of(2026, 10, 1), TO = LocalDate.of(2026, 10, 4);

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

    @Test
    void theRollRuleKeepsEveryoneStillEmployedAndDropsOnlyThoseGoneBeforeTheRange() {
        String rule = ReportService.ON_ROLL_DURING;
        // Joined by the range's last day (no joining date: the day the record was made).
        assertThat(rule).contains("COALESCE(e.date_of_joining, (e.created_at AT TIME ZONE 'Asia/Kolkata')::date) <= ?");
        // Only an exit whose last working day is before the range's first day takes someone off the roll.
        assertThat(rule).contains("e.employment_status IN ('EXITED', 'TERMINATED', 'RESIGNED', 'RETIRED')")
                .contains("COALESCE(e.last_working_day, e.date_of_termination, DATE '1900-01-01') < ?");
        // No status is required: probation, notice period, on leave and suspended people stay.
        assertThat(rule).doesNotContain("= 'ACTIVE'").doesNotContain("PROBATION");
        assertThat(rule).startsWith(" ");
    }

    @Test
    void theSummaryReadsThePeopleOnTheRollNotJustActiveOnes() {
        reports.attendanceSummaryReport(CO, FROM, TO);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(sql.capture(), args.capture());
        assertThat(sql.getValue()).doesNotContain("employment_status = 'ACTIVE'")
                .contains("AND e.company_id = ?\n  AND" + ReportService.ON_ROLL_DURING)
                .doesNotContainPattern("(?i)\\bAND(COALESCE|e\\.)");
        // The punches in the range, then the company, then the roll: last day, first day.
        assertThat(args.getValue()).containsExactly(TENANT, TENANT, FROM, TO, TENANT, CO, TO, FROM);
    }

    @Test
    @SuppressWarnings("unchecked")
    void theDailyTileCountsTheSamePeople() {
        UUID emp = UUID.randomUUID();
        when(jdbc.queryForList(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(List.of(emp));
        reports.attendanceDaily(CO, FROM, TO);
        ArgumentCaptor<String> ids = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> idArgs = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(ids.capture(), eq(UUID.class), idArgs.capture());
        assertThat(ids.getValue()).doesNotContain("'ACTIVE'").endsWith("AND" + ReportService.ON_ROLL_DURING);
        assertThat(idArgs.getValue()).containsExactly(TENANT, CO, TO, FROM);
        // Without the policy service: one per attendance record of the same people.
        ArgumentCaptor<String> perDay = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> perDayArgs = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(perDay.capture(), any(org.springframework.jdbc.core.RowCallbackHandler.class), perDayArgs.capture());
        assertThat(perDay.getValue()).doesNotContain("'ACTIVE'").contains("AND" + ReportService.ON_ROLL_DURING);
        assertThat(perDayArgs.getValue()).containsExactly(TENANT, TENANT, CO, FROM, TO, TO, FROM);
    }
}
