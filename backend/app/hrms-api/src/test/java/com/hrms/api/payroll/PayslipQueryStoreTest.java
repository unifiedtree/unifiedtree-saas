package com.hrms.api.payroll;

import com.hrms.core.exception.FeatureNotReady;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.SQLException;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * While V143.58 isn't applied, every read and write of payroll.payslip_queries
 * answers 503 FEATURE_NOT_READY instead of a 500; any other database error is
 * passed on unchanged. The existing tables it reads never go through the helper.
 */
class PayslipQueryStoreTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID EMP = UUID.randomUUID();
    private static final UUID RUN = UUID.randomUUID();

    private JdbcTemplate jdbc;
    private PayslipQueryStore store;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        store = new PayslipQueryStore(jdbc);
    }

    private static BadSqlGrammarException missing(String state) {
        return new BadSqlGrammarException("payslip queries", "SELECT …",
                new SQLException("relation \"payroll.payslip_queries\" does not exist", state));
    }

    private static void assertNotReady(Runnable call) {
        FeatureNotReady e = assertThrows(FeatureNotReady.class, call::run);
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        assertEquals("FEATURE_NOT_READY", e.getErrorCode());
    }

    @Test
    @SuppressWarnings("unchecked")
    void everyStatementOnTheMissingTableIsNotReady() {
        when(jdbc.queryForObject(contains("INSERT INTO payroll.payslip_queries"), eq(UUID.class), any(Object[].class)))
                .thenThrow(missing("42P01"));
        when(jdbc.query(contains("FROM payroll.payslip_queries"), any(RowMapper.class), any(Object[].class)))
                .thenThrow(missing("42P01"));
        when(jdbc.update(contains("UPDATE payroll.payslip_queries"), any(Object[].class))).thenThrow(missing("42703"));

        PayslipQueryStore.OwnPayslip slip = new PayslipQueryStore.OwnPayslip(RUN, UUID.randomUUID(), 9, 2026);
        assertNotReady(() -> store.insert(TENANT, slip, EMP, "Why?", null));
        assertNotReady(() -> store.find(TENANT, UUID.randomUUID()));
        assertNotReady(() -> store.listForEmployee(TENANT, EMP, null, 200));
        assertNotReady(() -> store.listForEmployee(TENANT, EMP, RUN, 200));
        assertNotReady(() -> store.list(TENANT, null, 200));
        assertNotReady(() -> store.list(TENANT, "OPEN", 200));
        assertNotReady(() -> store.answer(TENANT, UUID.randomUUID(), "Because.", null, null));
    }

    @Test
    void otherDatabaseErrorsAreNotHiddenAsNotReady() {
        when(jdbc.update(contains("UPDATE payroll.payslip_queries"), any(Object[].class)))
                .thenThrow(new DataIntegrityViolationException("check constraint"));
        assertThrows(DataIntegrityViolationException.class, () -> store.answer(TENANT, UUID.randomUUID(), "x", null, null));
    }

    @Test
    @SuppressWarnings("unchecked")
    void everyReadIsFilteredOnTheTenantAndTheEmployee() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        store.listForEmployee(TENANT, EMP, RUN, 50);
        verify(jdbc).query(contains("WHERE q.tenant_id = ? AND q.employee_id = ? AND q.run_id = ?"), any(RowMapper.class),
                eq(TENANT), eq(EMP), eq(RUN), eq(50));
        store.ownPayslip(TENANT, EMP, RUN);
        verify(jdbc).query(contains("r.status IN ('LOCKED','PAID')"), any(RowMapper.class), eq(TENANT), eq(RUN), eq(EMP));
    }

    @Test
    void anAnswerOnlyReplacesAnOpenQuestion() {
        when(jdbc.update(contains("AND status = 'OPEN'"), any(Object[].class))).thenReturn(1, 0);
        assertTrue(store.answer(TENANT, UUID.randomUUID(), "Because.", UUID.randomUUID(), EMP));
        assertFalse(store.answer(TENANT, UUID.randomUUID(), "Because.", UUID.randomUUID(), EMP));
    }
}
