package com.hrms.api.attendance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Company overtime rules as the client set them on 2 Oct 2026 (DECISIONS 22): the minimum overtime is a THRESHOLD,
 * one hour unless a company changed it. Under it nothing counts; once it is reached all the extra time counts. The
 * monthly cap stops approvals. Stored minutes, hours and pay never change.
 */
class OvertimeRulesTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private final TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final NamedParameterJdbcTemplate named = mock(NamedParameterJdbcTemplate.class);
    private final UUID person = UUID.randomUUID();
    private final UUID manager = UUID.randomUUID();

    @BeforeEach void setUp() {
        TenantContext.setTenantId(TENANT);
        Employee e = new Employee();
        e.setId(person);
        when(scope.resolve(any(), isNull())).thenReturn(List.of(e));
    }

    @AfterEach void tearDown() {
        TenantContext.clear();
    }

    private static Jwt token(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString()).claim("permissions", List.of("attendance.team.read")).build();
    }

    /** A rules reader over the mock JDBC, with the table there or not. */
    private OvertimeRules rules(boolean table) {
        when(jdbc.queryForObject(contains("pg_attribute"), eq(Integer.class))).thenReturn(table ? 6 : 0);
        return new OvertimeRules(jdbc);
    }

    private Map<String, Object> list(OvertimeRules rules) {
        when(named.queryForList(anyString(), anyMap())).thenReturn(List.of());
        when(named.queryForObject(anyString(), anyMap(), eq(Long.class))).thenReturn(0L);
        return new OvertimeController(scope, jdbc, named, mock(OvertimeReasons.class), rules)
                .list(token(manager), LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), 0);
    }

    // ── the threshold ────────────────────────────────────────────────────────

    @Test void underTheMinimumNothingCountsFromItAllOfItCounts() {
        assertEquals(60, OvertimeRules.DEFAULT_MINIMUM);
        assertEquals(0, OvertimeRules.countedMinutes(59, 60));
        assertEquals(60, OvertimeRules.countedMinutes(60, 60));
        assertEquals(80, OvertimeRules.countedMinutes(80, 60), "1 h 20 m extra counts as 1 h 20 m");
        assertEquals(20, OvertimeRules.countedMinutes(20, 0), "a zero minimum: every minute counts");
        assertEquals(0, OvertimeRules.countedMinutes(0, 0));
        assertEquals(60, OvertimeRules.Rules.none(COMPANY).minimumMinutes());
        assertTrue(OvertimeRules.Rules.none(COMPANY).minimumIsDefault());
        assertNull(OvertimeRules.Rules.none(COMPANY).monthlyCapMinutes());
    }

    // ── the list ─────────────────────────────────────────────────────────────

    @Test void withoutTheTableTheListUsesTheOneHourDefault() {
        for (int scenario = 0; scenario < 2; scenario++) {
            reset(named, jdbc);
            OvertimeRules r = scenario == 0 ? null : rules(false);
            list(r);
            ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            verify(named).queryForList(sql.capture(), anyMap());
            assertFalse(sql.getValue().contains("overtime_rules"), "the missing table is never named");
            assertTrue(sql.getValue().contains("r.overtime_minutes>=60 OR d.reviewed_minutes=r.overtime_minutes"), sql.getValue());
            assertTrue(sql.getValue().contains("r.overtime_minutes AS minutes"), "minutes stays the stored overtime");
            assertTrue(sql.getValue().contains("AS \"countedMinutes\"") && sql.getValue().contains("60 AS \"minimumMinutes\""));
            verify(named).queryForObject(contains("r.overtime_minutes>=60 OR d.reviewed_minutes=r.overtime_minutes"), anyMap(), eq(Long.class));
        }
    }

    @Test void withTheTableEachCompanysMinimumElseTheDefault() {
        list(rules(true));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(named).queryForList(sql.capture(), anyMap());
        assertTrue(sql.getValue().contains(OvertimeController.RULES_JOIN), "joins the person's company's rules");
        assertTrue(sql.getValue().contains("r.overtime_minutes>=COALESCE(orr.minimum_minutes,60)"), sql.getValue());
        verify(named).queryForObject(contains(OvertimeController.RULES_JOIN), anyMap(), eq(Long.class));
    }

    @Test void theListAsksForTheSameTeamAndPeriod() {
        list(rules(true));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> params = ArgumentCaptor.forClass(Map.class);
        verify(named).queryForList(anyString(), params.capture());
        assertEquals(Map.of("tenant", TENANT, "employees", List.of(person), "from", LocalDate.of(2026, 9, 1),
                "to", LocalDate.of(2026, 9, 30), "offset", 0), params.getValue());
    }

    // ── decisions ────────────────────────────────────────────────────────────

    /** One completed overtime record of {@code minutes} for the person, on 15 Sep, nothing decided yet. */
    private OvertimeController decider(OvertimeRules rules, int minutes) {
        when(jdbc.queryForList(contains("FOR UPDATE"), any(Object[].class))).thenReturn(List.of(Map.of(
                "employee_id", person, "overtime_minutes", minutes, "attendance_date", java.sql.Date.valueOf("2026-09-15"))));
        when(jdbc.queryForObject(contains("reviewed_minutes=?"), eq(Integer.class), any(), any(), any())).thenReturn(0);
        when(jdbc.queryForList(contains("SELECT company_id FROM hrms.employees"), eq(UUID.class), any(), any())).thenReturn(List.of(COMPANY));
        OvertimeController c = new OvertimeController(scope, jdbc, named, mock(OvertimeReasons.class), rules);
        ReflectionTestUtils.setField(c, "cap", new OvertimeCap(jdbc));
        return c;
    }

    private void ruleRow(Integer minimum, Integer cap) {
        when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), eq(TENANT), eq(COMPANY)))
                .thenReturn(List.of(new OvertimeRules.Rules(COMPANY, minimum == null ? 60 : minimum, minimum == null, cap, "Owner", null)));
    }

    private Object[] insertArgs() {
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).update(contains("INSERT INTO attendance.overtime_decisions"), args.capture());
        List<?> values = args.getAllValues();
        if (values.size() == 1 && values.get(0) instanceof Object[] all) return all;
        return new ArrayList<>(values).toArray();
    }

    @Test void withNoRuleUnderAnHourIsNotOvertime() {
        for (int scenario = 0; scenario < 2; scenario++) {
            reset(jdbc);
            OvertimeRules r = scenario == 0 ? null : rules(false);
            BusinessRuleException e = assertThrows(BusinessRuleException.class,
                    () -> decider(r, 45).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok")));
            assertEquals("OVERTIME_NOT_COUNTED", e.getErrorCode());
            assertTrue(e.getMessage().contains("1h minimum"), e.getMessage());
            verify(jdbc, never()).update(contains("INSERT INTO attendance.overtime_decisions"), any(Object[].class));
        }
    }

    @Test void oneHourTwentyCountsFullyAndTheStoredMinutesAreReviewed() {
        OvertimeRules r = rules(true);
        when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of());
        decider(r, 80).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"));
        Object[] args = insertArgs();
        assertEquals("APPROVED", args[2]);
        assertEquals(80, args[3], "reviewed_minutes = the stored overtime, all of it");
    }

    @Test void aCompanyMinimumOfThirtyLetsFortyFiveThrough() {
        OvertimeRules r = rules(true);
        ruleRow(30, null);
        decider(r, 45).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"));
        assertEquals(45, insertArgs()[3]);
    }

    @Test void approvalStopsAtTheMonthlyCap() {
        OvertimeRules r = rules(true);
        ruleRow(null, 120);
        when(jdbc.queryForObject(contains("SUM(d.reviewed_minutes)"), eq(Integer.class), any(), any(), any(), any(), any())).thenReturn(90);
        when(jdbc.queryForObject(contains("to_regclass('attendance.overtime_requests')"), eq(Boolean.class))).thenReturn(false);
        OvertimeController c = decider(r, 61);

        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> c.approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok")));

        assertEquals("OVERTIME_MONTHLY_CAP_REACHED", e.getErrorCode());
        assertTrue(e.getMessage().contains("2h") && e.getMessage().contains("1h 30m") && e.getMessage().contains("September"), e.getMessage());
        verify(jdbc).query(contains("pg_advisory_xact_lock"), any(org.springframework.jdbc.core.ResultSetExtractor.class), any(Object[].class));
        verify(jdbc, never()).update(contains("INSERT INTO attendance.overtime_decisions"), any(Object[].class));
    }

    @Test void approvedRequestsCountTowardsTheCap() {
        OvertimeRules r = rules(true);
        ruleRow(null, 180);
        when(jdbc.queryForObject(contains("SUM(d.reviewed_minutes)"), eq(Integer.class), any(), any(), any(), any(), any())).thenReturn(60);
        when(jdbc.queryForObject(contains("to_regclass('attendance.overtime_requests')"), eq(Boolean.class))).thenReturn(true);
        when(jdbc.queryForObject(contains("FROM attendance.overtime_requests"), eq(Integer.class), any(), any(), any(), any(), any())).thenReturn(60);
        OvertimeController c = decider(r, 61);

        assertEquals("OVERTIME_MONTHLY_CAP_REACHED", assertThrows(BusinessRuleException.class,
                () -> c.approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"))).getErrorCode());
    }

    @Test void underTheCapItIsApprovedAndARejectionIgnoresTheCap() {
        OvertimeRules r = rules(true);
        ruleRow(null, 120);
        when(jdbc.queryForObject(contains("SUM(d.reviewed_minutes)"), eq(Integer.class), any(), any(), any(), any(), any())).thenReturn(60);
        when(jdbc.queryForObject(contains("to_regclass('attendance.overtime_requests')"), eq(Boolean.class))).thenReturn(false);
        decider(r, 60).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"));
        assertEquals("APPROVED", insertArgs()[2]);

        reset(jdbc);
        OvertimeRules r2 = rules(true);
        ruleRow(null, 0);
        decider(r2, 60).reject(token(manager), UUID.randomUUID(), new OvertimeController.Decision("Not agreed"));
        assertEquals("REJECTED", insertArgs()[2]);
        verify(jdbc, never()).queryForObject(contains("SUM(d.reviewed_minutes)"), eq(Integer.class), any(Object[].class));
    }

    @Test void aRejectionNeedsANote() {
        OvertimeController c = decider(null, 90);
        for (String note : new String[]{null, "", "   "}) {
            assertEquals("OVERTIME_REASON_REQUIRED", assertThrows(BusinessRuleException.class,
                    () -> c.reject(token(manager), UUID.randomUUID(), new OvertimeController.Decision(note))).getErrorCode());
        }
    }

    // ── the settings endpoints ───────────────────────────────────────────────

    @Test void theRulesAreValidated() {
        OvertimeRules.validate(null, null);
        OvertimeRules.validate(0, 0);
        OvertimeRules.validate(OvertimeRules.MAX_MINIMUM, OvertimeRules.MAX_MONTHLY_CAP);
        for (int[] bad : new int[][]{{-1, 0}, {OvertimeRules.MAX_MINIMUM + 1, 0}, {0, -1}, {0, OvertimeRules.MAX_MONTHLY_CAP + 1}}) {
            assertEquals("OVERTIME_RULES_INVALID",
                    assertThrows(BusinessRuleException.class, () -> OvertimeRules.validate(bad[0], bad[1])).getErrorCode());
        }
    }

    @Test void readingOrSavingWithoutTheTableIsNotReady() {
        when(jdbc.queryForObject(contains("org.companies"), eq(Boolean.class), any(), any())).thenReturn(true);
        BadSqlGrammarException missing = new BadSqlGrammarException("rules", "SELECT ...",
                new SQLException("relation \"attendance.overtime_rules\" does not exist", "42P01"));
        when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), any(), any())).thenThrow(missing);
        when(jdbc.update(contains("INSERT INTO attendance.overtime_rules"), any(Object[].class))).thenThrow(missing);
        OvertimeRules r = new OvertimeRules(jdbc);

        assertEquals(FeatureNotReady.CODE, assertThrows(FeatureNotReady.class, () -> r.get(COMPANY)).getErrorCode());
        assertEquals(FeatureNotReady.CODE, assertThrows(FeatureNotReady.class,
                () -> r.save(COMPANY, 30, 600, null, "Owner")).getErrorCode());
    }

    @Test void anotherTenantsCompanyIsNotFound() {
        when(jdbc.queryForObject(contains("org.companies"), eq(Boolean.class), any(), any())).thenReturn(false);
        OvertimeRules r = new OvertimeRules(jdbc);
        assertThrows(com.hrms.core.exception.ResourceNotFoundException.class, () -> r.get(COMPANY));
        assertThrows(com.hrms.core.exception.ResourceNotFoundException.class, () -> r.save(COMPANY, 30, null, null, "x"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void neverSetGivesTheDefaultMinimumAndSavingUpserts() {
        when(jdbc.queryForObject(contains("org.companies"), eq(Boolean.class), any(), any())).thenReturn(true);
        when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), any(), any())).thenReturn(List.of());
        OvertimeRules r = new OvertimeRules(jdbc);

        OvertimeRules.Rules none = r.get(COMPANY);
        assertEquals(COMPANY, none.companyId());
        assertEquals(60, none.minimumMinutes());
        assertTrue(none.minimumIsDefault());
        assertNull(none.monthlyCapMinutes());
        assertNull(none.updatedByName());

        r.save(COMPANY, null, null, null, "Owner");
        verify(jdbc).update(contains("ON CONFLICT (tenant_id, company_id) DO UPDATE"), eq(TENANT), eq(COMPANY), isNull(), isNull(), isNull(), eq("Owner"));
    }

    @Test void theResponseCarriesTheMinimumAndTheDefault() {
        var out = OvertimeRulesController.OvertimeRulesResponse.of(new OvertimeRules.Rules(COMPANY, 90, false, 600, "Owner", null));
        assertEquals(90, out.minimumMinutes());
        assertFalse(out.minimumIsDefault());
        assertEquals(60, out.defaultMinimumMinutes());
        assertEquals(600, out.monthlyCapMinutes());
    }

    @Test void readWithTheTeamReadOrTheEditRightWriteOnlyWithTheEditRight() throws Exception {
        String read = OvertimeRulesController.class.getMethod("get", UUID.class).getAnnotation(PreAuthorize.class).value();
        String write = OvertimeRulesController.class.getMethod("save", UUID.class,
                OvertimeRulesController.SaveOvertimeRulesRequest.class, Jwt.class).getAnnotation(PreAuthorize.class).value();
        assertEquals("hasAnyAuthority('attendance.team.read', 'attendance.policy.manage')", read);
        assertEquals("hasAuthority('attendance.policy.manage')", write);
    }
}
