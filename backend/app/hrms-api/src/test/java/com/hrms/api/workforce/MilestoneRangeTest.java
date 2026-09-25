package com.hrms.api.workforce;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.service.MilestoneWindow;
import com.hrms.employee.workforce.service.MilestoneWindow.Range;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.sql.ResultSet;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The dashboard's "Upcoming milestones" date ranges, without a database: the
 * year end, 29 February, anniversaries (never the joining year), the
 * 12-month cap, and that a list without a range keeps its window.
 */
class MilestoneRangeTest {

    private final UUID tenant = UUID.randomUUID();

    @AfterEach void clear() {
        TenantContext.clear();
    }

    private static LocalDate d(String iso) { return LocalDate.parse(iso); }
    private static Range r(String from, String to) { return new Range(d(from), d(to)); }

    // -- the day a yearly date falls on inside a range --------------------------

    @Test void aBirthdayInsideTheRangeFallsOnThatYearsDate() {
        assertEquals(d("2026-11-15"), MilestoneWindow.occurrenceIn(d("1990-11-15"), r("2026-09-26", "2026-12-26")));
        assertNull(MilestoneWindow.occurrenceIn(d("1990-11-15"), r("2026-09-26", "2026-09-30")));
        // Both ends are included.
        assertEquals(d("2026-09-26"), MilestoneWindow.occurrenceIn(d("1990-09-26"), r("2026-09-26", "2026-09-30")));
        assertEquals(d("2026-09-30"), MilestoneWindow.occurrenceIn(d("1990-09-30"), r("2026-09-26", "2026-09-30")));
    }

    @Test void aRangeAcrossTheYearEndLooksAtBothYears() {
        Range yearEnd = r("2026-12-15", "2027-01-20");
        assertEquals(d("2027-01-05"), MilestoneWindow.occurrenceIn(d("1990-01-05"), yearEnd));
        assertEquals(d("2026-12-20"), MilestoneWindow.occurrenceIn(d("1990-12-20"), yearEnd));
        assertNull(MilestoneWindow.occurrenceIn(d("1990-11-01"), yearEnd));
        assertNull(MilestoneWindow.occurrenceIn(d("1990-01-25"), yearEnd));
    }

    @Test void twentyNinthFebruaryFallsOnTheTwentyEighthInOtherYears() {
        LocalDate leapDay = d("2000-02-29");
        assertEquals(d("2027-02-28"), MilestoneWindow.occurrenceIn(leapDay, r("2027-02-01", "2027-03-31")));
        assertEquals(d("2027-02-28"), MilestoneWindow.occurrenceIn(leapDay, r("2027-02-28", "2027-02-28")));
        // In a leap year it is the 29th again, so the 28th alone does not hold it.
        assertEquals(d("2028-02-29"), MilestoneWindow.occurrenceIn(leapDay, r("2028-02-01", "2028-03-31")));
        assertNull(MilestoneWindow.occurrenceIn(leapDay, r("2028-02-28", "2028-02-28")));
        // Across a year end into a non-leap February.
        assertEquals(d("2027-02-28"), MilestoneWindow.occurrenceIn(leapDay, r("2026-12-01", "2027-03-01")));
    }

    @Test void theJoiningYearItselfIsNotAnAnniversary() {
        assertNull(MilestoneWindow.occurrenceIn(d("2026-10-10"), r("2026-09-26", "2026-12-31")));
        assertEquals(d("2026-10-10"), MilestoneWindow.occurrenceIn(d("2025-10-10"), r("2026-09-26", "2026-12-31")));
        // Someone who joins in December has their first anniversary the next December, not in January.
        assertNull(MilestoneWindow.occurrenceIn(d("2026-12-20"), r("2026-12-15", "2027-01-20")));
    }

    // -- the range itself --------------------------------------------------------

    @Test void aRangeIsAtMostTwelveMonths() {
        assertDoesNotThrow(() -> r("2027-01-01", "2027-12-31"));
        assertDoesNotThrow(() -> r("2026-09-26", "2027-09-25"));
        assertThrows(BusinessRuleException.class, () -> r("2027-01-01", "2028-01-01"));
        assertThrows(BusinessRuleException.class, () -> r("2026-09-26", "2027-09-26"));
        // From the 29th of February, twelve months on is the 28th.
        assertDoesNotThrow(() -> r("2028-02-29", "2029-02-27"));
        assertThrows(BusinessRuleException.class, () -> r("2028-02-29", "2029-02-28"));
    }

