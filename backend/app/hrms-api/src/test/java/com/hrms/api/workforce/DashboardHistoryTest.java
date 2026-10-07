package com.hrms.api.workforce;

import com.hrms.employee.repository.EmployeeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.Date;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Production, 7 Oct 2026: people saved without a joining date were on the day's
 * attendance roster and in past days' headcounts, but not in today's Total
 * employees (17 → 15 with nobody leaving) or a range ending today. The rows are
 * loaded here; today, a past day and a range now read them alike.
 */
class DashboardHistoryTest {

    private static final UUID TENANT = UUID.randomUUID(), COMPANY = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.now(DashboardAsOf.IST);

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final DashboardHistory history = new DashboardHistory(jdbc, mock(EmployeeRepository.class));
    private final List<ResultSet> rows = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() throws Exception {
        // Two dated people (one joined today), and two without a joining date whose records were created three days ago.
        rows.add(row(LocalDate.of(2025, 1, 6), LocalDate.of(2025, 1, 6), "ACTIVE"));
        rows.add(row(TODAY, TODAY, "PROBATION"));
        rows.add(row(null, TODAY.minusDays(3), "ACTIVE"));
        rows.add(row(null, TODAY.minusDays(3), "PROBATION"));
        when(jdbc.query(contains("FROM hrms.employees WHERE tenant_id = ? AND company_id = ?"), any(RowMapper.class), any(), any()))
                .thenAnswer(inv -> {
                    RowMapper<DashboardAsOf.Person> mapper = inv.getArgument(1);
                    List<DashboardAsOf.Person> out = new ArrayList<>();
                    for (int i = 0; i < rows.size(); i++) out.add(mapper.mapRow(rows.get(i), i));
                    return out;
                });
        when(jdbc.query(contains("hrms.employee_status_history"), any(RowMapper.class), any(), any())).thenReturn(List.of());
    }

    @Test void todaysTotalCountsPeopleWithoutAJoiningDate() {
        DashboardAsOf.Headcount today = history.headcount(TENANT, COMPANY, TODAY);
        assertEquals(4, today.total(), "everyone on the roll, as the day's roster lists them");
        assertEquals(2, today.active());
        assertEquals(2, today.probation());
    }

    @Test void todayAndYesterdayCountThemAlike() {
        DashboardAsOf.Headcount today = history.headcount(TENANT, COMPANY, TODAY);
        DashboardAsOf.Headcount yesterday = history.headcount(TENANT, COMPANY, TODAY.minusDays(1), true);
        assertEquals(3, yesterday.total());
        assertEquals(today.total() - 1, yesterday.total(), "the only change is today's joiner");
    }

    @Test void aRangeEndingTodayCountsThemAsJoinersAsAPastRangeDoes() {
        DashboardAsOf.Moves week = history.moves(TENANT, COMPANY, TODAY.minusDays(6), TODAY, false);
        DashboardAsOf.Moves pastWeek = history.moves(TENANT, COMPANY, TODAY.minusDays(7), TODAY.minusDays(1), true);
        assertEquals(3, week.joined(), "the two created three days ago and today's joiner");
        assertEquals(2, pastWeek.joined());
    }

    private static ResultSet row(LocalDate joined, LocalDate created, String status) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(UUID.randomUUID());
        when(rs.getDate("date_of_joining")).thenReturn(joined == null ? null : Date.valueOf(joined));
        when(rs.getDate("created_on")).thenReturn(Date.valueOf(created));
        when(rs.getString("employment_status")).thenReturn(status);
        return rs;
    }
}
