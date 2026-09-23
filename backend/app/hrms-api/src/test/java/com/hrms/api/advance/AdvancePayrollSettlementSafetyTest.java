package com.hrms.api.advance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.payroll.PayrollRunService;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Opt-in integration test: only run against a migrated, disposable recovery database. */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class AdvancePayrollSettlementSafetyTest {
    private final DriverManagerDataSource source = new DriverManagerDataSource(
            System.getenv("RECOVERY_TEST_JDBC_URL"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
            System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
    private final JdbcTemplate jdbc = new JdbcTemplate(source);
    private final TransactionTemplate tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    private final AdvanceRecoveryService recovery = new AdvanceRecoveryService(jdbc);
    private final PayrollRunService payroll = new PayrollRunService(jdbc, null, new ObjectMapper(), null, recovery);

    @Test void reprocessingCannotRestoreSettledDebtOrEraseItsOriginalPayroll() {
        for (String action : List.of("FORECLOSE", "WRITE_OFF", "LEGACY_WRITE_OFF")) {
            Fixture fixture = seed();
            try {
                tx.executeWithoutResult(s -> {
                    if (action.equals("FORECLOSE")) recovery.foreclose(fixture.tenant(), fixture.advance(),
                            new AdvanceRecoveryService.ForecloseRequest(new BigDecimal("600.00"), "Integration settlement"), null);
                    else recovery.writeOff(fixture.tenant(), fixture.advance(),
                            new AdvanceRecoveryService.WriteOffRequest("Integration write-off"), null);
                    if (action.equals("LEGACY_WRITE_OFF")) jdbc.update(
                            "UPDATE advance_mgmt.advance_requests SET status='DISBURSED' WHERE id=?", fixture.advance());
                });

                BusinessRuleException error = assertThrows(BusinessRuleException.class,
                        () -> tx.executeWithoutResult(s -> payroll.processRun(fixture.tenant(), fixture.run(), null)), action);
                assertEquals("ADVANCE_RECOVERY_SETTLED", error.getErrorCode(), action);
                tx.executeWithoutResult(s -> {
                    bind(fixture.tenant());
                    assertEquals(0, jdbc.queryForObject("SELECT outstanding_amount FROM advance_mgmt.advance_requests WHERE id=?", BigDecimal.class, fixture.advance()).signum());
                    assertEquals(action.equals("LEGACY_WRITE_OFF") ? "DISBURSED" : "CLOSED", jdbc.queryForObject("SELECT status FROM advance_mgmt.advance_requests WHERE id=?", String.class, fixture.advance()));
                    assertEquals("RECOVERED", jdbc.queryForObject("SELECT status FROM advance_mgmt.advance_recovery_schedule WHERE advance_request_id=? AND installment_no=1", String.class, fixture.advance()));
                    assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM advance_mgmt.advance_ledger_entries WHERE payroll_run_id=? AND entry_type='REPAYMENT'", Integer.class, fixture.run()));
                    assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM advance_mgmt.advance_recovery_schedule WHERE advance_request_id=? AND status='PENDING'", Integer.class, fixture.advance()));
                    assertEquals(new BigDecimal("300.00"), jdbc.queryForObject("SELECT amount FROM payroll.payslip_lines WHERE run_id=?", BigDecimal.class, fixture.run()));
                    assertEquals("PROCESSING", jdbc.queryForObject("SELECT status FROM payroll.runs WHERE id=?", String.class, fixture.run()));
                });
                tx.executeWithoutResult(s -> {
                    bind(fixture.tenant());
                    jdbc.update("UPDATE payroll.runs SET status='LOCKED' WHERE id=?", fixture.run());
                });
                BusinessRuleException reopenError = assertThrows(BusinessRuleException.class,
                        () -> tx.executeWithoutResult(s -> payroll.reopenRun(fixture.tenant(), fixture.run(), "Integration reprocess attempt", null)));
                assertEquals("ADVANCE_RECOVERY_SETTLED", reopenError.getErrorCode());
                tx.executeWithoutResult(s -> {
                    bind(fixture.tenant());
                    assertEquals("LOCKED", jdbc.queryForObject("SELECT status FROM payroll.runs WHERE id=?", String.class, fixture.run()));
                });
            } finally { cleanup(fixture); }
        }
    }

    @Test void activeUnsettledRecoveryStillAllowsReprocessing() {
        Fixture fixture = seed();
        try {
            assertDoesNotThrow(() -> tx.executeWithoutResult(s -> recovery.assertRunRecoveryCanReprocess(fixture.tenant(), fixture.run())));
            tx.executeWithoutResult(s -> {
                bind(fixture.tenant());
                assertEquals(new BigDecimal("600.00"), jdbc.queryForObject("SELECT outstanding_amount FROM advance_mgmt.advance_requests WHERE id=?", BigDecimal.class, fixture.advance()));
            });
        } finally { cleanup(fixture); }
    }

    private record Fixture(UUID tenant, UUID company, UUID employee, UUID run, UUID advance, UUID component) {}

    private Fixture seed() {
        Fixture f = new Fixture(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        tx.executeWithoutResult(s -> {
            bind(f.tenant());
            jdbc.update("INSERT INTO payroll.runs(id,tenant_id,company_id,period_month,period_year,period_start,period_end,status) VALUES(?,?,?,9,2026,'2026-09-01','2026-09-30','PROCESSING')", f.run(), f.tenant(), f.company());
            jdbc.update("INSERT INTO advance_mgmt.advance_requests(id,tenant_id,employee_id,company_id,amount,repayment_months,monthly_deduction,outstanding_amount,status) VALUES(?,?,?,?,900,3,300,600,'DISBURSED')", f.advance(), f.tenant(), f.employee(), f.company());
            jdbc.update("INSERT INTO advance_mgmt.advance_recovery_schedule(tenant_id,advance_request_id,installment_no,scheduled_month,scheduled_amount,status,payroll_run_id,recovered_amount,recovered_at) VALUES(?,?,1,'2026-09-01',300,'RECOVERED',?,300,now())", f.tenant(), f.advance(), f.run());
            jdbc.update("INSERT INTO advance_mgmt.advance_recovery_schedule(tenant_id,advance_request_id,installment_no,scheduled_month,scheduled_amount,status) VALUES(?,?,2,'2026-10-01',300,'PENDING'),(?,?,3,'2026-11-01',300,'PENDING')", f.tenant(), f.advance(), f.tenant(), f.advance());
            jdbc.update("INSERT INTO advance_mgmt.advance_ledger_entries(tenant_id,advance_request_id,entry_type,amount,balance_after) VALUES(?,?,'DISBURSE',900,900)", f.tenant(), f.advance());
            jdbc.update("INSERT INTO advance_mgmt.advance_ledger_entries(tenant_id,advance_request_id,entry_type,amount,balance_after,payroll_run_id) VALUES(?,?,'REPAYMENT',-300,600,?)", f.tenant(), f.advance(), f.run());
            jdbc.update("INSERT INTO payroll.salary_components(id,tenant_id,code,name,category,computation_type) VALUES(?,?,'ADVANCE_RECOVERY','Advance recovery','DEDUCTION','FIXED')", f.component(), f.tenant());
            jdbc.update("INSERT INTO payroll.payslip_lines(tenant_id,run_id,employee_id,component_id,component_code,component_name,category,amount) VALUES(?,?,?,?,'ADVANCE_RECOVERY','Advance recovery','DEDUCTION',300)", f.tenant(), f.run(), f.employee(), f.component());
        });
        return f;
    }

    private void cleanup(Fixture f) {
        tx.executeWithoutResult(s -> {
            bind(f.tenant());
            jdbc.update("DELETE FROM advance_mgmt.advance_ledger_entries WHERE tenant_id=?", f.tenant());
            jdbc.update("DELETE FROM advance_mgmt.advance_recovery_schedule WHERE tenant_id=?", f.tenant());
            jdbc.update("DELETE FROM advance_mgmt.advance_requests WHERE tenant_id=?", f.tenant());
            jdbc.update("DELETE FROM payroll.payslip_lines WHERE tenant_id=?", f.tenant());
            jdbc.update("DELETE FROM payroll.runs WHERE tenant_id=?", f.tenant());
            jdbc.update("DELETE FROM payroll.salary_components WHERE tenant_id=?", f.tenant());
        });
        com.unifiedtree.security.tenant.TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private void bind(UUID tenant) {
        jdbc.queryForObject("SELECT set_config('app.tenant_id',?,true)", String.class, tenant.toString());
    }
}
