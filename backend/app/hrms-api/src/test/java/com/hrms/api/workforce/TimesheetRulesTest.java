package com.hrms.api.workforce;

import com.hrms.api.attendance.ApproverPath;
import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The timesheet week (V143.53 redesign, BW-36): only a submitted or approved
 * week locks its entries (and nothing is locked without the table); a week is
 * decided only by someone whose team scope holds the person, never by that
 * person, and only while it waits; without the table every new part answers
 * FEATURE_NOT_READY; the description stays required without a project.
 */
class TimesheetRulesTest {

    private static final UUID TENANT = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
    private final TimesheetService service = new TimesheetService(jdbc, scope, mock(ApproverPath.class));

    @BeforeEach void tenant() { TenantContext.setTenantId(TENANT); }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Jwt token(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).claim("permissions", List.of("hrms.timesheet.approve")).build();
    }

    private static Employee person(UUID id) {
        Employee e = new Employee();
        e.setId(id);
        return e;
    }

    private void weeksTable(boolean exists) {
        when(jdbc.queryForObject(contains("to_regclass('hrms.timesheet_weeks')"), eq(Boolean.class))).thenReturn(exists);
    }

    // ── submitting ───────────────────────────────────────────────────────────

    @Test void aWeekStartsOnAMondayAndMustHaveStarted() {
        LocalDate today = LocalDate.of(2026, 9, 30); // a Wednesday
        assertEquals("TIMESHEET_WEEK_START_INVALID", TimesheetService.submitRefusal(LocalDate.of(2026, 9, 29), today).getErrorCode());
        assertEquals("TIMESHEET_WEEK_FUTURE", TimesheetService.submitRefusal(LocalDate.of(2026, 10, 5), today).getErrorCode());
        assertNull(TimesheetService.submitRefusal(LocalDate.of(2026, 9, 28), today), "this week");
        assertNull(TimesheetService.submitRefusal(LocalDate.of(2026, 9, 21), today), "last week");
    }

    @Test void onlyARejectedWeekMayBeSubmittedAgain() {
        HrmsException waiting = TimesheetService.resubmitRefusal("SUBMITTED");
        assertEquals("TIMESHEET_WEEK_ALREADY_SUBMITTED", waiting.getErrorCode());
        assertEquals(409, waiting.getStatus().value());
        assertEquals("TIMESHEET_WEEK_ALREADY_APPROVED", TimesheetService.resubmitRefusal("APPROVED").getErrorCode());
        assertNull(TimesheetService.resubmitRefusal("REJECTED"));
    }

    // ── locking ──────────────────────────────────────────────────────────────

    @Test void nothingIsLockedWithoutTheTable() {
        weeksTable(false);
        service.assertWeeksOpen(UUID.randomUUID(), List.of(LocalDate.of(2026, 9, 23)));
        verify(jdbc, never()).queryForList(contains("FROM hrms.timesheet_weeks"), eq(String.class), any(Object[].class));
    }

    @Test void entriesInASubmittedOrApprovedWeekAreLocked() {
        weeksTable(true);
        UUID me = UUID.randomUUID();
        when(jdbc.queryForList(contains("FROM hrms.timesheet_weeks"), eq(String.class), any(Object[].class))).thenReturn(List.of("SUBMITTED"));
        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> service.assertWeeksOpen(me, List.of(LocalDate.of(2026, 9, 23))));
        assertEquals("TIMESHEET_WEEK_LOCKED", e.getErrorCode());
        when(jdbc.queryForList(contains("FROM hrms.timesheet_weeks"), eq(String.class), any(Object[].class))).thenReturn(List.of("APPROVED"));
        assertTrue(assertThrows(BusinessRuleException.class, () -> service.assertWeeksOpen(me, List.of(LocalDate.of(2026, 9, 23))))
                .getMessage().contains("approved"));
    }

    @Test void aWeekNobodySubmittedOrARejectedOneStaysOpen() {
        weeksTable(true);
        when(jdbc.queryForList(contains("FROM hrms.timesheet_weeks"), eq(String.class), any(Object[].class))).thenReturn(List.of());
        assertDoesNotThrow(() -> service.assertWeeksOpen(UUID.randomUUID(), List.of(LocalDate.of(2026, 9, 23))));
    }

    @Test void theLockLooksAtTheMondayOfEachDay() {
        weeksTable(true);
        UUID me = UUID.randomUUID();
        when(jdbc.queryForList(contains("FROM hrms.timesheet_weeks"), eq(String.class), any(Object[].class))).thenReturn(List.of());
        service.assertWeeksOpen(me, List.of(LocalDate.of(2026, 9, 27), LocalDate.of(2026, 9, 21)));
        verify(jdbc).queryForList(contains("week_start IN (?)"), eq(String.class), eq(TENANT), eq(me), eq(LocalDate.of(2026, 9, 21)));
    }

    // ── deciding ─────────────────────────────────────────────────────────────

    private void week(UUID weekId, UUID employeeId, String status) {
        when(jdbc.queryForList(contains("FOR UPDATE"), eq(weekId), eq(TENANT)))
                .thenReturn(List.of(Map.of("employee_id", employeeId, "status", status)));
    }

    @Test void nobodyDecidesTheirOwnWeek() {
        UUID me = UUID.randomUUID(), weekId = UUID.randomUUID();
        week(weekId, me, "SUBMITTED");
        assertEquals("SELF_APPROVAL_NOT_ALLOWED",
                assertThrows(BusinessRuleException.class, () -> service.decide(token(me), weekId, "APPROVED", null, "Me")).getErrorCode());
        verify(jdbc, never()).update(contains("UPDATE hrms.timesheet_weeks"), any(Object[].class));
    }

    @Test void aManagerDecidesOnlyTheirTeamsWeeks() {
        UUID mgr = UUID.randomUUID(), outsider = UUID.randomUUID(), weekId = UUID.randomUUID();
        week(weekId, outsider, "SUBMITTED");
        when(scope.resolve(any(), isNull())).thenReturn(List.of(person(UUID.randomUUID())));
        assertThrows(AccessDeniedException.class, () -> service.decide(token(mgr), weekId, "APPROVED", null, "Mgr"));
        verify(jdbc, never()).update(contains("UPDATE hrms.timesheet_weeks"), any(Object[].class));
    }

    @Test void onlyAWaitingWeekIsDecided() {
        UUID mgr = UUID.randomUUID(), report = UUID.randomUUID(), weekId = UUID.randomUUID();
        week(weekId, report, "APPROVED");
        when(scope.resolve(any(), isNull())).thenReturn(List.of(person(report)));
        HrmsException e = assertThrows(HrmsException.class, () -> service.decide(token(mgr), weekId, "REJECTED", "no", "Mgr"));
        assertEquals("TIMESHEET_WEEK_NOT_SUBMITTED", e.getErrorCode());
        assertEquals(409, e.getStatus().value());
    }

    @Test @SuppressWarnings("unchecked")
    void aWaitingWeekInTheTeamIsDecidedWithTheNote() {
        UUID mgr = UUID.randomUUID(), report = UUID.randomUUID(), weekId = UUID.randomUUID();
        week(weekId, report, "SUBMITTED");
        when(scope.resolve(any(), isNull())).thenReturn(List.of(person(report)));
        TimesheetService.Week decided = new TimesheetService.Week(weekId, report, "Reader User", LocalDate.of(2026, 9, 21), "REJECTED",
                2400, Instant.now(), Instant.now(), "Mgr", "Project missing on Tuesday", "E-2", "Engineering");
        when(jdbc.query(contains("WHERE w.id = ?"), any(RowMapper.class), eq(weekId), eq(TENANT))).thenReturn(List.of(decided));
        assertSame(decided, service.decide(token(mgr), weekId, "rejected", "  Project missing on Tuesday ", "Mgr"));
        verify(jdbc).update(contains("UPDATE hrms.timesheet_weeks"), eq("REJECTED"), any(), eq(mgr), eq("Mgr"),
                eq("Project missing on Tuesday"), eq(weekId), eq(TENANT));
    }

    @Test void aDecisionIsApproveOrReject() {
        assertEquals("TIMESHEET_DECISION_INVALID", assertThrows(BusinessRuleException.class,
                () -> service.decide(token(UUID.randomUUID()), UUID.randomUUID(), "MAYBE", null, "x")).getErrorCode());
    }

    @Test void anApproverWithoutATeamSeesNoWeeks() {
        when(scope.resolve(any(), isNull())).thenReturn(List.of());
        assertTrue(service.approvals(token(UUID.randomUUID()), null, 0, 20).content().isEmpty());
        verify(jdbc, never()).query(contains("FROM hrms.timesheet_weeks"), any(RowMapper.class), any(Object[].class));
    }

    @Test void withoutTheTableTheNewPartsAnswerFeatureNotReady() {
        UUID mgr = UUID.randomUUID(), weekId = UUID.randomUUID();
        when(jdbc.queryForList(contains("FOR UPDATE"), eq(weekId), eq(TENANT)))
                .thenThrow(new BadSqlGrammarException("decide", "SELECT", new SQLException("relation \"hrms.timesheet_weeks\" does not exist", "42P01")));
        FeatureNotReady e = assertThrows(FeatureNotReady.class, () -> service.decide(token(mgr), weekId, "APPROVED", null, "Mgr"));
        assertEquals(503, e.getStatus().value());
        when(scope.resolve(any(), isNull())).thenReturn(List.of(person(UUID.randomUUID())));
        when(jdbc.queryForObject(contains("count(*) FROM hrms.timesheet_weeks"), eq(Long.class), any(Object[].class)))
                .thenThrow(new BadSqlGrammarException("list", "SELECT", new SQLException("relation does not exist", "42P01")));
        assertThrows(FeatureNotReady.class, () -> service.approvals(token(mgr), null, 0, 20));
    }

    // ── entries ──────────────────────────────────────────────────────────────

    @Test void theDescriptionIsStillRequiredWithoutAProject() {
        HrmsException e = assertThrows(HrmsException.class, () -> TimeEntryController.requireDescriptionOrProject(
                new TimeEntryController.Input(LocalDate.of(2026, 9, 21), " ", 60, null)));
        assertEquals(400, e.getStatus().value());
        assertEquals("VALIDATION_FAILED", e.getErrorCode());
        assertEquals("description: must not be blank", e.getMessage());
        assertDoesNotThrow(() -> TimeEntryController.requireDescriptionOrProject(
                new TimeEntryController.Input(LocalDate.of(2026, 9, 21), null, 60, UUID.randomUUID())));
        assertDoesNotThrow(() -> TimeEntryController.requireDescriptionOrProject(
                new TimeEntryController.Input(LocalDate.of(2026, 9, 21), "Code review", 60, null)));
    }

    @Test void hoursReadNaturally() {
        assertEquals("38.5h", TimesheetService.hours(2310));
        assertEquals("40h", TimesheetService.hours(2400));
        assertEquals(LocalDate.of(2026, 9, 21), TimesheetService.monday(LocalDate.of(2026, 9, 27)));
    }
}
