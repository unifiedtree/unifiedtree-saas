package com.hrms.api.payroll;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.advance.AdvanceRecoveryService;
import com.hrms.letters.service.PdfRenderer;
import com.hrms.payroll.service.DefaultComponentSeeder;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Additive reads on existing endpoints: My payslips' extras come from the
 * caller's own lines only and leave the old row as it was (BW-55), and the
 * dashboard's pending disbursals as an amount (BW-54).
 */
class PayrollReadAdditionsTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID READER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID RUN = UUID.randomUUID();

    private static PayrollRunService runService(JdbcTemplate jdbc) {
        return new PayrollRunService(jdbc, mock(PdfRenderer.class), new ObjectMapper(),
                mock(DefaultComponentSeeder.class), mock(AdvanceRecoveryService.class));
    }

    private static PayrollRunService.MyPayslipDto oldRow() {
        return new PayrollRunService.MyPayslipDto(RUN, "Jan 2027", 1, 2027, new BigDecimal("31.00"), BigDecimal.ZERO,
                new BigDecimal("30000.00"), new BigDecimal("2140.30"), new BigDecimal("27859.70"), "PAID",
                "2026-09-22T14:54:12Z", null, null, null, List.of());
    }

    @Test
    @SuppressWarnings("unchecked")
    void myPayslipsGainPayDatePaidDateDaysAndNotesFromMyOwnLinesOnly() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doReturn(List.of(oldRow())).when(jdbc).query(contains("GROUP BY r.id, r.period_month, r.period_year, r.status, r.locked_at"),
                any(RowMapper.class), any(Object[].class));
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(RUN);
        when(rs.getObject("pay_date")).thenReturn(LocalDate.of(2027, 1, 28));
        when(rs.getObject("total_calendar")).thenReturn(31);
        when(rs.getBigDecimal("pli")).thenReturn(BigDecimal.ZERO);
        when(rs.getBigDecimal("advance")).thenReturn(new BigDecimal("2140.30"));
        when(rs.getString("advance_name")).thenReturn("Advance Recovery");
        when(rs.getBigDecimal("encashment")).thenReturn(BigDecimal.ZERO);
        doAnswer(inv -> {
            ((RowCallbackHandler) inv.getArgument(1)).processRow(rs);
            return null;
        }).when(jdbc).query(contains("AS new_salary_from"), any(RowCallbackHandler.class), any(Object[].class));

        List<PayrollRunService.MyPayslipDto> rows = runService(jdbc).listMyPayslips(TENANT, READER);

        assertEquals(1, rows.size());
        PayrollRunService.MyPayslipDto r = rows.get(0);
        PayrollRunService.MyPayslipDto before = oldRow();
        assertEquals(List.of(before.runId(), before.period(), before.periodMonth(), before.periodYear(), before.paidDays(),
                        before.lopDays(), before.gross(), before.totalDeductions(), before.netPay(), before.status(), before.lockedAt()),
                List.of(r.runId(), r.period(), r.periodMonth(), r.periodYear(), r.paidDays(), r.lopDays(), r.gross(),
                        r.totalDeductions(), r.netPay(), r.status(), r.lockedAt()), "the old fields are exactly as before");
        assertEquals("2027-01-28", r.payDate());
        assertNull(r.paidAt());
        assertEquals(31, r.totalDays());
        assertEquals(List.of(new PayrollRunService.PayslipNoteDto("ADVANCE_RECOVERY", "Advance Recovery",
                new BigDecimal("2140.30"), null)), r.notes());
        // Own lines only: the employee filter three times, then the tenant.
        verify(jdbc).query(contains("AS new_salary_from"), any(RowCallbackHandler.class),
                eq(READER), eq(READER), eq(READER), eq(TENANT));
        verify(jdbc).query(contains("JOIN payroll.payslip_lines l ON l.run_id = r.id AND l.employee_id = ?"),
                any(RowMapper.class), eq(READER), eq(READER));
    }

    @Test
    @SuppressWarnings("unchecked")
    void noPayslipsMeansNoExtraQuery() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doReturn(List.of()).when(jdbc).query(anyString(), any(RowMapper.class), any(Object[].class));
        assertEquals(List.of(), runService(jdbc).listMyPayslips(TENANT, READER));
        verify(jdbc, never()).query(contains("AS new_salary_from"), any(RowCallbackHandler.class), any(Object[].class));
    }

    @Test
    void pendingDisbursalsAreAlsoAnAmount() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("SUM(r.total_net)"), eq(BigDecimal.class), any(Object[].class)))
                .thenReturn(new BigDecimal("45000.00"));
        PayrollDashboardService.KpisDto kpis = new PayrollDashboardService(jdbc).kpis(TENANT);
        assertEquals(new BigDecimal("45000.00"), kpis.pendingDisbursalAmount());
        verify(jdbc).queryForObject(contains("NOT EXISTS"), eq(BigDecimal.class), eq(TENANT), eq("PROCESSING"), eq("LOCKED"));

        JdbcTemplate none = mock(JdbcTemplate.class);
        assertEquals(BigDecimal.ZERO, new PayrollDashboardService(none).kpis(TENANT).pendingDisbursalAmount());
    }
}
