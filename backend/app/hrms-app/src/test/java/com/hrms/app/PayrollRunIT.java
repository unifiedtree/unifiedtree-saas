package com.hrms.app;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpMethod;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

/**
 * Payroll run lifecycle integration tests (Prompt 13a) — 8 tests:
 *  1. FINANCE_LEAD creates a draft run -> 201, status DRAFT.
 *  2. Eligible employees = the two seeded employees that have a current structure.
 *  3. Process -> PROCESSING + payslip_lines + run_lop_days written.
 *  4. Per-employee line count = earnings + statutory deductions + employer contribution.
 *  5. Lock -> LOCKED, locked_at set.
 *  6. Reopen a LOCKED run -> 422 with errorCode CANNOT_REOPEN_LOCKED.
 *  7. EMPLOYEE /payslips/me -> only own, only LOCKED (unlocked run invisible).
 *  8. Cross-tenant: tenant A's runs invisible under tenant B (RLS).
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
class PayrollRunIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_payrollrun_it")
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

    private static final UUID READER_EMP = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID FIN_EMP    = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID COMPANY_A  = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static UUID RUN_ID;          // created in test 1, reused by ordered tests
    private static boolean seeded = false;

    @BeforeEach
    void setup() {
        doNothing().when(mailService).send(any(EmailMessage.class));
        ensureSeeded();
    }

    private String token(String email) { return (String) login(TENANT_A, email, "Hrms@12345").get("accessToken"); }

    private int call(HttpMethod m, String uri, String token, Object body) {
        var spec = http().method(m).uri(uri)
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", TENANT_A.toString());
        if (body != null) spec = spec.header("Content-Type", "application/json").body(body);
        return spec.retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> postForMap(String uri, String token, Object body) {
        var spec = http().post().uri(uri)
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", TENANT_A.toString())
            .header("Content-Type", "application/json").body(body);
        return spec.retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class).getBody();
    }

    private List<?> getList(String uri, String token) {
        return http().get().uri(uri)
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).body(List.class);
    }

    /** Seed components + statutory settings + two salary structures (once). */
    private void ensureSeeded() {
        if (seeded) return;
        String admin = token("admin@unifiedtree.demo");
        call(HttpMethod.POST, "/v1/payroll/components/seed-defaults", admin, null);
        call(HttpMethod.PUT, "/v1/payroll/settings", admin,
            Map.of("pfEnabled", true, "esiEnabled", false, "ptEnabled", true, "ptStateCode", "KA"));

        Map<String, UUID> comp = new HashMap<>();
        withTenantJdbc(TENANT_A, () -> jdbc.query(
            "SELECT id, code FROM payroll.salary_components WHERE tenant_id = ?::uuid",
            rs -> { comp.put(rs.getString("code"), rs.getObject("id", UUID.class)); }, TENANT_A.toString()));

        String fin = token("fin@unifiedtree.demo");
        assertThat(call(HttpMethod.POST, "/v1/payroll/structures", fin, Map.of(
            "employeeId", READER_EMP.toString(), "ctcAnnual", 600000, "effectiveFrom", "2026-04-01",
            "pfApplicable", true, "pfStatus", "ENROLLED",
            "components", List.of(
                Map.of("componentId", comp.get("BASIC").toString(),   "monthlyAmount", 25000),
                Map.of("componentId", comp.get("HRA").toString(),     "monthlyAmount", 12500),
                Map.of("componentId", comp.get("SPECIAL").toString(), "monthlyAmount", 12500)))))
            .isEqualTo(200);
        assertThat(call(HttpMethod.POST, "/v1/payroll/structures", fin, Map.of(
            "employeeId", FIN_EMP.toString(), "ctcAnnual", 720000, "effectiveFrom", "2026-04-01",
            "pfApplicable", true, "pfStatus", "ENROLLED",
            "components", List.of(
                Map.of("componentId", comp.get("BASIC").toString(),   "monthlyAmount", 30000),
                Map.of("componentId", comp.get("HRA").toString(),     "monthlyAmount", 15000),
                Map.of("componentId", comp.get("SPECIAL").toString(), "monthlyAmount", 15000)))))
            .isEqualTo(200);
        seeded = true;
    }

    // ── Test 1 ───────────────────────────────────────────────────────────────

    @Test @Order(1)
    void test1_createDraftRun() {
        var resp = http().post().uri("/v1/payroll/runs")
            .header("Authorization", "Bearer " + token("fin@unifiedtree.demo")).header("X-Tenant-ID", TENANT_A.toString())
            .header("Content-Type", "application/json")
            .body(Map.of("companyId", COMPANY_A.toString(), "periodMonth", 4, "periodYear", 2026))
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class);

        assertThat(resp.getStatusCode().value()).isEqualTo(201);
        assertThat(resp.getBody()).isNotNull();
        assertThat(resp.getBody().get("status")).isEqualTo("DRAFT");
        RUN_ID = UUID.fromString((String) resp.getBody().get("id"));

        withTenantJdbc(TENANT_A, () -> {
            String st = jdbc.queryForObject("SELECT status FROM payroll.runs WHERE id = ?::uuid",
                String.class, RUN_ID.toString());
            assertThat(st).isEqualTo("DRAFT");
        });
    }

    // ── Test 2 ───────────────────────────────────────────────────────────────

    @Test @Order(2)
    void test2_eligibleEmployees() {
        List<?> elig = getList("/v1/payroll/runs/" + RUN_ID + "/eligible-employees", token("fin@unifiedtree.demo"));
        assertThat(elig).hasSize(2);
        Set<Object> ids = new HashSet<>();
        for (Object o : elig) ids.add(((Map<?, ?>) o).get("employeeId"));
        assertThat(ids).contains(READER_EMP.toString(), FIN_EMP.toString());
    }

    // ── Test 3 ───────────────────────────────────────────────────────────────

    @Test @Order(3)
    void test3_processRun() {
        assertThat(call(HttpMethod.POST, "/v1/payroll/runs/" + RUN_ID + "/process",
            token("fin@unifiedtree.demo"), null)).isEqualTo(200);

        withTenantJdbc(TENANT_A, () -> {
            assertThat(jdbc.queryForObject("SELECT status FROM payroll.runs WHERE id = ?::uuid",
                String.class, RUN_ID.toString())).isEqualTo("PROCESSING");
            Integer lines = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ?::uuid", Integer.class, RUN_ID.toString());
            assertThat(lines).isGreaterThan(0);
            Integer lopRows = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.run_lop_days WHERE run_id = ?::uuid", Integer.class, RUN_ID.toString());
            assertThat(lopRows).isEqualTo(2);
        });
    }

    // ── Test 4 ───────────────────────────────────────────────────────────────

    @Test @Order(4)
    void test4_lineBreakdownPerEmployee() {
        withTenantJdbc(TENANT_A, () -> {
            Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ?::uuid AND employee_id = ?::uuid",
                Integer.class, RUN_ID.toString(), READER_EMP.toString());
            assertThat(n).isEqualTo(6);   // 3 earnings + PF_EMPLOYEE + PT + PF_EMPLOYER

            Integer earn = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ?::uuid AND employee_id = ?::uuid AND category = 'EARNING'",
                Integer.class, RUN_ID.toString(), READER_EMP.toString());
            Integer ded = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ?::uuid AND employee_id = ?::uuid AND category = 'DEDUCTION'",
                Integer.class, RUN_ID.toString(), READER_EMP.toString());
            Integer erc = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.payslip_lines WHERE run_id = ?::uuid AND employee_id = ?::uuid AND category = 'EMPLOYER_CONTRIBUTION'",
                Integer.class, RUN_ID.toString(), READER_EMP.toString());
            assertThat(earn).isEqualTo(3);
            assertThat(ded).isEqualTo(2);
            assertThat(erc).isEqualTo(1);
            assertThat(earn + ded + erc).isEqualTo(n);
        });
    }

    // ── Test 5 ───────────────────────────────────────────────────────────────

    @Test @Order(5)
    void test5_lockRun() {
        assertThat(call(HttpMethod.POST, "/v1/payroll/runs/" + RUN_ID + "/lock",
            token("fin@unifiedtree.demo"), null)).isEqualTo(200);
        withTenantJdbc(TENANT_A, () -> {
            Map<String, Object> r = jdbc.queryForMap(
                "SELECT status, locked_at FROM payroll.runs WHERE id = ?::uuid", RUN_ID.toString());
            assertThat(r.get("status")).isEqualTo("LOCKED");
            assertThat(r.get("locked_at")).isNotNull();
        });
    }

    // ── Test 6 ───────────────────────────────────────────────────────────────

    @Test @Order(6)
    void test6_reopenLockedRejected() {
        var resp = http().post().uri("/v1/payroll/runs/" + RUN_ID + "/reopen")
            .header("Authorization", "Bearer " + token("fin@unifiedtree.demo")).header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class);
        assertThat(resp.getStatusCode().value()).isEqualTo(422);
        assertThat(resp.getBody()).isNotNull();
        assertThat(resp.getBody().get("errorCode")).isEqualTo("CANNOT_REOPEN_LOCKED");
    }

    // ── Test 7 ───────────────────────────────────────────────────────────────

    @Test @Order(7)
    void test7_employeeSeesOwnLockedPayslipOnly() {
        String reader = token("reader@unifiedtree.demo");
        List<?> mine = getList("/v1/payroll/payslips/me", reader);
        assertThat(mine).hasSize(1);
        Map<?, ?> slip = (Map<?, ?>) mine.get(0);
        assertThat(slip.get("runId")).isEqualTo(RUN_ID.toString());
        assertThat(slip.get("status")).isEqualTo("LOCKED");

        // A processed-but-unlocked run (different period) stays invisible to the employee.
        Map<String, Object> draft = postForMap("/v1/payroll/runs", token("fin@unifiedtree.demo"),
            Map.of("companyId", COMPANY_A.toString(), "periodMonth", 5, "periodYear", 2026));
        UUID run2 = UUID.fromString((String) draft.get("id"));
        call(HttpMethod.POST, "/v1/payroll/runs/" + run2 + "/process", token("fin@unifiedtree.demo"), null);

        List<?> mineAgain = getList("/v1/payroll/payslips/me", reader);
        assertThat(mineAgain).hasSize(1);   // still only the locked April run
    }

    // ── Test 8 ───────────────────────────────────────────────────────────────

    @Test @Order(8)
    void test8_crossTenantInvisible() {
        withTenantJdbc(TENANT_B, () -> {
            jdbc.update("INSERT INTO platform.tenants (id, subdomain, display_name, contact_email, status, plan_type) " +
                "VALUES (?::uuid,'payrollrunb-it','Payroll Run B','b@itest.demo','ACTIVE','ENTERPRISE') ON CONFLICT (id) DO NOTHING",
                TENANT_B.toString());
            jdbc.update("INSERT INTO platform.tenant_modules (id, tenant_id, module_key, status, requested_at, activated_at) " +
                "VALUES (gen_random_uuid(), ?::uuid, 'hrms', 'ACTIVE', now(), now()) ON CONFLICT (tenant_id, module_key) DO UPDATE SET status='ACTIVE'",
                TENANT_B.toString());

            Integer aRuns = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.runs WHERE tenant_id = ?::uuid", Integer.class, TENANT_A.toString());
            assertThat(aRuns).isZero();   // RLS hides tenant A's rows under tenant B
            Integer anyRun = jdbc.queryForObject("SELECT count(*) FROM payroll.runs", Integer.class);
            assertThat(anyRun).isZero();
            Integer anyLine = jdbc.queryForObject("SELECT count(*) FROM payroll.payslip_lines", Integer.class);
            assertThat(anyLine).isZero();
        });
    }
}
