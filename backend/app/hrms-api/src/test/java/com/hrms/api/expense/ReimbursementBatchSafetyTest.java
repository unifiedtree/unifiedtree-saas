package com.hrms.api.expense;

import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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

/** Real transactions and row-level security; only an explicitly supplied disposable database. */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class ReimbursementBatchSafetyTest {
    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), employee = UUID.randomUUID();
    private JdbcTemplate jdbc;
    private TransactionTemplate tx;
    private ReimbursementBatchService service;

    @BeforeEach void setup() {
        var source = new DriverManagerDataSource(System.getenv("RECOVERY_TEST_JDBC_URL"),
                System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
                System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
        jdbc = new JdbcTemplate(source);
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        service = new ReimbursementBatchService(jdbc);
    }

    @AfterEach void cleanup() {
        tx.executeWithoutResult(s -> {
            bind();
            jdbc.update("DELETE FROM expense_mgmt.reimbursement_batch_items WHERE tenant_id=?", tenant);
            jdbc.update("DELETE FROM expense_mgmt.reimbursement_batches WHERE tenant_id=?", tenant);
            jdbc.update("DELETE FROM expense_mgmt.expense_claims WHERE tenant_id=?", tenant);
        });
        clearTenant();
    }

    @Test void concurrentCutoffsCannotReserveTheSameClaimTwice() throws Exception {
        UUID claim = claim("INR");
        List<String> builds = concurrently(
                () -> { build("2026-09-30", null); return "OK"; },
                () -> { build("2026-10-01", null); return "OK"; });
        assertEquals(List.of("OK", "OK"), builds);
        tx.executeWithoutResult(s -> {
            bind();
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM expense_mgmt.reimbursement_batch_items WHERE claim_id=?", Integer.class, claim));
            assertEquals(1, jdbc.queryForObject("SELECT sum(claim_count) FROM expense_mgmt.reimbursement_batches WHERE tenant_id=?", Integer.class, tenant));
        });
    }

    @Test void cancelReleasesClaimsAtomicallyAndOldRevertCannotStealAReplacementReservation() throws Exception {
        UUID claim = claim("INR");
        var original = build("2026-09-30", "INR").batch();
        tx.execute(s -> service.post(tenant, original.id(), null));
        assertEquals("APPROVED_FOR_PAY", claimStatus(claim));
        tx.execute(s -> service.cancel(tenant, original.id(), null));
        assertEquals("APPROVED", claimStatus(claim), "Cancel must release the claim without a second request");

        var replacement = build("2026-09-30", "INR").batch();
        assertNotEquals(original.id(), replacement.id());
        tx.execute(s -> service.post(tenant, replacement.id(), null));
        int reverted = tx.execute(s -> service.revertClaimsToApproved(tenant, original.id(), null));
        assertEquals(0, reverted);
        assertEquals("APPROVED_FOR_PAY", claimStatus(claim));

        List<String> payments = concurrently(
                () -> attempt(() -> pay(replacement.id(), "TEST-A")),
                () -> attempt(() -> pay(replacement.id(), "TEST-B")));
        assertEquals(1, payments.stream().filter("OK"::equals).count(), payments.toString());
        assertTrue(payments.contains("BATCH_NOT_POSTED"), payments.toString());
        assertEquals("REIMBURSED", claimStatus(claim));
        assertEquals("BATCH_ALREADY_PAID", attempt(() -> tx.execute(s -> service.cancel(tenant, replacement.id(), null))));
        assertEquals("REIMBURSED", claimStatus(claim));
    }

    @Test void externallyReimbursedDraftClaimCannotBePostedOrPaidAgain() {
        UUID claim = claim("INR");
        var draft = build("2026-09-30", "INR").batch();
        tx.executeWithoutResult(s -> {
            bind();
            jdbc.update("UPDATE expense_mgmt.expense_claims SET status='REIMBURSED' WHERE id=?", claim);
        });
        assertEquals("BATCH_CLAIM_STATE_DRIFT", attempt(() -> tx.execute(s -> service.post(tenant, draft.id(), null))));
        assertEquals("DRAFT", tx.execute(s -> service.get(tenant, draft.id()).batch().status()));
        assertEquals("REIMBURSED", claimStatus(claim));
    }

    @Test void simultaneousCancelAndPaymentLeaveOneConsistentOutcome() throws Exception {
        UUID claim = claim("INR");
        var batch = build("2026-09-30", "INR").batch();
        tx.execute(s -> service.post(tenant, batch.id(), null));
        List<String> outcomes = concurrently(
                () -> attempt(() -> pay(batch.id(), "TEST-PAYMENT")),
                () -> attempt(() -> tx.execute(s -> service.cancel(tenant, batch.id(), null))));
        assertEquals(1, outcomes.stream().filter("OK"::equals).count(), outcomes.toString());
        String status = tx.execute(s -> service.get(tenant, batch.id()).batch().status());
        if ("PAID".equals(status)) {
            assertEquals("REIMBURSED", claimStatus(claim));
            assertTrue(outcomes.contains("BATCH_ALREADY_PAID"), outcomes.toString());
        } else {
            assertEquals("CANCELLED", status);
            assertEquals("APPROVED", claimStatus(claim));
            assertTrue(outcomes.contains("BATCH_NOT_POSTED"), outcomes.toString());
        }
    }

    @Test void mixedCurrenciesRequireSeparateBatchesAndExposeTheirCurrency() {
        claim("INR");
        claim("USD");
        assertEquals("BATCH_MIXED_CURRENCY", attempt(() -> build("2026-09-30", null)));
        assertTrue(tx.execute(s -> service.list(tenant, company, null)).isEmpty(), "Failed build rolls back its draft and items");
        var inr = build("2026-09-30", "INR");
        assertEquals(1, inr.batch().claimCount());
        assertEquals("INR", inr.batch().currency());
        assertEquals("INR", inr.items().get(0).currency());
        assertEquals("Local fixture notes", inr.items().get(0).claimNotes());
        assertEquals("BATCH_DRAFT_CURRENCY_MISMATCH", attempt(() -> build("2026-09-30", "USD")));
        tx.execute(s -> service.post(tenant, inr.batch().id(), null));
        var usd = build("2026-09-30", "USD");
        assertEquals(1, usd.batch().claimCount());
        assertEquals("USD", usd.batch().currency());
        assertNotEquals(inr.batch().id(), usd.batch().id());
    }

    private UUID claim(String currency) {
        UUID id = UUID.randomUUID();
        tx.executeWithoutResult(s -> {
            bind();
            jdbc.update("INSERT INTO expense_mgmt.expense_claims(id,tenant_id,employee_id,company_id,title,total_amount,currency,status,approved_at,notes) VALUES(?,?,?,?,'Local reimbursement fixture',125,?,'APPROVED','2026-09-20','Local fixture notes')", id, tenant, employee, company, currency);
        });
        return id;
    }
    private ReimbursementBatchService.BatchDetailDto build(String cutoff, String currency) {
        return tx.execute(s -> service.build(tenant, new ReimbursementBatchService.BuildBatchRequest(company, cutoff, null, currency), null));
    }
    private void pay(UUID batch, String reference) {
        tx.execute(s -> service.markPaid(tenant, batch, new ReimbursementBatchService.MarkPaidRequest(reference, null), null));
    }
    private String claimStatus(UUID id) {
        return tx.execute(s -> { bind(); return jdbc.queryForObject("SELECT status FROM expense_mgmt.expense_claims WHERE id=?", String.class, id); });
    }
    private void bind() { jdbc.queryForObject("SELECT set_config('app.tenant_id',?,true)", String.class, tenant.toString()); }
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
