package com.hrms.api.workforce;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BW-98 my record, BW-91 exit lists, and BW-90's suspension dates when the history table is missing. */
class EmployeeRecordQueriesTest {

    private final UUID tenant = UUID.randomUUID();
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    void aLoginWithoutAnEmployeeRecordIsNotFound() {
        EmployeeRecordQueries q = new EmployeeRecordQueries(jdbc);
        assertThatThrownBy(() -> q.myRecord(null)).isInstanceOf(ResourceNotFoundException.class);
        verify(jdbc, never()).query(anyString(), any(RowMapper.class), any(), any());
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any())).thenReturn(List.of());
        assertThatThrownBy(() -> q.myRecord(UUID.randomUUID())).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @SuppressWarnings("unchecked")
    void myRecordReadsOnlyTheCallersRowInTheTenantAndNoPayBankOrIdentityColumn() {
        UUID me = UUID.randomUUID();
        when(jdbc.query(anyString(), any(RowMapper.class), eq(tenant), eq(me))).thenReturn(List.of(
                new EmployeeRecordQueries.MyEmployeeRecord(me, "EMP-1", "Asha", "Rao", UUID.randomUUID(), "PROBATION",
                        null, "Engineer", "Tech", "Priya Nair", null, null, null, null)));
        assertThat(new EmployeeRecordQueries(jdbc).myRecord(me).managerName()).isEqualTo("Priya Nair");
        org.mockito.ArgumentCaptor<String> sql = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(sql.capture(), any(RowMapper.class), eq(tenant), eq(me));
        String select = sql.getValue().substring(0, sql.getValue().indexOf("FROM"));
        for (String column : List.of("monthly_salary", "salary_frequency", "ctc_annual", "pan_number", "aadhaar_number",
                "passport_number", "pf_uan", "esi_number", "bank_")) {
            assertThat(select).doesNotContain(column);
        }
        // the record's fields are exactly the web contract's
        assertThat(java.util.Arrays.stream(EmployeeRecordQueries.MyEmployeeRecord.class.getRecordComponents()).map(c -> c.getName()))
                .containsExactly("employeeId", "employeeCode", "firstName", "lastName", "companyId", "employmentStatus",
                        "dateOfJoining", "designationName", "departmentName", "managerName", "probationEndDate",
                        "confirmationDate", "noticeStartDate", "lastWorkingDay");
    }

    @Test
    void exitStatusFilter() {
        assertThat(EmployeeRecordQueries.exitStatuses(null)).containsExactly("NOTICE_PERIOD", "EXITED", "TERMINATED");
        assertThat(EmployeeRecordQueries.exitStatuses(" exited ")).containsExactly("EXITED");
        assertThatThrownBy(() -> EmployeeRecordQueries.exitStatuses("ACTIVE"))
                .isInstanceOf(BusinessRuleException.class).hasFieldOrPropertyWithValue("errorCode", "EXIT_STATUS_INVALID");
    }

    /**
     * BW-91 server-side search: the exit list filters in SQL over the full name, the employee code
     * and the department, replacing the web's client-side matchesSearch (useExits.ts). Matching is
     * a case-insensitive "contains", so % and _ in the search are taken literally.
     */
    @SuppressWarnings("unchecked")
    private Object[] exitsPageArgs(String search) {
        when(jdbc.queryForObject(startsWith("SELECT count(*)"), eq(Long.class), any(Object[].class))).thenReturn(0L);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        new EmployeeRecordQueries(jdbc).exits(null, "EXITED", search, 0, 50);
        org.mockito.ArgumentCaptor<Object[]> args = org.mockito.ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(anyString(), any(RowMapper.class), args.capture());
        return args.getValue();
    }

    /** The count query and the rows query must bind the same filters, in the same order. */
    private Object[] exitsCountArgs() {
        org.mockito.ArgumentCaptor<Object[]> args = org.mockito.ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForObject(startsWith("SELECT count(*)"), eq(Long.class), args.capture());
        return args.getValue();
    }

    @Test
    void aSearchIsBoundOnceForTheNameTheCodeAndTheDepartment() {
        Object[] bound = exitsPageArgs("  Asha  ");
        // tenant, companyId twice (the CAST(? AS uuid) pair), the search null-check, three LIKEs, the status, LIMIT, OFFSET
        assertThat(bound).containsExactly(tenant, null, null, "%asha%", "%asha%", "%asha%", "%asha%", "EXITED", 50, 0L);
        // the same filters, in the same order, without LIMIT/OFFSET
        assertThat(exitsCountArgs()).containsExactly(tenant, null, null, "%asha%", "%asha%", "%asha%", "%asha%", "EXITED");
    }

    @Test
    @SuppressWarnings("unchecked")
    void theSearchPredicateIsParameterisedAndCoversNameCodeAndDepartmentInBothQueries() {
        exitsPageArgs("o'brien; DROP TABLE hrms.employees --");
        org.mockito.ArgumentCaptor<String> rows = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(jdbc).query(rows.capture(), any(RowMapper.class), any(Object[].class));
        org.mockito.ArgumentCaptor<String> count = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(count.capture(), eq(Long.class), any(Object[].class));
        for (String sql : List.of(rows.getValue(), count.getValue())) {
            assertThat(sql).contains("CAST(? AS text) IS NULL");
            assertThat(sql).contains("lower(concat_ws(' ', e.first_name, e.last_name)) LIKE ?");
            assertThat(sql).contains("lower(coalesce(e.employee_code, '')) LIKE ?");
            assertThat(sql).contains("lower(coalesce(d.name, '')) LIKE ?");
            // d.name is in scope: the departments join is in the shared clause both queries use
            assertThat(sql).contains("LEFT JOIN hrms.departments");
            // nothing the caller typed reaches the statement
            assertThat(sql).doesNotContain("DROP TABLE hrms.employees");
            assertThat(sql).doesNotContain("o'brien");
            // the tenant, company and is_active filters are untouched
            assertThat(sql).contains("e.tenant_id = ? AND e.is_active = TRUE");
            assertThat(sql).contains("CAST(? AS uuid) IS NULL OR e.company_id = CAST(? AS uuid)");
        }
    }

    @Test
    void aBlankSearchBindsNullSoTheListIsUnfiltered() {
        for (String blank : java.util.Arrays.asList(null, "", "   ", "\t\n")) {
            jdbc = mock(JdbcTemplate.class);
            assertThat(exitsPageArgs(blank))
                    .as("search %s filters nothing", blank == null ? "null" : "'" + blank + "'")
                    .containsExactly(tenant, null, null, null, null, null, null, "EXITED", 50, 0L);
        }
    }

    @Test
    void theSearchPatternMatchesTheWebsContainsAndTakesWildcardsLiterally() {
        // what matchesSearch did: trim, lower-case, "contains" — over name, code and department
        assertThat(EmployeeRecordQueries.searchPattern("Asha")).isEqualTo("%asha%");
        assertThat(EmployeeRecordQueries.searchPattern("  EMP-1  ")).isEqualTo("%emp-1%");
        assertThat(EmployeeRecordQueries.searchPattern("Tech")).isEqualTo("%tech%");
        // a search that matches nothing is still a pattern; only blank means "no search"
        assertThat(EmployeeRecordQueries.searchPattern("zzzznobody")).isEqualTo("%zzzznobody%");
        assertThat(EmployeeRecordQueries.searchPattern(null)).isNull();
        assertThat(EmployeeRecordQueries.searchPattern("   ")).isNull();
        // % and _ are characters to search for, not wildcards (the web used String.includes)
        assertThat(EmployeeRecordQueries.searchPattern("100%")).isEqualTo("%100\\%%");
        assertThat(EmployeeRecordQueries.searchPattern("a_b")).isEqualTo("%a\\_b%");
        assertThat(EmployeeRecordQueries.searchPattern("back\\slash")).isEqualTo("%back\\\\slash%");
    }

    @Test
    void suspensionDatesAreSkippedWithoutTheHistoryTable() {
        EmployeeStatsService stats = new EmployeeStatsService(jdbc);
        when(jdbc.queryForObject(startsWith("SELECT to_regclass('hrms.employee_status_history')"), eq(String.class))).thenReturn(null);
        assertThat(stats.suspendedSince(tenant, List.of(UUID.randomUUID()))).isEmpty();
        verify(jdbc, never()).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
        assertThat(stats.suspendedSince(tenant, List.of())).isEmpty();
    }
}
