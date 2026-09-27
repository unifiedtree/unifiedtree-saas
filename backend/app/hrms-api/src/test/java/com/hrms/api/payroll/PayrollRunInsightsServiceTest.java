package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Checks before you lock (BW-51), statutory dues (BW-52) and bank readiness (BW-57) for one run. */
class PayrollRunInsightsServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID RUN = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();

    private JdbcTemplate jdbc;
    private PayrollRunService runs;
    private PayrollRunInsightsService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        runs = mock(PayrollRunService.class);
        service = new PayrollRunInsightsService(jdbc, runs);
        when(runs.findRun(RUN)).thenReturn(new PayrollRunService.RunRow(RUN, COMPANY, 9, 2026,
                LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), "PROCESSING"));
    }

    private static PayrollRunService.RunEmployeeDto employee(String name, String net, String change, boolean bank,
                                                             boolean fnf, String joined, String lop) {
        BigDecimal n = new BigDecimal(net);
        return new PayrollRunService.RunEmployeeDto(UUID.nameUUIDFromBytes(name.getBytes()), "E-" + name, name,
                new BigDecimal("30"), lop == null ? BigDecimal.ZERO : new BigDecimal(lop), n, BigDecimal.ZERO, n,
                "Engineering", "Head office", "Engineer", joined, null, null, change == null ? null : new BigDecimal(change),
                false, bank, fnf, PayrollInsights.reviewReasons(change == null ? null : new BigDecimal(change), bank, fnf));
    }

    @Test
    void checksComeFromTheRunsOwnRowsAndItsSkippedPeople() {
        when(runs.listRunEmployees(TENANT, RUN)).thenReturn(List.of(
                employee("Asha", "55000", "15.0", true, false, "2021-01-04", null),
                employee("Ravi", "20000", null, false, false, "2026-09-07", "1")));
        UUID skipped = UUID.randomUUID();
        when(runs.listSkippedEmployees(TENANT, RUN)).thenReturn(List.of(
                new PayrollRunService.EligibleEmployeeDto(skipped, "E-9", "No Structure", null)));

        List<PayrollRunInsightsService.RunCheckDto> checks = service.checks(TENANT, RUN);

        assertEquals(List.of("VARIANCE", "MISSING_BANK", "PRORATED_JOINERS", "SKIPPED", "LOP"),
                checks.stream().map(PayrollRunInsightsService.RunCheckDto::key).toList());
        assertEquals("1 employee changed more than 10% from Aug 2026", checks.get(0).text());
        assertEquals(List.of(skipped), checks.get(3).employeeIds());
        verify(jdbc).execute("SET LOCAL app.tenant_id = '" + TENANT + "'");
    }

    @Test
    void anUnknownRunIsRefusedLikeEveryOtherRunEndpoint() {
        UUID other = UUID.randomUUID();
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> service.checks(TENANT, other));
        assertEquals("RUN_NOT_FOUND", e.getErrorCode());
        assertThrows(BusinessRuleException.class, () -> service.statutory(TENANT, other));
        assertThrows(BusinessRuleException.class, () -> service.bankReadiness(TENANT, other));
        verify(runs, never()).listRunEmployees(any(), any());
    }

    @Test
    void statutoryDuesAddUpTheRunsOwnLines() {
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            String[][] lines = {{"PF_EMPLOYEE", "1800"}, {"PF_EMPLOYER", "1800"}, {"PT", "200"}};
            for (String[] l : lines) {
                ResultSet rs = mock(ResultSet.class);
                when(rs.getString("component_code")).thenReturn(l[0]);
                when(rs.getBigDecimal("total")).thenReturn(new BigDecimal(l[1]));
                h.processRow(rs);
            }
            return null;
        }).when(jdbc).query(contains("component_code IN"), any(RowCallbackHandler.class), any(Object[].class));

        List<PayrollRunInsightsService.RunStatutoryDto> dues = service.statutory(TENANT, RUN);

        assertEquals(2, dues.size());
        assertEquals(new PayrollRunInsightsService.RunStatutoryDto("PF", "Provident fund", new BigDecimal("1800"),
                new BigDecimal("1800"), new BigDecimal("3600"), "2026-10-15"), dues.get(0));
        assertEquals("PT", dues.get(1).scheme());
        assertNull(dues.get(1).dueDate());
        verify(jdbc).query(contains("WHERE tenant_id = ? AND run_id = ?"), any(RowCallbackHandler.class), eq(TENANT), eq(RUN));
    }

    @Test
    void bankReadinessCountsWhoTheFileCanPay() {
        List<PayrollRunInsightsService.BankReadinessLineDto> people = List.of(
                new PayrollRunInsightsService.BankReadinessLineDto(UUID.randomUUID(), "E1", "Asha", new BigDecimal("50000"),
                        "HDFC Bank", "1234", "READY", null),
                new PayrollRunInsightsService.BankReadinessLineDto(UUID.randomUUID(), "E2", "Ravi", new BigDecimal("20000"),
                        null, null, "SKIPPED_MISSING_DETAILS", "No primary bank account on file"),
                new PayrollRunInsightsService.BankReadinessLineDto(UUID.randomUUID(), "E3", "Meena", new BigDecimal("30000"),
                        "SBI", "9876", "SKIPPED_INVALID_IFSC", "Invalid IFSC: SBIN123"));
        PayrollRunInsightsService.BankReadinessDto r = PayrollRunInsightsService.summarise(RUN, "LOCKED", people);
        assertEquals(3, r.total());
        assertEquals(1, r.ready());
        assertEquals(2, r.notReady());
        assertEquals(new BigDecimal("50000"), r.readyAmount());
        assertEquals(new BigDecimal("50000"), r.notReadyAmount());
        assertEquals("LOCKED", r.runStatus());

        PayrollRunInsightsService.BankReadinessDto empty = PayrollRunInsightsService.summarise(RUN, "DRAFT", List.of());
        assertEquals(0, empty.total());
        assertEquals(BigDecimal.ZERO, empty.readyAmount());
    }
}
