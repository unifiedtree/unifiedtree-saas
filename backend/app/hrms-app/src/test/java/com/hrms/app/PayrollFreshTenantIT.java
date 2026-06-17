package com.hrms.app;

import com.hrms.api.payroll.PayrollRunService;
import com.hrms.api.payroll.PayrollRunService.CreateRunRequest;
import com.hrms.api.payroll.PayrollRunService.EligibleEmployeeDto;
import com.hrms.api.payroll.PayrollRunService.RunDto;
import com.hrms.api.payroll.PayrollService;
import com.hrms.api.payroll.PayrollService.ComponentDto;
import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

/**
 * Payroll Pre-Pilot Fix Sprint — FRESH-TENANT proof (P0-1, P1-3, P1-4).
 *
 * <p>The existing payroll ITs run against the seeded demo tenant, which already
 * has the 9 salary components — exactly the data state that MASKED these bugs.
 * This suite provisions brand-new tenants with ZERO components and drives the
 * services directly, proving the fixes hold on the path a real first customer hits.
 *
 * <ul>
 *   <li><b>test1</b> (FIX P0-1): opening the components page on a zero-component
 *       tenant auto-seeds the 9 defaults.</li>
 *   <li><b>test2</b> (FIX P0-1 + P1-4): processing the first run on a zero-component
 *       tenant auto-seeds and succeeds (net &gt; 0) WITHOUT any manual seed, and the
 *       run surfaces the count + identities of employees skipped for lacking a
 *       salary structure.</li>
 *   <li><b>test3</b> (FIX P1-3): a run that would produce negative net pay (full-month
 *       LOP + flat PT) is halted with NEGATIVE_NET_PAYROLL and rolls back — the run
 *       stays DRAFT and no payslip lines are written.</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = com.hrms.app.HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        "unifiedtree.face.encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "unifiedtree.face.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class PayrollFreshTenantIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_freshtenant_it")
                    .withUsername("ut_test").withPassword("ut_test")
                    .withInitScript("sql/test-init.sql").withReuse(false);

    @BeforeAll static void startContainer() { POSTGRES.start(); }
    @AfterAll  static void stopContainer()  { POSTGRES.stop(); }

    @DynamicPropertySource
    static void dataSourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",      POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", () -> "hrms_app");
        r.add("spring.datasource.password", () -> "hrms_app_test");
        r.add("spring.datasource.hikari.maximum-pool-size", () -> "5");
        r.add("spring.datasource.hikari.minimum-idle",      () -> "1");
        r.add("spring.flyway.url",      POSTGRES::getJdbcUrl);
        r.add("spring.flyway.user",     POSTGRES::getUsername);
        r.add("spring.flyway.password", POSTGRES::getPassword);
    }

    @MockBean MailService mailService;

    @Autowired PayrollRunService runService;
    @Autowired PayrollService payrollService;

    // Three fresh tenants, each starting with ZERO salary components.
    private static final UUID FRESH_1 = UUID.fromString("f1f1f1f1-0001-0001-0001-000000000001");
    private static final UUID FRESH_2 = UUID.fromString("f2f2f2f2-0002-0002-0002-000000000002");
    private static final UUID FRESH_3 = UUID.fromString("f3f3f3f3-0003-0003-0003-000000000003");
    private static final UUID ACTOR   = UUID.fromString("0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a");

    @BeforeEach
    void setup() { doNothing().when(mailService).send(any(EmailMessage.class)); }

    private int componentCount(UUID tenant) {
        Integer[] box = new Integer[1];
        withTenantJdbc(tenant, () -> box[0] = jdbc.queryForObject(
            "SELECT count(*) FROM payroll.salary_components WHERE tenant_id = ?::uuid", Integer.class, tenant.toString()));
        return box[0];
    }

    private UUID provisionCompany(UUID tenant, String name) {
        UUID companyId = UUID.randomUUID();
        withTenantJdbc(tenant, () -> {
            jdbc.update("INSERT INTO platform.tenants (id, subdomain, display_name, contact_email, status, plan_type) " +
                "VALUES (?::uuid, ?, ?, ?, 'ACTIVE', 'ENTERPRISE') ON CONFLICT (id) DO NOTHING",
                tenant.toString(), "fresh-" + tenant.toString().substring(0, 8), name, name + "@itest.demo");
            jdbc.update("INSERT INTO org.companies (id, tenant_id, name) VALUES (?::uuid, ?::uuid, ?)",
                companyId.toString(), tenant.toString(), name + " Pvt Ltd");
        });
        return companyId;
    }

    private UUID addEmployee(UUID tenant, UUID companyId, String code, String firstName) {
        UUID empId = UUID.randomUUID();
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO hrms.employees " +
            "(id, tenant_id, company_id, employee_code, first_name, employment_type, employment_status, date_of_joining) " +
            "VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, 'FULL_TIME', 'PROBATION', DATE '2026-01-01')",
            empId.toString(), tenant.toString(), companyId.toString(), code, firstName));
        return empId;
    }

    /** Insert a current salary structure with NO component lines (engine falls back to BASIC = ctc_monthly). */
    private void addStructure(UUID tenant, UUID empId, int ctcMonthly) {
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO payroll.employee_salary_structures " +
            "(id, tenant_id, employee_id, ctc_annual, ctc_monthly, effective_from, is_current) " +
            "VALUES (gen_random_uuid(), ?::uuid, ?::uuid, ?, ?, DATE '2026-04-01', TRUE)",
            tenant.toString(), empId.toString(), ctcMonthly * 12, ctcMonthly));
    }

    // ── Test 1 — FIX P0-1: components page auto-seeds on a fresh tenant ──────────

    @Test @Order(1)
    void test1_componentsPageAutoSeeds() {
        assertThat(componentCount(FRESH_1)).isZero();             // genuinely empty to start

        List<ComponentDto> components = payrollService.listComponents(FRESH_1);

        assertThat(components).hasSize(9);                        // 9 defaults auto-seeded
        assertThat(componentCount(FRESH_1)).isEqualTo(9);         // and persisted
        assertThat(components).extracting(ComponentDto::code)
            .contains("BASIC", "HRA", "PF_EMPLOYEE", "PT");
    }

    // ── Test 2 — FIX P0-1 + P1-4: first run auto-seeds, succeeds, surfaces skips ──

    @Test @Order(2)
    void test2_firstRunAutoSeedsAndSurfacesSkipped() {
        UUID company = provisionCompany(FRESH_2, "Fresh Two");
        UUID empOk = addEmployee(FRESH_2, company, "F2-001", "Asha");
        addStructure(FRESH_2, empOk, 50_000);
        UUID empNoStruct = addEmployee(FRESH_2, company, "F2-002", "Bharat");  // deliberately no structure

        assertThat(componentCount(FRESH_2)).isZero();             // never seeded, never opened components page

        RunDto draft = runService.createDraftRun(FRESH_2, new CreateRunRequest(company, 4, 2026), ACTOR);
        assertThat(draft.status()).isEqualTo("DRAFT");

        RunDto processed = runService.processRun(FRESH_2, draft.id(), ACTOR);

        // FIX P0-1: processing a zero-component tenant auto-seeded and succeeded.
        assertThat(componentCount(FRESH_2)).isEqualTo(9);
        assertThat(processed.status()).isEqualTo("PROCESSING");
        assertThat(processed.employeeCount()).isEqualTo(1);       // only the employee with a structure
        assertThat(processed.totalNet()).isGreaterThan(java.math.BigDecimal.ZERO);

        // FIX P1-4: the structure-less employee is surfaced, not silently dropped.
        assertThat(processed.skippedEmployeeCount()).isEqualTo(1);
        List<EligibleEmployeeDto> skipped = runService.listSkippedEmployees(FRESH_2, draft.id());
        assertThat(skipped).hasSize(1);
        assertThat(skipped.get(0).employeeId()).isEqualTo(empNoStruct);
        assertThat(skipped.get(0).employeeCode()).isEqualTo("F2-002");
    }

    // ── Test 3 — FIX P1-3: negative net pay halts the run and rolls back ─────────

    @Test @Order(3)
    void test3_negativeNetHaltsRun() {
        UUID company = provisionCompany(FRESH_3, "Fresh Three");
        UUID emp = addEmployee(FRESH_3, company, "F3-001", "Chitra");
        addStructure(FRESH_3, emp, 50_000);                       // gross 50k → KA PT = flat ₹200

        // Enable PT (flat, not pro-rated) so a fully-absent month yields earnings 0 but PT 200.
        withTenantJdbc(FRESH_3, () -> jdbc.update(
            "INSERT INTO payroll.settings (tenant_id, pf_enabled, pt_enabled, pt_state_code) " +
            "VALUES (?::uuid, TRUE, TRUE, 'KA') " +
            "ON CONFLICT (tenant_id) DO UPDATE SET pf_enabled = TRUE, pt_enabled = TRUE, pt_state_code = 'KA'",
            FRESH_3.toString()));

        // Mark every calendar day of April 2026 ABSENT → full LOP → zero earnings.
        withTenantJdbc(FRESH_3, () -> {
            for (LocalDate d = LocalDate.of(2026, 4, 1); !d.isAfter(LocalDate.of(2026, 4, 30)); d = d.plusDays(1)) {
                jdbc.update("INSERT INTO attendance.records (id, tenant_id, employee_id, attendance_date, attendance_status) " +
                    "VALUES (gen_random_uuid(), ?::uuid, ?::uuid, ?::date, 'ABSENT')",
                    FRESH_3.toString(), emp.toString(), d.toString());
            }
        });

        RunDto draft = runService.createDraftRun(FRESH_3, new CreateRunRequest(company, 4, 2026), ACTOR);

        assertThatThrownBy(() -> runService.processRun(FRESH_3, draft.id(), ACTOR))
            .isInstanceOf(BusinessRuleException.class)
            .hasMessageContaining("negative net");

        // Rolled back: run still DRAFT, no payslip lines persisted.
        withTenantJdbc(FRESH_3, () -> {
            assertThat(jdbc.queryForObject("SELECT status FROM payroll.runs WHERE id = ?::uuid",
                String.class, draft.id().toString())).isEqualTo("DRAFT");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ?::uuid",
                Integer.class, draft.id().toString())).isZero();
        });
    }
}
