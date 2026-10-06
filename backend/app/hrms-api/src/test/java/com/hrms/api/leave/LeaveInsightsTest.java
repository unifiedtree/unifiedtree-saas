package com.hrms.api.leave;

import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The Leave pages' reads (BW-37 stats, BW-39 calendar, BW-44 balances, BW-47
 * colleagues off): who sees what, that counts use the lists' own scopes (and
 * PENDING_L2 only for level-2 approvers), the colleagues-off privacy rules, and
 * the missing-table answer.
 */
class LeaveInsightsTest {

    private final UUID tenant = UUID.randomUUID(), me = UUID.randomUUID(), company = UUID.randomUUID();
    private JdbcTemplate jdbc;
    private LeaveInsightsService service;
    /** Every query: its SQL and its arguments. */
    private final List<String> sqls = new ArrayList<>();
    private final List<List<Object>> argsOf = new ArrayList<>();

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
        service = new LeaveInsightsService(jdbc);
    }

    @AfterEach void clear() { TenantContext.clear(); }

    private void record(org.mockito.invocation.InvocationOnMock inv) {
        Object[] all = inv.getArguments();
        sqls.add((String) all[0]);
        argsOf.add(Arrays.asList(all).subList(2, all.length));
    }

    private String sqlContaining(String part) {
        return sqls.stream().filter(s -> s.contains(part)).findFirst().orElseThrow(() -> new AssertionError("no query with " + part));
    }

    private List<Object> argsOfSqlContaining(String part) {
        for (int i = 0; i < sqls.size(); i++) if (sqls.get(i).contains(part)) return argsOf.get(i);
        throw new AssertionError("no query with " + part);
    }

    /** Answers the stats queries: pending 3 (1 new), PENDING_L2 2 (1 new), 2 people away today, 1 on the next day. */
    private void statsData() {
        doAnswer(inv -> {
            record(inv);
            Object status = inv.getArguments()[3];
            return "PENDING_L2".equals(status) ? new long[]{2, 1} : new long[]{3, 1};
        }).when(jdbc).query(contains("FILTER (WHERE lr.created_at"), any(ResultSetExtractor.class), any(Object[].class));
        doAnswer(inv -> { record(inv); return new long[]{2, 1}; })
                .when(jdbc).query(contains("COUNT(DISTINCT lr.employee_id)"), any(ResultSetExtractor.class), any(Object[].class));
        doAnswer(inv -> {
            record(inv);
            RowCallbackHandler h = inv.getArgument(1);
            h.processRow(monthRow("2026-09", 4, 5, 6.2));
            h.processRow(monthRow("2026-08", 2, 3, null));
            return null;
        }).when(jdbc).query(contains("date_trunc('month'"), any(RowCallbackHandler.class), any(Object[].class));
        doAnswer(inv -> { record(inv); return List.of(company); })
                .when(jdbc).query(contains("SELECT company_id FROM hrms.employees"), any(RowMapper.class), any(Object[].class));
        doAnswer(inv -> new Integer[]{6, 7}).when(jdbc).query(contains("weekend_days"), any(ResultSetExtractor.class), any(Object[].class));
    }

    private static ResultSet monthRow(String month, long approved, long decided, Double hours) throws SQLException {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getString("m")).thenReturn(month);
        when(rs.getLong("approved")).thenReturn(approved);
        when(rs.getLong("decided")).thenReturn(decided);
        when(rs.getDouble("avg_hours")).thenReturn(hours == null ? 0 : hours);
        when(rs.wasNull()).thenReturn(hours == null);
        return rs;
    }

    // ── stats ───────────────────────────────────────────────────────────────

    @Test void hrSeesTheWholeWorkspaceIncludingRequestsAwaitingHr() {
        statsData();
        LocalDate friday = LocalDate.of(2026, 9, 25);
        LeaveInsightsService.ApprovalStats s = service.approvalStats(me, true, 7, friday);
        assertEquals(LeaveInsightsService.Scope.TENANT, s.scope());
        assertEquals(3, s.pending());
        assertEquals(2, s.pendingL2());
        assertEquals(5, s.waiting());
        assertEquals(2, s.newLast24h());
        assertEquals(4, s.approvedThisMonth());
        assertEquals(2, s.approvedLastMonth());
        assertEquals(6.2, s.avgDecisionHours());
        assertNull(s.avgDecisionHoursLastMonth());
        assertEquals(2, s.onLeaveToday());
        assertEquals(LocalDate.of(2026, 9, 28), s.nextWorkingDay(), "Friday's next working day is Monday");
        assertEquals(1, s.onLeaveNextWorkingDay());
        assertEquals(7, s.months().size());
        assertEquals("2026-03", s.months().get(0).month());
        assertEquals("2026-09", s.months().get(6).month());
        assertEquals(0, s.months().get(0).approved());
        // Tenant-wide: no manager filter anywhere; every query is limited to the tenant.
        sqls.stream().filter(q -> q.contains("leave_requests")).forEach(q -> {
            assertFalse(q.contains("reporting_manager_id"), q);
            assertTrue(q.contains("lr.tenant_id = ?"), q);
        });
    }

    @Test void hrsWaitingCountLeavesOutTheirOwnRequestsLikeTheirQueue() {
        statsData();
        service.approvalStats(me, true, 7, LocalDate.of(2026, 9, 25));
        // Both waiting counts (PENDING and PENDING_L2): the workspace without the caller's own requests,
        // which they may not decide and /approvals/pending no longer lists for them.
        int waitingQueries = 0;
        for (int i = 0; i < sqls.size(); i++) {
            if (!sqls.get(i).contains("FILTER (WHERE lr.created_at")) continue;
            waitingQueries++;
            assertTrue(sqls.get(i).contains("lr.employee_id <> ?"), sqls.get(i));
            assertEquals(me, argsOf.get(i).get(2));
        }
        assertEquals(2, waitingQueries);
        // Without an employee id nothing is left out (as before).
        sqls.clear();
        argsOf.clear();
        service.approvalStats(null, true, 7, LocalDate.of(2026, 9, 25));
        assertFalse(sqlContaining("FILTER (WHERE lr.created_at").contains("lr.employee_id <> ?"));
    }

    @Test void aManagerSeesTheirPendingListsScopeAndNeverTheHrQueue() {
        statsData();
        LeaveInsightsService.ApprovalStats s = service.approvalStats(me, false, 7, LocalDate.of(2026, 9, 23));
        assertEquals(LeaveInsightsService.Scope.TEAM, s.scope());
        assertEquals(0, s.pendingL2());
        assertEquals(3, s.waiting());
        String waiting = sqlContaining("FILTER (WHERE lr.created_at");
        // The same broadened match as findPendingForManager, without the manager's own requests.
        assertTrue(waiting.contains("lr.employee_id <> ?"));
        assertTrue(waiting.contains("lr.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?"));
        assertEquals(List.of(tenant, "PENDING", me, me, me, me), argsOfSqlContaining("FILTER (WHERE lr.created_at"));
        assertFalse(argsOf.stream().anyMatch(a -> a.contains("PENDING_L2")), "managers never count HR's queue");
        assertTrue(sqlContaining("date_trunc('month'").contains("reporting_manager_id"));
        assertTrue(sqlContaining("COUNT(DISTINCT lr.employee_id)").contains("reporting_manager_id"));
    }

    @Test void aOneMonthSeriesStillComparesWithLastMonth() {
        statsData();
        LeaveInsightsService.ApprovalStats s = service.approvalStats(me, true, 1, LocalDate.of(2026, 9, 23));
        assertEquals(1, s.months().size());
        assertEquals(2, s.approvedLastMonth());
    }

    // ── calendar ────────────────────────────────────────────────────────────

    private void recordCalendar() {
        doAnswer(inv -> { record(inv); return List.of(); })
                .when(jdbc).query(contains("FROM leave_mgmt.leave_requests lr"), any(RowMapper.class), any(Object[].class));
    }

    @Test void theCalendarShowsTheWorkspaceTheTeamOrOnlyYourself() {
        recordCalendar();
        LocalDate from = LocalDate.of(2026, 10, 1), to = LocalDate.of(2026, 10, 31);
        service.calendar(me, LeaveInsightsService.Scope.TENANT, from, to, null);
        service.calendar(me, LeaveInsightsService.Scope.TEAM, from, to, null);
        service.calendar(me, LeaveInsightsService.Scope.SELF, from, to, null);
        assertFalse(sqls.get(0).contains("reporting_manager_id"));
        assertFalse(sqls.get(0).contains("lr.employee_id = ?"));
        assertTrue(sqls.get(1).contains("(lr.employee_id = ? OR (lr.approver_id = ? OR e.reporting_manager_id = ? OR d.department_head_employee_id = ?))"));
        assertTrue(sqls.get(2).contains("AND lr.employee_id = ?"));
        assertFalse(sqls.get(2).contains("reporting_manager_id"));
        // Approved only unless asked.
        assertTrue(argsOf.get(0).contains("APPROVED"));
        assertFalse(argsOf.get(0).contains("PENDING"));
        sqls.forEach(q -> assertTrue(q.contains("lr.tenant_id = ?")));
    }

    // ── company access: a company-scoped level-two approver (COMPANY_ACCESS.md) ──

    @Test void aCompanyScopedLevelTwoCalendarCoversTheirCompanyOnly() {
        recordCalendar();
        UUID only = UUID.randomUUID();
        LocalDate from = LocalDate.of(2026, 10, 1), to = LocalDate.of(2026, 10, 31);
        service.calendar(me, LeaveInsightsService.Scope.TENANT, from, to, null, only);
        assertTrue(sqls.get(0).contains("AND e.company_id = ?"), sqls.get(0));
        assertTrue(argsOf.get(0).contains(only));
        // The team and self views are not touched; no company = the workspace, as before.
        service.calendar(me, LeaveInsightsService.Scope.TEAM, from, to, null, only);
        service.calendar(me, LeaveInsightsService.Scope.TENANT, from, to, null, null);
        service.calendar(me, LeaveInsightsService.Scope.TENANT, from, to, null);
        for (int i = 1; i < sqls.size(); i++) assertFalse(sqls.get(i).contains("e.company_id"), sqls.get(i));
    }

    @Test void aCompanyScopedLevelTwosStatsCoverTheirCompanyOnly() {
        statsData();
        UUID only = UUID.randomUUID();
        service.approvalStats(me, true, 7, LocalDate.of(2026, 9, 25), only);
        List<String> requestQueries = sqls.stream().filter(q -> q.contains("leave_requests")).toList();
        assertEquals(4, requestQueries.size(), "two waiting counts, the months, who is away");
        requestQueries.forEach(q -> assertTrue(q.contains("AND e.company_id = ?"), q));
        for (int i = 0; i < sqls.size(); i++) {
            if (sqls.get(i).contains("leave_requests")) assertTrue(argsOf.get(i).contains(only));
        }
        // A manager's (team) figures are never narrowed by it.
        sqls.clear();
        argsOf.clear();
        service.approvalStats(me, false, 7, LocalDate.of(2026, 9, 25), only);
        sqls.stream().filter(q -> q.contains("leave_requests")).forEach(q -> assertFalse(q.contains("e.company_id"), q));
    }

    @Test void theControllerPicksTheScopeFromTheApprovalLevel() {
        assertEquals(LeaveInsightsService.Scope.TENANT, LeaveInsightsController.scopeOf(auth("hrms.leave.approve.l2", "hrms.leave.approve.l1")));
        assertEquals(LeaveInsightsService.Scope.TEAM, LeaveInsightsController.scopeOf(auth("hrms.leave.approve.l1", "leave.balance.read")));
        assertEquals(LeaveInsightsService.Scope.SELF, LeaveInsightsController.scopeOf(auth("leave.balance.read")));
    }

    private static Authentication auth(String... authorities) {
        return new TestingAuthenticationToken("u", "p", authorities);
    }

    @Test void pendingAndAwaitingHrRequestsOnlyWhenAskedAndNothingElse() {
        assertEquals(List.of("APPROVED"), LeaveInsightsService.calendarStatuses(null));
        assertEquals(List.of("APPROVED", "PENDING", "PENDING_L2"),
                LeaveInsightsService.calendarStatuses(List.of("approved,pending", "PENDING_L2")));
        for (String bad : List.of("REJECTED", "CANCELLED", "ALL")) {
            HrmsException e = assertThrows(HrmsException.class, () -> LeaveInsightsService.calendarStatuses(List.of(bad)));
            assertEquals("INVALID_LEAVE_STATUS", e.getErrorCode());
            assertEquals(400, e.getStatus().value());
        }
    }

    @Test void datesMustBeInOrderAndAtMostSixtyTwoDays() {
        LocalDate d = LocalDate.of(2026, 10, 1);
        assertDoesNotThrow(() -> LeaveInsightsService.checkRange(d, d.plusDays(61)));
        for (LocalDate[] bad : List.of(new LocalDate[]{d, d.minusDays(1)}, new LocalDate[]{d, d.plusDays(62)},
                new LocalDate[]{null, d})) {
            assertEquals("INVALID_DATE_RANGE", assertThrows(HrmsException.class,
                    () -> LeaveInsightsService.checkRange(bad[0], bad[1])).getErrorCode());
        }
        verifyNoInteractions(jdbc);
    }

    // ── colleagues off ──────────────────────────────────────────────────────

    @Test void colleaguesOffShowsOnlyFirstNamesOfApprovedLeaveInYourDepartment() {
        UUID dept = UUID.randomUUID(), asha = UUID.randomUUID(), ravi = UUID.randomUUID();
        when(jdbc.queryForList(contains("SELECT department_id, company_id"), any(Object[].class)))
                .thenReturn(List.<Map<String, Object>>of(Map.<String, Object>of("department_id", dept, "company_id", company)));
        LocalDate mon = LocalDate.of(2026, 10, 5);
        doAnswer(inv -> {
            record(inv);
            return List.of(new LeaveInsightsService.Away(asha, "Asha", mon, mon.plusDays(6)),
                    new LeaveInsightsService.Away(ravi, "Ravi", mon.plusDays(1), mon.plusDays(1)));
        }).when(jdbc).query(contains("lr.status = 'APPROVED'"), any(RowMapper.class), any(Object[].class));
        doAnswer(inv -> new Integer[]{6, 7}).when(jdbc).query(contains("weekend_days"), any(ResultSetExtractor.class), any(Object[].class));

        LeaveInsightsService.ColleaguesOff off = service.colleaguesOff(me, mon, mon.plusDays(6));
        assertTrue(off.inDepartment());
        assertEquals(5, off.days().size(), "the weekend is left out");
        assertEquals(List.of("Asha"), off.days().get(0).names());
        assertEquals(List.of("Asha", "Ravi"), off.days().get(1).names());

        String q = sqlContaining("lr.status = 'APPROVED'");
        assertFalse(q.contains("PENDING"), "never pending requests");
        assertFalse(q.contains("leave_type"), "never the leave type");
        assertFalse(q.contains("last_name"), "first names only");
        assertTrue(q.contains("e.department_id = ?") && q.contains("e.id <> ?"), "same department, never yourself");
        List<Object> args = argsOfSqlContaining("lr.status = 'APPROVED'");
        assertEquals(tenant, args.get(0));
        assertTrue(args.contains(dept) && args.contains(me));
        // The answer carries nothing but dates and first names.
        assertEquals(Set.of("date", "names"), Arrays.stream(LeaveInsightsService.DayOff.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName).collect(java.util.stream.Collectors.toSet()));
    }

    @Test void withoutADepartmentThereAreNoColleaguesToShow() {
        java.util.HashMap<String, Object> row = new java.util.HashMap<>();
        row.put("department_id", null);
        row.put("company_id", company);
        when(jdbc.queryForList(contains("SELECT department_id, company_id"), any(Object[].class))).thenReturn(List.<Map<String, Object>>of(row));
        LeaveInsightsService.ColleaguesOff off = service.colleaguesOff(me, LocalDate.of(2026, 10, 5), LocalDate.of(2026, 10, 9));
        assertFalse(off.inDepartment());
        assertTrue(off.days().isEmpty());
        verify(jdbc, never()).query(contains("leave_requests"), any(RowMapper.class), any(Object[].class));
    }

    @Test void daysAreWorkingDaysInTheRangeWithEachPersonOnce() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        LocalDate mon = LocalDate.of(2026, 10, 5);
        List<LeaveInsightsService.DayOff> days = LeaveInsightsService.byDay(List.of(
                        new LeaveInsightsService.Away(a, "Asha", mon.minusDays(10), mon.plusDays(2)),   // clipped to the range
                        new LeaveInsightsService.Away(b, "  ", mon, mon),                            // no first name: left out
                        new LeaveInsightsService.Away(a, "Asha", mon.plusDays(2), mon.plusDays(3))),   // once per day
                mon, mon.plusDays(4), Set.of(6, 7), Set.of(mon.plusDays(1)));                       // Tuesday is a holiday
        assertEquals(List.of(mon, mon.plusDays(2), mon.plusDays(3)), days.stream().map(LeaveInsightsService.DayOff::date).toList());
        days.forEach(d -> assertEquals(List.of("Asha"), d.names()));
    }

    // ── everyone's balances and usage ───────────────────────────────────────

    @Test void balancesAreEveryoneStillWorkingHereAPageAtATimeWithSafeSearch() {
        when(jdbc.queryForObject(contains("SELECT COUNT(*) FROM hrms.employees"), eq(Long.class), any(Object[].class))).thenAnswer(inv -> {
            record(inv);
            return 45L;
        });
        UUID person = UUID.randomUUID();
        doAnswer(inv -> {
            record(inv);
            return List.of(new LeaveInsightsService.PersonBalances(person, "Reader User", "EMP002", null, company, "PROBATION", new ArrayList<>()));
        }).when(jdbc).query(contains("ORDER BY LOWER"), any(RowMapper.class), any(Object[].class));
        doAnswer(inv -> {
            record(inv);
            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject("employee_id", UUID.class)).thenReturn(person);
            when(rs.getString("name")).thenReturn("Casual leave");
            when(rs.getBoolean("is_active")).thenReturn(true);
            when(rs.getDouble("total_entitlement")).thenReturn(12.0);
            when(rs.getDouble("carry_forward")).thenReturn(3.0);
            when(rs.getDouble("used")).thenReturn(2.0);
            when(rs.getDouble("pending")).thenReturn(1.5);
            ((RowCallbackHandler) inv.getArgument(1)).processRow(rs);
            return null;
        }).when(jdbc).query(contains("FROM leave_mgmt.leave_balances lb"), any(RowCallbackHandler.class), any(Object[].class));

        var page = service.balances(company, 2026, " 50%_off ", 2, 20);
        assertEquals(45, page.totalElements());
        assertEquals(3, page.totalPages());
        assertTrue(page.last());
        var b = page.content().get(0).balances().get(0);
        assertEquals(15.0, b.total());
        assertEquals(11.5, b.available(), "entitlement + carried in - used - pending, as the balance report computes it");

        String count = sqlContaining("SELECT COUNT(*) FROM hrms.employees");
        assertTrue(count.contains("employment_status NOT IN ('EXITED','TERMINATED','RESIGNED','RETIRED')"),
                "probation, notice and long leave are included, people who left are not");
        assertFalse(count.contains("= 'ACTIVE'"));
        assertEquals(List.of(tenant, company, "%50\\%\\_off%", "%50\\%\\_off%"), argsOfSqlContaining("SELECT COUNT(*) FROM hrms.employees"));
        List<Object> pageArgs = argsOfSqlContaining("ORDER BY LOWER");
        assertEquals(List.of(20, 40L), pageArgs.subList(pageArgs.size() - 2, pageArgs.size()));
        assertEquals(List.of(tenant, 2026, person), argsOfSqlContaining("FROM leave_mgmt.leave_balances lb"));
    }

    @Test void pagesAreClampedAndYearsChecked() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
        doAnswer(inv -> { record(inv); return List.of(); }).when(jdbc).query(contains("ORDER BY LOWER"), any(RowMapper.class), any(Object[].class));
        var page = service.balances(null, 2026, null, -3, 500);
        assertEquals(0, page.page());
        assertEquals(100, page.size());
        assertEquals(List.of(tenant, 100, 0L), argsOfSqlContaining("ORDER BY LOWER"));
        assertEquals("INVALID_YEAR", assertThrows(HrmsException.class, () -> service.balances(null, 1999, null, 0, 20)).getErrorCode());
        assertEquals("INVALID_YEAR", assertThrows(HrmsException.class, () -> service.usage(null, 2101)).getErrorCode());
    }

    // ── missing tables ──────────────────────────────────────────────────────

    private static BadSqlGrammarException missing(String state) {
        return new BadSqlGrammarException("read", "SELECT …", new SQLException("relation does not exist", state));
    }

    @Test void aMissingTableOrColumnAnswersNotSwitchedOnYetInsteadOfAnError() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenThrow(missing("42P01"));
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenThrow(missing("42703"));
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenThrow(missing("42P01"));
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenThrow(missing("42P01"));
        LocalDate d = LocalDate.of(2026, 10, 1);
        for (Runnable read : List.<Runnable>of(
                () -> service.balances(null, 2026, null, 0, 20),
                () -> service.usage(null, 2026),
                () -> service.calendar(me, LeaveInsightsService.Scope.TENANT, d, d.plusDays(5), null),
                () -> service.colleaguesOff(me, d, d.plusDays(5)),
                () -> service.approvalStats(me, true, 7, d))) {
            FeatureNotReady e = assertThrows(FeatureNotReady.class, read::run);
            assertEquals(503, e.getStatus().value());
            assertEquals("FEATURE_NOT_READY", e.getErrorCode());
        }
    }

    @Test void otherDatabaseErrorsAreNotHidden() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenThrow(new BadSqlGrammarException("read", "SELECT …", new SQLException("syntax error", "42601")));
        LocalDate d = LocalDate.of(2026, 10, 1);
        assertThrows(BadSqlGrammarException.class, () -> service.calendar(me, LeaveInsightsService.Scope.SELF, d, d, null));
    }
}
