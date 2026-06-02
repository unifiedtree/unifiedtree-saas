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
 * Payroll foundation integration tests (Prompt 12) — 8 tests:
 *  1. SUPER_ADMIN updates settings (PF on, ESI off, PT=KA) -> persists.
 *  2. EMPLOYEE PUT settings -> 403.
 *  3. seed-defaults -> 9 component rows (idempotent on 2nd call).
 *  4. Cross-tenant: tenant A components invisible to tenant B.
 *  5. Create structure pf_applicable=false; second structure flips previous off (one current).
 *  6. EMPLOYEE GET /structures/me -> own.
 *  7. EMPLOYEE GET /structures/employee/{other} -> 403.
 *  8. pt-slabs KA -> 2 rows, XX -> empty.
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
class PayrollFoundationIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_payroll_it")
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

    @BeforeEach
    void setupMailMock() { doNothing().when(mailService).send(any(EmailMessage.class)); }

    private static final UUID READER_EMP = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID OTHER_EMP  = UUID.fromString("55555555-5555-5555-5555-555555555555"); // fin
    private static final UUID COMPANY_B  = UUID.fromString("bbbb0000-0000-0000-0000-0000000000c1");

    private String token(String email) { return (String) login(TENANT_A, email, "Hrms@12345").get("accessToken"); }

    private int call(HttpMethod m, String uri, String token, Object body) {
        var spec = http().method(m).uri(uri)
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", TENANT_A.toString());
        if (body != null) spec = spec.header("Content-Type", "application/json").body(body);
        return spec.retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity().getStatusCode().value();
    }

    private void seedTenantB() {
        withTenantJdbc(TENANT_B, () -> {
            jdbc.update("INSERT INTO platform.tenants (id, subdomain, display_name, contact_email, status, plan_type) " +
                "VALUES (?::uuid,'payrollb-it','Payroll B','b@itest.demo','ACTIVE','ENTERPRISE') ON CONFLICT (id) DO NOTHING",
                TENANT_B.toString());
            jdbc.update("INSERT INTO platform.tenant_modules (id, tenant_id, module_key, status, requested_at, activated_at) " +
                "VALUES (gen_random_uuid(), ?::uuid, 'hrms', 'ACTIVE', now(), now()) ON CONFLICT (tenant_id, module_key) DO UPDATE SET status='ACTIVE'",
                TENANT_B.toString());
        });
    }

    // ── Test 1 ───────────────────────────────────────────────────────────────

    @Test @Order(1)
    void test1_superAdminUpdatesSettings() {
        int status = call(HttpMethod.PUT, "/v1/payroll/settings", token("admin@unifiedtree.demo"),
            Map.of("pfEnabled", true, "esiEnabled", false, "ptEnabled", true, "ptStateCode", "KA"));
        assertThat(status).isEqualTo(200);

        withTenantJdbc(TENANT_A, () -> {
            Map<String, Object> r = jdbc.queryForMap(
                "SELECT pf_enabled, esi_enabled, pt_state_code FROM payroll.settings WHERE tenant_id = ?::uuid",
                TENANT_A.toString());
            assertThat(r.get("pf_enabled")).isEqualTo(true);
            assertThat(r.get("esi_enabled")).isEqualTo(false);
            assertThat(r.get("pt_state_code")).isEqualTo("KA");
        });
    }

    // ── Test 2 ───────────────────────────────────────────────────────────────

    @Test @Order(2)
    void test2_employeeCannotUpdateSettings() {
        int status = call(HttpMethod.PUT, "/v1/payroll/settings", token("reader@unifiedtree.demo"),
            Map.of("pfEnabled", false));
        assertThat(status).isEqualTo(403);
    }

    // ── Test 3 ───────────────────────────────────────────────────────────────

    @Test @Order(3)
    void test3_seedDefaultsCreates9() {
        String t = token("admin@unifiedtree.demo");
        assertThat(call(HttpMethod.POST, "/v1/payroll/components/seed-defaults", t, null)).isEqualTo(200);
        call(HttpMethod.POST, "/v1/payroll/components/seed-defaults", t, null); // idempotent second call

        withTenantJdbc(TENANT_A, () -> {
            Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.salary_components WHERE tenant_id = ?::uuid", Integer.class, TENANT_A.toString());
            assertThat(n).isEqualTo(9);
        });
    }

    // ── Test 4 ───────────────────────────────────────────────────────────────

    @Test @Order(4)
    void test4_componentsAreTenantIsolated() {
        call(HttpMethod.POST, "/v1/payroll/components/seed-defaults", token("admin@unifiedtree.demo"), null);
        seedTenantB();
        withTenantJdbc(TENANT_B, () -> {
            Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.salary_components WHERE tenant_id = ?::uuid", Integer.class, TENANT_B.toString());
            assertThat(n).isZero();
        });
    }

    // ── Test 5 ───────────────────────────────────────────────────────────────

    @Test @Order(5)
    void test5_createStructureSwapsCurrent() {
        String t = token("fin@unifiedtree.demo");
        assertThat(call(HttpMethod.POST, "/v1/payroll/structures", t, Map.of(
            "employeeId", READER_EMP.toString(), "ctcAnnual", 1200000, "effectiveFrom", "2026-04-01", "pfApplicable", false)))
            .isEqualTo(200);
        assertThat(call(HttpMethod.POST, "/v1/payroll/structures", t, Map.of(
            "employeeId", READER_EMP.toString(), "ctcAnnual", 1500000, "effectiveFrom", "2026-07-01", "pfApplicable", false)))
            .isEqualTo(200);

        withTenantJdbc(TENANT_A, () -> {
            Integer current = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.employee_salary_structures WHERE employee_id = ?::uuid AND is_current IS TRUE",
                Integer.class, READER_EMP.toString());
            assertThat(current).isEqualTo(1);
            Boolean pf = jdbc.queryForObject(
                "SELECT pf_applicable FROM payroll.employee_salary_structures WHERE employee_id = ?::uuid AND is_current IS TRUE",
                Boolean.class, READER_EMP.toString());
            assertThat(pf).isFalse();
            Integer total = jdbc.queryForObject(
                "SELECT count(*) FROM payroll.employee_salary_structures WHERE employee_id = ?::uuid",
                Integer.class, READER_EMP.toString());
            assertThat(total).isEqualTo(2);
        });
    }

    // ── Test 6 ───────────────────────────────────────────────────────────────

    @Test @Order(6)
    void test6_employeeGetsOwnStructure() {
        Map<?, ?> body = http().get().uri("/v1/payroll/structures/me")
            .header("Authorization", "Bearer " + token("reader@unifiedtree.demo"))
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class).getBody();
        assertThat(body).isNotNull();
        assertThat(body.get("employeeId")).isEqualTo(READER_EMP.toString());
    }

    // ── Test 7 ───────────────────────────────────────────────────────────────

    @Test @Order(7)
    void test7_employeeCannotGetOthersStructure() {
        int status = http().get().uri("/v1/payroll/structures/employee/" + OTHER_EMP)
            .header("Authorization", "Bearer " + token("reader@unifiedtree.demo"))
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity().getStatusCode().value();
        assertThat(status).isEqualTo(403);
    }

    // ── Test 8 ───────────────────────────────────────────────────────────────

    @Test @Order(8)
    void test8_ptSlabs() {
        String t = token("reader@unifiedtree.demo");
        List<?> ka = http().get().uri("/v1/payroll/pt-slabs/KA")
            .header("Authorization", "Bearer " + t).header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().body(List.class);
        assertThat(ka).hasSize(2);

        List<?> xx = http().get().uri("/v1/payroll/pt-slabs/XX")
            .header("Authorization", "Bearer " + t).header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().body(List.class);
        assertThat(xx).isEmpty();
    }
}
