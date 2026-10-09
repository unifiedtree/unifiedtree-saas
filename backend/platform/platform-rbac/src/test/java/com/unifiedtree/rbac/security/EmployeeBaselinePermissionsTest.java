package com.unifiedtree.rbac.security;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 2026-10-09 (tester triage web-onb-05): the baseline was read from "the role
 * coded EMPLOYEE" with no workspace filter and then cached for every workspace,
 * so a business's own role coded EMPLOYEE would have handed its grants to every
 * employee of every business. These pin: only the built-in role feeds it.
 */
class EmployeeBaselinePermissionsTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final EmployeeBaselinePermissions baseline = new EmployeeBaselinePermissions(jdbc, null);

    @Test
    void readsOnlyTheBuiltInEmployeeRole() {
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class)))
                .thenReturn(List.of("hrms.attendance.self", "hrms.payslip.self"));

        assertEquals(Set.of("hrms.attendance.self", "hrms.payslip.self"), baseline.baseline());

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForList(sql.capture(), eq(String.class), eq("EMPLOYEE"));
        assertTrue(sql.getValue().contains("r.code = ?"), sql.getValue());
        assertTrue(sql.getValue().contains("r.tenant_id IS NULL"),
                "a business's own role coded EMPLOYEE must not feed the baseline:\n" + sql.getValue());
    }

    @Test
    void baselineIsCachedAndOnlyAddedForEmployees() {
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class)))
                .thenReturn(List.of("hrms.payslip.self"));

        assertEquals(List.of("hrms.payslip.self", "hrms.report.read"),
                baseline.effectiveFor(List.of("hrms.report.read"), java.util.UUID.randomUUID()));
        assertEquals(List.of("hrms.report.read"), baseline.effectiveFor(List.of("hrms.report.read"), null));
        baseline.baseline();

        verify(jdbc, times(1)).queryForList(anyString(), eq(String.class), any(Object[].class));
    }

    @Test
    void anEmptyOrFailedLoadKeepsTheLastGoodBaseline() {
        when(jdbc.queryForList(anyString(), eq(String.class), any(Object[].class)))
                .thenReturn(List.of("hrms.payslip.self"))
                .thenReturn(List.of())
                .thenThrow(new RuntimeException("db down"));

        assertEquals(Set.of("hrms.payslip.self"), baseline.baseline());
        baseline.invalidate();
        assertEquals(Set.of("hrms.payslip.self"), baseline.baseline(), "empty result keeps the last good set");
        baseline.invalidate();
        assertEquals(Set.of("hrms.payslip.self"), baseline.baseline(), "a failed load keeps the last good set");
    }
}
