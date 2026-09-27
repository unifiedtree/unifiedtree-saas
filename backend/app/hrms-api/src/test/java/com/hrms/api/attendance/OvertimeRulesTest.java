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
 * BW-29 company overtime rules. The rules change only which minutes are counted
 * and approved: with no rule (no row, nulls, or no table) the Overtime list and
 * its decisions are exactly what they were before the rules existed.
 */
class OvertimeRulesTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    /** The Overtime list query as it was before BW-29 (OvertimeController at rd/int f4e50e4a), verbatim. */
    private static final String WHERE_BEFORE = " WHERE r.tenant_id=:tenant AND r.employee_id IN (:employees) AND r.attendance_date BETWEEN :from AND :to AND r.overtime_minutes>0 AND r.check_out_at IS NOT NULL";
    private static final String LIST_BEFORE = """
   SELECT r.id,r.employee_id AS "employeeId",concat_ws(' ',e.first_name,e.last_name) AS "employeeName",
    r.attendance_date AS date,r.overtime_minutes AS minutes,
    CASE WHEN d.reviewed_minutes=r.overtime_minutes THEN d.status ELSE 'PENDING' END AS status,
    d.note,d.decided_at AS "decidedAt",NULLIF(concat_ws(' ',reviewer.first_name,reviewer.last_name),'') AS "decidedBy",
   """+OvertimeController.DETAILS_SQL+"""
   FROM attendance.records r JOIN hrms.employees e ON e.id=r.employee_id AND e.tenant_id=r.tenant_id
   LEFT JOIN attendance.overtime_decisions d ON d.record_id=r.id AND d.tenant_id=r.tenant_id
   LEFT JOIN hrms.employees reviewer ON reviewer.id=d.decided_by AND reviewer.tenant_id=r.tenant_id
   """+OvertimeController.SHIFT_JOIN+WHERE_BEFORE+" ORDER BY r.attendance_date DESC,e.first_name,r.id LIMIT 20 OFFSET :offset";
    private static final String COUNT_BEFORE = "SELECT count(*) FROM attendance.records r" + WHERE_BEFORE;

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

    /** A rules reader over the mock JDBC: the table there or not, and "counts after" in use or not. */
    private OvertimeRules rules(boolean table, boolean countsAfterInUse) {
        when(jdbc.queryForObject(contains("pg_attribute"), eq(Integer.class))).thenReturn(table ? 6 : 0);
        when(jdbc.queryForObject(contains("counts_after_minutes > 0"), eq(Boolean.class), any())).thenReturn(countsAfterInUse);
        return new OvertimeRules(jdbc);
    }

    private Map<String, Object> list(OvertimeRules rules, List<Map<String, Object>> rows) {
        when(named.queryForList(anyString(), anyMap())).thenReturn(rows);
        when(named.queryForObject(anyString(), anyMap(), eq(Long.class))).thenReturn((long) rows.size());
        return new OvertimeController(scope, jdbc, named, mock(OvertimeReasons.class), rules)
                .list(token(manager), LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), 0);
    }

    // ── the list ─────────────────────────────────────────────────────────────

    @Test void withNoRuleTheListIsExactlyWhatItWas() {
        List<Map<String, Object>> rows = List.of(Map.of("id", UUID.randomUUID(), "minutes", 45, "status", "PENDING"));
        // No rules bean, the table missing, and the table there with no "counts after" row.
        for (int scenario = 0; scenario < 3; scenario++) {
            reset(named, jdbc);
            OvertimeRules r = scenario == 0 ? null : rules(scenario == 2, false);
            Map<String, Object> out = list(r, rows);

            ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
            @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> params = ArgumentCaptor.forClass(Map.class);
            verify(named).queryForList(sql.capture(), params.capture());
            assertEquals(LIST_BEFORE, sql.getValue(), "the same query");
            assertEquals(Map.of("tenant", TENANT, "employees", List.of(person), "from", LocalDate.of(2026, 9, 1),
                    "to", LocalDate.of(2026, 9, 30), "offset", 0), params.getValue(), "the same parameters");
            verify(named).queryForObject(eq(COUNT_BEFORE), anyMap(), eq(Long.class));
            assertEquals(Map.of("content", rows, "totalElements", 1L), out, "the same response, no new fields");
        }
    }

    @Test void theRulesTableIsNeverQueriedWhenItIsMissing() {
        list(rules(false, true), List.of());
        verify(jdbc, never()).queryForObject(contains("attendance.overtime_rules WHERE"), eq(Boolean.class), any());
    }

    @Test void withCountsAfterOnlyTheMinutesPastItAreListedAndCounted() {
        Map<String, Object> out = list(rules(true, true), List.of());

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(named).queryForList(sql.capture(), anyMap());
        assertTrue(sql.getValue().contains(OvertimeController.RULES_JOIN), "joins the person's company's rules");
        assertTrue(sql.getValue().contains(OvertimeController.COUNTED_WHERE), "drops days with nothing past the rule");
        assertTrue(sql.getValue().contains("AS \"countedMinutes\""), "adds the counted part");
        assertTrue(sql.getValue().contains("r.overtime_minutes AS minutes"), "minutes stays the stored overtime");
        verify(named).queryForObject(contains(OvertimeController.COUNTED_WHERE), anyMap(), eq(Long.class));
        assertEquals(2, out.size());
    }

    @Test void countedMinutesFollowTheRule() {
        assertEquals(45, OvertimeRules.countedMinutes(45, null));
        assertEquals(45, OvertimeRules.countedMinutes(45, 0));
        assertEquals(15, OvertimeRules.countedMinutes(45, 30));
        assertEquals(0, OvertimeRules.countedMinutes(30, 30));
        assertEquals(0, OvertimeRules.countedMinutes(20, 30));
    }

    // ── decisions ────────────────────────────────────────────────────────────

    /** One completed overtime record of {@code minutes} for the person, on 15 Sep, nothing decided yet. */
    private OvertimeController decider(OvertimeRules rules, int minutes, UUID company) {
        when(jdbc.queryForList(contains("FOR UPDATE"), any(Object[].class))).thenReturn(List.of(Map.of(
                "employee_id", person, "overtime_minutes", minutes, "attendance_date", java.sql.Date.valueOf("2026-09-15"))));
        when(jdbc.queryForObject(contains("reviewed_minutes=?"), eq(Integer.class), any(), any(), any())).thenReturn(0);
        when(jdbc.queryForList(contains("SELECT company_id FROM hrms.employees"), eq(UUID.class), any(), any()))
                .thenReturn(company == null ? List.of() : List.of(company));
        return new OvertimeController(scope, jdbc, named, mock(OvertimeReasons.class), rules);
    }

    private void ruleRow(Integer countsAfter, Integer cap) {
        when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), eq(TENANT), eq(COMPANY)))
                .thenReturn(List.of(new OvertimeRules.Rules(COMPANY, countsAfter, cap, "Owner", null)));
    }

    private Object[] insertArgs() {
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).update(contains("INSERT INTO attendance.overtime_decisions"), args.capture());
        // Mockito hands varargs back either as one array or element by element.
        List<?> values = args.getAllValues();
        if (values.size() == 1 && values.get(0) instanceof Object[] all) return all;
        List<Object> flat = new ArrayList<>(values);
        return flat.toArray();
    }

    @Test void withNoRuleADecisionReviewsTheStoredMinutesAsBefore() {
        for (int scenario = 0; scenario < 3; scenario++) {
            reset(jdbc);
            // No rules bean, the table missing, and a company with no row.
            OvertimeRules r = scenario == 0 ? null : rules(scenario == 2, false);
            if (scenario == 2) {
                when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), eq(TENANT), eq(COMPANY))).thenReturn(List.of());
            }
            decider(r, 77, COMPANY).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"));
            Object[] args = insertArgs();
            assertEquals("APPROVED", args[2]);
            assertEquals(77, args[3], "reviewed_minutes = the stored overtime");
        }
    }

    @Test void extraTimeWithinCountsAfterIsNotOvertime() {
        OvertimeRules r = rules(true, true);
        ruleRow(30, null);
        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> decider(r, 25, COMPANY).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok")));
        assertEquals("OVERTIME_NOT_COUNTED", e.getErrorCode());
        verify(jdbc, never()).update(contains("INSERT INTO attendance.overtime_decisions"), any(Object[].class));
    }

    @Test void pastCountsAfterTheStoredMinutesAreStillWhatIsReviewed() {
        OvertimeRules r = rules(true, true);
        ruleRow(30, null);
        decider(r, 77, COMPANY).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"));
        assertEquals(77, insertArgs()[3], "the stored minutes never change");
    }

    @Test void approvalStopsAtTheMonthlyCap() {
        OvertimeRules r = rules(true, false);
        ruleRow(null, 120);
        when(jdbc.queryForObject(contains("SUM(GREATEST"), eq(Integer.class), any(), any(), any(), any(), any(), any())).thenReturn(90);
        OvertimeController c = decider(r, 45, COMPANY);

        BusinessRuleException e = assertThrows(BusinessRuleException.class,
                () -> c.approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok")));

        assertEquals("OVERTIME_MONTHLY_CAP_REACHED", e.getErrorCode());
        assertTrue(e.getMessage().contains("2h") && e.getMessage().contains("1h 30m") && e.getMessage().contains("September"), e.getMessage());
        verify(jdbc).query(contains("pg_advisory_xact_lock"), any(org.springframework.jdbc.core.ResultSetExtractor.class), any(Object[].class));
        verify(jdbc, never()).update(contains("INSERT INTO attendance.overtime_decisions"), any(Object[].class));
    }

    @Test void underTheCapItIsApprovedAndARejectionIgnoresTheCap() {
        OvertimeRules r = rules(true, false);
        ruleRow(null, 120);
        when(jdbc.queryForObject(contains("SUM(GREATEST"), eq(Integer.class), any(), any(), any(), any(), any(), any())).thenReturn(60);
        decider(r, 60, COMPANY).approve(token(manager), UUID.randomUUID(), new OvertimeController.Decision("ok"));
        assertEquals("APPROVED", insertArgs()[2]);

        reset(jdbc);
        OvertimeRules r2 = rules(true, false);
        ruleRow(null, 0);
        decider(r2, 60, COMPANY).reject(token(manager), UUID.randomUUID(), new OvertimeController.Decision("Not agreed"));
        assertEquals("REJECTED", insertArgs()[2]);
        verify(jdbc, never()).queryForObject(contains("SUM(GREATEST"), eq(Integer.class), any(Object[].class));
    }

    @Test void aRejectionNeedsANote() {
        OvertimeController c = decider(null, 60, COMPANY);
        for (String note : new String[]{null, "", "   "}) {
            assertEquals("OVERTIME_REASON_REQUIRED", assertThrows(BusinessRuleException.class,
                    () -> c.reject(token(manager), UUID.randomUUID(), new OvertimeController.Decision(note))).getErrorCode());
        }
    }

    // ── the settings endpoints ───────────────────────────────────────────────

    @Test void theRulesAreValidated() {
        OvertimeRules.validate(null, null);
        OvertimeRules.validate(0, 0);
        OvertimeRules.validate(OvertimeRules.MAX_COUNTS_AFTER, OvertimeRules.MAX_MONTHLY_CAP);
        for (int[] bad : new int[][]{{-1, 0}, {OvertimeRules.MAX_COUNTS_AFTER + 1, 0}, {0, -1}, {0, OvertimeRules.MAX_MONTHLY_CAP + 1}}) {
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

    @Test void neverSetGivesNullsAndSavingUpserts() {
        when(jdbc.queryForObject(contains("org.companies"), eq(Boolean.class), any(), any())).thenReturn(true);
        when(jdbc.query(contains("FROM attendance.overtime_rules"), any(RowMapper.class), any(), any())).thenReturn(List.of());
        OvertimeRules r = new OvertimeRules(jdbc);

        OvertimeRules.Rules none = r.get(COMPANY);
        assertEquals(COMPANY, none.companyId());
        assertNull(none.countsAfterMinutes());
        assertNull(none.monthlyCapMinutes());
        assertNull(none.updatedByName());

        r.save(COMPANY, null, null, null, "Owner");
        verify(jdbc).update(contains("ON CONFLICT (tenant_id, company_id) DO UPDATE"), eq(TENANT), eq(COMPANY), isNull(), isNull(), isNull(), eq("Owner"));
    }

    @Test void readWithTheTeamReadOrTheEditRightWriteOnlyWithTheEditRight() throws Exception {
        String read = OvertimeRulesController.class.getMethod("get", UUID.class).getAnnotation(PreAuthorize.class).value();
        String write = OvertimeRulesController.class.getMethod("save", UUID.class,
                OvertimeRulesController.SaveOvertimeRulesRequest.class, Jwt.class).getAnnotation(PreAuthorize.class).value();
        assertEquals("hasAnyAuthority('attendance.team.read', 'attendance.policy.manage')", read);
        assertEquals("hasAuthority('attendance.policy.manage')", write);
    }
}