    @Test void theEndIsNotBeforeTheStart() {
        assertDoesNotThrow(() -> r("2026-10-01", "2026-10-01"));
        assertThrows(BusinessRuleException.class, () -> r("2026-10-02", "2026-10-01"));
    }

    @Test void bothEndsOrNeither() {
        assertNull(Range.optional(null, null));
        assertThrows(BusinessRuleException.class, () -> Range.optional(d("2026-10-01"), null));
        assertThrows(BusinessRuleException.class, () -> Range.optional(null, d("2026-10-01")));
        assertEquals(r("2026-10-01", "2026-10-31"), Range.optional(d("2026-10-01"), d("2026-10-31")));
    }

    // -- GET /v1/hrms/milestones with a range --------------------------------------

    /** One employees row as the range query reads it. */
    private static ResultSet row(String id, String first, String last, String dept, String src) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getString("id")).thenReturn(id);
        when(rs.getString("first_name")).thenReturn(first);
        when(rs.getString("last_name")).thenReturn(last);
        when(rs.getString("employee_code")).thenReturn("EMP-" + id);
        when(rs.getString("dept")).thenReturn(dept);
        when(rs.getDate("src")).thenReturn(java.sql.Date.valueOf(src));
        return rs;
    }

    private void feed(JdbcTemplate jdbc, String column, ResultSet... rows) {
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            for (ResultSet rs : rows) h.processRow(rs);
            return null;
        }).when(jdbc).query(contains(column + " AS src"), any(RowCallbackHandler.class), eq(tenant));
    }

    private MilestonesController controller(JdbcTemplate jdbc, RetirementService retirements) {
        TenantContext.setTenantId(tenant);
        return new MilestonesController(jdbc, mock(MilestoneReminderService.class), retirements);
    }

    @Test void birthdaysInARangeAcrossTheYearEndAreSoonestFirst() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        feed(jdbc, "e.date_of_birth",
                row("a", "Asha", "Rao", "Sales", "1990-01-05"),
                row("b", "Bala", "Iyer", null, "1988-12-20"),
                row("c", "Chitra", "Das", "HR", "1991-11-01"),
                row("d", "Dev", "Nair", "Ops", "2000-02-29"));
        var res = controller(jdbc, mock(RetirementService.class))
                .upcoming(14, 31, 6, d("2026-12-15"), d("2027-02-28"), null, null, null, null);

        assertEquals(List.of("b", "a", "d"), res.birthdays().stream().map(MilestonesController.Milestone::employeeId).toList());
        assertEquals(d("2026-12-20"), res.birthdays().get(0).date());
        assertEquals(d("2027-01-05"), res.birthdays().get(1).date());
        assertEquals(d("2027-02-28"), res.birthdays().get(2).date(), "29 Feb shows on 28 Feb in a non-leap year");
        assertNull(res.birthdays().get(0).years());
        assertEquals("Bala Iyer", res.birthdays().get(0).name());
        assertEquals("BI", res.birthdays().get(0).initials());
    }

    @Test void anniversariesInARangeCountYearsAndSkipTheJoiningYear() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        feed(jdbc, "e.date_of_joining",
                row("new", "New", "Joiner", null, "2026-11-01"),
                row("one", "One", "Year", null, "2025-11-01"),
                row("five", "Five", "Years", null, "2021-10-10"));
        var res = controller(jdbc, mock(RetirementService.class))
                .upcoming(14, 31, 6, null, null, d("2026-09-26"), d("2026-12-26"), null, null);

        assertEquals(List.of("five", "one"), res.anniversaries().stream().map(MilestonesController.Milestone::employeeId).toList());
        assertEquals(5, res.anniversaries().get(0).years());
        assertEquals(1, res.anniversaries().get(1).years());
    }

    @Test void retirementsInARangeUseTheRetirementDueRules() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        RetirementService retirements = mock(RetirementService.class);
        UUID who = UUID.randomUUID();
        when(retirements.between(eq(tenant), any(LocalDate.class), eq(d("2026-10-01")), eq(d("2027-03-31")), isNull()))
                .thenReturn(List.of(new RetirementService.RetirementDue(who, "EMP-9", "Kiran Rao", "KR", "Ops", "Lead",
                        UUID.randomUUID(), "Acme", 58, d("2027-01-15"), 111)));
        var res = controller(jdbc, retirements).upcoming(14, 31, 6, null, null, null, null, d("2026-10-01"), d("2027-03-31"));

        assertEquals(1, res.retirements().size());
        assertEquals(who.toString(), res.retirements().get(0).employeeId());
        assertEquals(d("2027-01-15"), res.retirements().get(0).date());
        assertEquals(58, res.retirements().get(0).years(), "years carries the company's retirement age, as before");
        verify(retirements, never()).due(any(), any(), anyInt(), any());
    }

    @Test void withoutARangeEachListKeepsItsWindow() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        RetirementService retirements = mock(RetirementService.class);
        controller(jdbc, retirements).upcoming(14, 31, 6, null, null, null, null, null, null);

        verify(jdbc).query(contains("e.date_of_birth AS src"), any(RowCallbackHandler.class), eq(tenant), eq(14));
        verify(jdbc).query(contains("e.date_of_joining AS src"), any(RowCallbackHandler.class), eq(tenant), eq(31));
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        verify(retirements).due(eq(tenant), any(LocalDate.class), eq((int) java.time.temporal.ChronoUnit.DAYS.between(today, today.plusMonths(6))), isNull());
        verify(retirements, never()).between(any(), any(), any(), any(), any());
    }

    @Test void aBadRangeIsRefusedBeforeAnythingIsRead() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        MilestonesController c = controller(jdbc, mock(RetirementService.class));
        assertThrows(BusinessRuleException.class, () -> c.upcoming(14, 31, 6, d("2026-10-01"), d("2027-10-01"), null, null, null, null));
        assertThrows(BusinessRuleException.class, () -> c.upcoming(14, 31, 6, null, null, d("2026-10-01"), null, null, null));
        verifyNoInteractions(jdbc);
    }

    // -- retirement due and the directory's "View all" -----------------------------

    @SuppressWarnings("unchecked")
    @Test void retirementDueIsTodayThroughTodayPlusDaysAsBefore() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        LocalDate today = d("2026-09-26");
        new RetirementService(jdbc, mock(ApplicationEventPublisher.class)).due(tenant, today, 30, null);
        verify(jdbc).query(contains("FROM hrms.employees e"), any(RowMapper.class), eq(tenant), eq(today), eq(today.plusDays(30)));

        new RetirementService(jdbc, mock(ApplicationEventPublisher.class)).between(tenant, today, d("2026-12-01"), d("2027-01-31"), null);
        verify(jdbc).query(contains("FROM hrms.employees e"), any(RowMapper.class), eq(tenant), eq(d("2026-12-01")), eq(d("2027-01-31")));
    }

    @Test void viewAllPicksTheSamePeopleForARange() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID jan = UUID.randomUUID(), nov = UUID.randomUUID(), leap = UUID.randomUUID(), joinedThisYear = UUID.randomUUID();
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            String sql = inv.getArgument(0);
            if (sql.contains("date_of_birth")) {
                h.processRow(idRow(jan, "1990-01-05"));
                h.processRow(idRow(nov, "1990-11-01"));
                h.processRow(idRow(leap, "1996-02-29"));
            } else {
                h.processRow(idRow(joinedThisYear, "2026-12-20"));
            }
            return null;
        }).when(jdbc).query(anyString(), any(RowCallbackHandler.class));
        Range yearEnd = r("2026-12-15", "2027-02-28");

        assertEquals(List.of(jan, leap), MilestoneWindow.idsIn(jdbc, MilestoneWindow.Kind.BIRTHDAY, yearEnd));
        assertEquals(List.of(), MilestoneWindow.idsIn(jdbc, MilestoneWindow.Kind.ANNIVERSARY, yearEnd));

        MilestoneWindow.idsIn(jdbc, MilestoneWindow.Kind.RETIREMENT, yearEnd);
        verify(jdbc).queryForList(contains("settings.hr_configuration"), eq(UUID.class), eq(d("2026-12-15")), eq(d("2027-02-28")));
    }

    private static ResultSet idRow(UUID id, String date) throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(id);
        when(rs.getDate("d")).thenReturn(java.sql.Date.valueOf(date));
        return rs;
    }
}
