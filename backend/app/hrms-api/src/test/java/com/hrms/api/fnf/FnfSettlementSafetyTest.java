package com.hrms.api.fnf;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.fnf.dto.FnfComponentRequest;
import com.hrms.fnf.dto.FnfSettlementRequest;
import com.hrms.fnf.dto.FnfSettlementResponse;
import com.hrms.fnf.enums.FnfComponentType;
import com.hrms.fnf.enums.FnfStatus;
import com.hrms.fnf.repository.FnfComponentRepository;
import com.hrms.fnf.repository.FnfSettlementRepository;
import com.hrms.fnf.service.FnfService;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real JPA repositories, PostgreSQL transactions and forced tenant RLS. */
@EnabledIfEnvironmentVariable(named = "RECOVERY_TEST_JDBC_URL", matches = ".+")
class FnfSettlementSafetyTest {
    @Configuration
    @EnableJpaRepositories(basePackageClasses = FnfSettlementRepository.class)
    @EnableJpaAuditing
    static class Config {
        @Bean DataSource dataSource() {
            return new DriverManagerDataSource(System.getenv("RECOVERY_TEST_JDBC_URL"),
                    System.getenv().getOrDefault("RECOVERY_TEST_DB_USER", "postgres"),
                    System.getenv().getOrDefault("RECOVERY_TEST_DB_PASSWORD", ""));
        }
        @Bean LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource source) {
            var factory = new LocalContainerEntityManagerFactoryBean();
            factory.setDataSource(source);
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            factory.setManagedTypes(PersistenceManagedTypes.of(
                    List.of("com.hrms.fnf.entity.FnfSettlement", "com.hrms.fnf.entity.FnfComponent"), List.of("com.hrms")));
            factory.setJpaPropertyMap(java.util.Map.of("hibernate.hbm2ddl.auto", "none"));
            return factory;
        }
        @Bean JpaTransactionManager transactionManager(EntityManagerFactory factory) { return new JpaTransactionManager(factory); }
    }

    private static AnnotationConfigApplicationContext context;
    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), employee = UUID.randomUUID(), approver = UUID.randomUUID();
    private final LocalDate exitDate = LocalDate.of(2026,9,22);
    private JdbcTemplate jdbc;
    private TransactionTemplate tx;
    private FnfService service;
    private FnfSettlementRepository settlements;
    private FnfComponentRepository components;

    @BeforeAll static void startJpa() { context = new AnnotationConfigApplicationContext(Config.class); }
    @AfterAll static void closeJpa() { if (context != null) context.close(); }
    @BeforeEach void seedEmployee() {
        jdbc = new JdbcTemplate(context.getBean(DataSource.class));
        tx = new TransactionTemplate(context.getBean(JpaTransactionManager.class));
        settlements = context.getBean(FnfSettlementRepository.class);
        components = context.getBean(FnfComponentRepository.class);
        service = new FnfService(settlements, components, jdbc);
        tx.executeWithoutResult(s -> {
            bind();
            jdbc.update("INSERT INTO hrms.employees(id,tenant_id,company_id,employee_code,first_name,employment_type,employment_status,last_working_day) VALUES(?,?,?,'FNF-QA','Local FnF fixture','FULL_TIME','EXITED',?)", employee,tenant,company,exitDate);
        });
    }
    @AfterEach void cleanup() {
        tx.executeWithoutResult(s -> {
            bind();
            jdbc.update("DELETE FROM fnf_mgmt.fnf_components WHERE tenant_id=?",tenant);
            jdbc.update("DELETE FROM fnf_mgmt.fnf_settlements WHERE tenant_id=?",tenant);
            jdbc.update("DELETE FROM advance_mgmt.advance_ledger_entries WHERE tenant_id=?",tenant);
            jdbc.update("DELETE FROM advance_mgmt.advance_recovery_schedule WHERE tenant_id=?",tenant);
            jdbc.update("DELETE FROM advance_mgmt.advance_requests WHERE tenant_id=?",tenant);
            jdbc.update("DELETE FROM hrms.employees WHERE tenant_id=?",tenant);
        });
        clearTenant();
    }

    @Test void concurrentCreationProducesOneSettlementForTheExit() throws Exception {
        List<String> outcomes = concurrently(() -> attempt(() -> process(0)), () -> attempt(() -> process(0)));
        assertEquals(1, outcomes.stream().filter("OK"::equals).count(),outcomes.toString());
        assertTrue(outcomes.contains("FNF_SETTLEMENT_EXISTS"),outcomes.toString());
        assertEquals(1, count("fnf_mgmt.fnf_settlements"));
    }

    @Test void companyAndRecordedExitDateCannotBeOverridden() {
        assertEquals("FNF_COMPANY_MISMATCH",attempt(() -> tx.execute(s -> { bind(); return service.processSettlement(UUID.randomUUID(),request(0,exitDate)); })));
        assertEquals("FNF_EXIT_DATE_MISMATCH",attempt(() -> tx.execute(s -> { bind(); return service.processSettlement(company,request(0,exitDate.plusDays(1))); })));
        assertEquals(0,count("fnf_mgmt.fnf_settlements"));
    }

    @Test void approvalRevalidatesAnEmployeeExitChangedAfterProcessing() {
        var settlement = process(0);
        tx.executeWithoutResult(s -> { bind(); jdbc.update("UPDATE hrms.employees SET employment_status='ACTIVE' WHERE id=?",employee); });
        assertEquals("EMPLOYEE_NOT_SEPARATED",attempt(() -> approve(settlement.id())));
        tx.executeWithoutResult(s -> { bind(); jdbc.update("UPDATE hrms.employees SET employment_status='EXITED',last_working_day=? WHERE id=?",exitDate.plusDays(1),employee); });
        assertEquals("FNF_EXIT_DATE_MISMATCH",attempt(() -> approve(settlement.id())));
        tx.executeWithoutResult(s -> { bind(); jdbc.update("UPDATE hrms.employees SET last_working_day=?,company_id=? WHERE id=?",exitDate,UUID.randomUUID(),employee); });
        assertEquals("FNF_COMPANY_MISMATCH",attempt(() -> approve(settlement.id())));
        assertEquals(FnfStatus.PROCESSED,status(settlement.id()));
    }

    @Test void approvalClosesOutstandingDebtWithoutPendingInstallmentsExactlyOnce() throws Exception {
        UUID advance = advance(100);
        var settlement = process(100);
        List<String> outcomes = concurrently(
                () -> attempt(() -> approve(settlement.id())),
                () -> attempt(() -> approve(settlement.id())));
        assertEquals(1,outcomes.stream().filter("OK"::equals).count(),outcomes.toString());
        assertTrue(outcomes.contains("FNF_NOT_PROCESSED"),outcomes.toString());
        assertEquals("CLOSED",advanceStatus(advance));
        assertEquals(0,balance(advance).signum());
        assertEquals(1,count("advance_mgmt.advance_ledger_entries"));
        assertEquals(FnfStatus.APPROVED,status(settlement.id()));
        assertEquals("FNF_CANNOT_CANCEL",attempt(() -> tx.execute(s -> { bind(); return service.cancel(settlement.id()); })));
    }

    @Test void changedAdvanceBalanceBlocksApprovalAndAllowsUnapprovedCorrection() {
        UUID advance = advance(100);
        var original = process(100);
        tx.executeWithoutResult(s -> { bind(); jdbc.update("UPDATE advance_mgmt.advance_requests SET outstanding_amount=60 WHERE id=?",advance); });
        assertEquals("FNF_OUTSTANDING_ADVANCE",attempt(() -> approve(original.id())));
        assertEquals(FnfStatus.PROCESSED,status(original.id()));
        assertEquals(new BigDecimal("60.00"),balance(advance));
        assertEquals(0,count("advance_mgmt.advance_ledger_entries"));
        tx.execute(s -> { bind(); return service.cancel(original.id()); });
        var corrected = process(60);
        assertNotEquals(original.id(),corrected.id());
        approve(corrected.id());
        assertEquals(FnfStatus.CANCELLED,status(original.id()));
        assertEquals(FnfStatus.APPROVED,status(corrected.id()));
        assertEquals(0,balance(advance).signum());
    }

    @Test void aLaterLedgerFailureRollsBackEarlierForeclosureAndApproval() {
        UUID first = advance(40), second = advance(60);
        var settlement = process(100);
        JdbcTemplate failingJdbc = spy(jdbc);
        AtomicInteger writes = new AtomicInteger();
        doAnswer(call -> {
            if (writes.incrementAndGet()==2) throw new DataAccessResourceFailureException("Deliberate second-ledger outage");
            return call.callRealMethod();
        }).when(failingJdbc).update(contains("INSERT INTO advance_mgmt.advance_ledger_entries"),any(Object[].class));
        var failingService = new FnfService(settlements,components,failingJdbc);
        assertThrows(DataAccessResourceFailureException.class,() -> tx.execute(s -> { bind(); return failingService.approve(settlement.id(),approver); }));
        assertEquals(FnfStatus.PROCESSED,status(settlement.id()));
        assertEquals("DISBURSED",advanceStatus(first));
        assertEquals("DISBURSED",advanceStatus(second));
        assertEquals(new BigDecimal("100.00"),balance(first).add(balance(second)));
        assertEquals(0,count("advance_mgmt.advance_ledger_entries"));
    }

    @Test void concurrentPaymentCannotRecordTheSameSettlementTwice() throws Exception {
        var settlement = process(0);
        approve(settlement.id());
        List<String> outcomes = concurrently(
                () -> attempt(() -> tx.execute(s -> { bind(); return service.pay(settlement.id()); })),
                () -> attempt(() -> tx.execute(s -> { bind(); return service.pay(settlement.id()); })));
        assertEquals(1,outcomes.stream().filter("OK"::equals).count(),outcomes.toString());
        assertTrue(outcomes.contains("FNF_NOT_APPROVED"),outcomes.toString());
        assertEquals(FnfStatus.PAID,status(settlement.id()));
        assertEquals("FNF_SETTLEMENT_EXISTS",attempt(() -> process(0)));
    }

    private FnfSettlementRequest request(int recovery,LocalDate date) {
        var lines = new java.util.ArrayList<FnfComponentRequest>();
        lines.add(new FnfComponentRequest("Final salary",FnfComponentType.EARNING,new BigDecimal("1000")));
        if(recovery>0) lines.add(new FnfComponentRequest("Advance Recovery",FnfComponentType.DEDUCTION,BigDecimal.valueOf(recovery)));
        return new FnfSettlementRequest(employee,company,date,"Local test",lines);
    }
    private FnfSettlementResponse process(int recovery) { return tx.execute(s -> { bind(); return service.processSettlement(company,request(recovery,exitDate)); }); }
    private void approve(UUID id) { tx.execute(s -> { bind(); return service.approve(id,approver); }); }
    private UUID advance(int amount) {
        UUID id=UUID.randomUUID();
        tx.executeWithoutResult(s -> { bind(); jdbc.update("INSERT INTO advance_mgmt.advance_requests(id,tenant_id,employee_id,company_id,amount,repayment_months,monthly_deduction,outstanding_amount,status) VALUES(?,?,?,?,?,1,?,?,'DISBURSED')",id,tenant,employee,company,amount,amount,amount); });
        return id;
    }
    private FnfStatus status(UUID id) { return tx.execute(s -> { bind(); return service.getSettlement(id).status(); }); }
    private BigDecimal balance(UUID id) { return tx.execute(s -> { bind(); return jdbc.queryForObject("SELECT outstanding_amount FROM advance_mgmt.advance_requests WHERE id=?",BigDecimal.class,id); }); }
    private String advanceStatus(UUID id) { return tx.execute(s -> { bind(); return jdbc.queryForObject("SELECT status FROM advance_mgmt.advance_requests WHERE id=?",String.class,id); }); }
    private int count(String fixedTable) { return tx.execute(s -> { bind(); return jdbc.queryForObject("SELECT count(*) FROM "+fixedTable+" WHERE tenant_id=?",Integer.class,tenant); }); }
    private void bind() { TenantContext.setTenantId(tenant); com.unifiedtree.security.tenant.TenantContext.setTenantId(tenant); jdbc.queryForObject("SELECT set_config('app.tenant_id',?,true)",String.class,tenant.toString()); }
    private static void clearTenant() { TenantContext.clear(); com.unifiedtree.security.tenant.TenantContext.clear(); }
    private static String attempt(Runnable action) { try { action.run(); return "OK"; } catch(BusinessRuleException e) { return e.getErrorCode(); } finally { clearTenant(); } }
    private static List<String> concurrently(Callable<String> first,Callable<String> second) throws Exception {
        var start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(() -> { start.await(); return first.call(); });
            var b=pool.submit(() -> { start.await(); return second.call(); });
            start.countDown();
            return List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS));
        }
    }
}
