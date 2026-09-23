package com.hrms.api.payroll;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** Explicit opt-in: use only a migrated, disposable recovery database. */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class DisbursementConcurrencyTest {
    @Test void concurrentBanksAndPaymentAttemptsProduceOneActiveBatchAndOnePayment() throws Exception {
        var source = new DriverManagerDataSource(System.getenv("RECOVERY_TEST_JDBC_URL"),
                System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
                System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
        var jdbc = new JdbcTemplate(source);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        var service = new DisbursementBatchService(jdbc);
        UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), run = UUID.randomUUID();
        UUID firstBank = UUID.randomUUID(), secondBank = UUID.randomUUID(), actor = UUID.randomUUID();
        try {
            tx.executeWithoutResult(s -> {
                bind(jdbc, tenant);
                jdbc.update("INSERT INTO payroll.runs(id,tenant_id,company_id,period_month,period_year,period_start,period_end,status) VALUES(?,?,?,9,2026,'2026-09-01','2026-09-30','LOCKED')", run, tenant, company);
                for (UUID bank : List.of(firstBank, secondBank)) jdbc.update("INSERT INTO payroll.bank_profiles(id,tenant_id,company_id,profile_name,bank_format,debit_account_no,ifsc) VALUES(?,?,?,'Concurrency test','GENERIC_CSV','123456789','HDFC0001234')", bank, tenant, company);
            });
            Callable<String> first = () -> attempt(() -> tx.execute(s -> service.buildFromRun(tenant,
                    new DisbursementBatchService.BuildBatchRequest(run, firstBank), actor)));
            Callable<String> second = () -> attempt(() -> tx.execute(s -> service.buildFromRun(tenant,
                    new DisbursementBatchService.BuildBatchRequest(run, secondBank), actor)));
            List<String> builds = concurrently(first, second);
            assertEquals(1, builds.stream().filter("OK"::equals).count(), builds.toString());
            assertTrue(builds.contains("BATCH_ALREADY_EXISTS"), builds.toString());

            UUID originalBatch = tx.execute(s -> { bind(jdbc, tenant); return jdbc.queryForObject("SELECT id FROM payroll.disbursement_batches WHERE run_id=?", UUID.class, run); });
            tx.execute(s -> service.cancel(tenant, originalBatch, actor));
            var replacement = tx.execute(s -> service.buildFromRun(tenant,
                    new DisbursementBatchService.BuildBatchRequest(run, secondBank), actor));
            assertNotNull(replacement);
            assertNotEquals(originalBatch, replacement.batch().id(), "Cancelled history must allow a replacement batch");
            UUID batch = replacement.batch().id();
            tx.executeWithoutResult(s -> {
                bind(jdbc, tenant);
                // The test concerns lifecycle concurrency, not salary computation.
                jdbc.update("UPDATE payroll.disbursement_batches SET status='POSTED',beneficiary_count=1,total_amount=100 WHERE id=?", batch);
            });
            List<String> payments = concurrently(
                    () -> attempt(() -> tx.execute(s -> service.markPaid(tenant, batch, new DisbursementBatchService.MarkPaidRequest("TEST-A", null), actor))),
                    () -> attempt(() -> tx.execute(s -> service.markPaid(tenant, batch, new DisbursementBatchService.MarkPaidRequest("TEST-B", null), actor))));
            assertEquals(1, payments.stream().filter("OK"::equals).count(), payments.toString());
            assertTrue(payments.contains("BATCH_NOT_POSTED"), payments.toString());
            tx.executeWithoutResult(s -> {
                bind(jdbc, tenant);
                assertEquals("PAID", jdbc.queryForObject("SELECT status FROM payroll.runs WHERE id=?", String.class, run));
                assertEquals("PAID", jdbc.queryForObject("SELECT status FROM payroll.disbursement_batches WHERE id=?", String.class, batch));
                assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM payroll.disbursement_batches WHERE run_id=? AND status<>'CANCELLED'", Integer.class, run));
            });
        } finally {
            tx.executeWithoutResult(s -> {
                bind(jdbc, tenant);
                jdbc.update("DELETE FROM payroll.disbursement_batch_lines WHERE tenant_id=?", tenant);
                jdbc.update("DELETE FROM payroll.disbursement_batches WHERE tenant_id=?", tenant);
                jdbc.update("DELETE FROM payroll.runs WHERE id=?", run);
                jdbc.update("DELETE FROM payroll.bank_profiles WHERE tenant_id=?", tenant);
            });
            clearTenant();
        }
    }

    private static void bind(JdbcTemplate jdbc, UUID tenant) {
        jdbc.queryForObject("SELECT set_config('app.tenant_id',?,true)", String.class, tenant.toString());
    }
    private static String attempt(Runnable action) {
        try { action.run(); return "OK"; }
        catch (BusinessRuleException e) { return e.getErrorCode(); }
        finally { clearTenant(); }
    }
    private static void clearTenant() {
        com.unifiedtree.security.tenant.TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }
    private static List<String> concurrently(Callable<String> first, Callable<String> second) throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var a = executor.submit(() -> { start.await(); return first.call(); });
            var b = executor.submit(() -> { start.await(); return second.call(); });
            start.countDown();
            return List.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS));
        }
    }
}
