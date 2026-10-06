package com.hrms.api.payroll;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

/** The payslip template preview's example figures (audit H-55): a plain, self-consistent month. */
class PayslipTemplatePreviewTest {

    @Test void theExampleAddsUp() {
        PayrollRunService.PayslipDto s = PayrollRunService.samplePayslip(YearMonth.of(2026, 9));
        BigDecimal gross = s.earnings().stream().map(PayrollRunService.PayslipLineDto::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal ded = s.deductions().stream().map(PayrollRunService.PayslipLineDto::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertEquals(0, gross.compareTo(s.gross()));
        assertEquals(0, ded.compareTo(s.totalDeductions()));
        assertEquals(0, gross.subtract(ded).compareTo(s.netPay()));
        assertEquals(30, s.totalDays());
        assertEquals("Sep 2026", s.period());
        assertTrue(s.employeeName().contains("example"), "nobody real");
        assertNull(s.runId());
    }
}
