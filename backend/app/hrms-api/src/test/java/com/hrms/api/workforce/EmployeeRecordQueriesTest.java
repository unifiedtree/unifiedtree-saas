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

    @Test
    void suspensionDatesAreSkippedWithoutTheHistoryTable() {
        EmployeeStatsService stats = new EmployeeStatsService(jdbc);
        when(jdbc.queryForObject(startsWith("SELECT to_regclass('hrms.employee_status_history')"), eq(String.class))).thenReturn(null);
        assertThat(stats.suspendedSince(tenant, List.of(UUID.randomUUID()))).isEmpty();
        verify(jdbc, never()).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));
        assertThat(stats.suspendedSince(tenant, List.of())).isEmpty();
    }
}
