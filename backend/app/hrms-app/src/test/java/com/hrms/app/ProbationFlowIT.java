package com.hrms.app;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Probation flow integration tests (Prompt 11) — 5 tests:
 *  1. scanForTenant fires exactly one UPCOMING reminder + sends mail.
 *  2. A second scan does NOT duplicate the reminder.
 *  3. Scanning only TENANT_A does not touch TENANT_B's data.
 *  4. EMPLOYEE -> PUT /v1/probation/config -> 403.
 *  5. HR_MANAGER -> GET /v1/probation/upcoming -> 200.
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
        "hrms.probation.reminder-days-before=7",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class ProbationFlowIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_probation_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    .withInitScript("sql/test-init.sql")
                    .withReuse(false);

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

    @MockBean  MailService mailService;
    @Autowired com.hrms.api.probation.ProbationService probationService;

    @BeforeEach
    void setupMailMock() { doNothing().when(mailService).send(any(EmailMessage.class)); }

    private static final UUID COMPANY_A   = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID MGR_A       = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID PROBATION_A = UUID.fromString("aaaa0001-0000-0000-0000-000000000001");
    private static final UUID COMPANY_B   = UUID.fromString("bbbb0000-0000-0000-0000-0000000000c1");
    private static final UUID PROBATION_B = UUID.fromString("bbbb0001-0000-0000-0000-000000000001");

    private void seedProbationEmployee(UUID tenantId, UUID empId, UUID companyId,
                                       String code, String email, UUID managerId, int daysFromToday) {
        withTenantJdbc(tenantId, () -> jdbc.update("""
            INSERT INTO hrms.employees
                (id, tenant_id, company_id, employee_code, first_name, last_name, email,
                 employment_type, employment_status, date_of_joining,
                 probation_end_date, reporting_manager_id,
                 created_at, updated_at, created_by, updated_by, version)
            VALUES
                (?::uuid, ?::uuid, ?::uuid, ?, 'Prob', 'Ation', ?,
                 'FULL_TIME', 'PROBATION', now()::date - interval '85 days',
                 now()::date + (? || ' days')::interval, ?::uuid,
                 now(), now(), 'it-seed', 'it-seed', 0)
            ON CONFLICT (id) DO UPDATE
                SET employment_status  = 'PROBATION',
                    probation_end_date = EXCLUDED.probation_end_date
            """,
            empId.toString(), tenantId.toString(), companyId.toString(), code, email,
            daysFromToday, managerId == null ? null : managerId.toString()));
    }

    private int reminderRows(UUID tenantId, UUID empId) {
        int[] n = new int[1];
        withTenantJdbc(tenantId, () ->
            n[0] = jdbc.queryForObject(
                "SELECT count(*) FROM hrms.probation_reminder_log WHERE employee_id = ?::uuid",
                Integer.class, empId.toString()));
        return n[0];
    }

    private void seedTenantB() {
        // tenant + module + company in ONE transaction so the tenant_modules and
        // company FKs to platform.tenants resolve in-transaction.
        withTenantJdbc(TENANT_B, () -> {
            jdbc.update("""
                INSERT INTO platform.tenants (id, subdomain, display_name, contact_email, status, plan_type)
                VALUES (?::uuid, 'tenantb-it', 'Tenant B IT', 'b@itest.demo', 'ACTIVE', 'ENTERPRISE')
                ON CONFLICT (id) DO NOTHING
                """, TENANT_B.toString());
            jdbc.update("""
                INSERT INTO platform.tenant_modules (id, tenant_id, module_key, status, requested_at, activated_at)
                VALUES (gen_random_uuid(), ?::uuid, 'hrms', 'ACTIVE', now(), now())
                ON CONFLICT (tenant_id, module_key) DO UPDATE SET status = 'ACTIVE'
                """, TENANT_B.toString());
            jdbc.update("""
                INSERT INTO org.companies
                    (id, tenant_id, name, is_active, created_at, updated_at, created_by, updated_by, version)
                VALUES (?::uuid, ?::uuid, 'Tenant B Corp', TRUE, now(), now(), 'it-seed', 'it-seed', 0)
                ON CONFLICT (id) DO NOTHING
                """, COMPANY_B.toString(), TENANT_B.toString());
        });
        seedProbationEmployee(TENANT_B, PROBATION_B, COMPANY_B, "BEMP001", "probb@itest.demo", null, 5);
    }

    // ── Test 1 ───────────────────────────────────────────────────────────────

    @Test @Order(1)
    void test1_scanFiresOneUpcomingReminder() {
        seedProbationEmployee(TENANT_A, PROBATION_A, COMPANY_A, "PEMP001", "prob@itest.demo", MGR_A, 5);

        int fired = probationService.scanForTenant(TENANT_A);

        assertThat(fired).isEqualTo(1);
        assertThat(reminderRows(TENANT_A, PROBATION_A)).isEqualTo(1);
        verify(mailService, atLeastOnce()).send(any(EmailMessage.class));
    }

    // ── Test 2 ───────────────────────────────────────────────────────────────

    @Test @Order(2)
    void test2_secondScanDoesNotDuplicate() {
        reset(mailService);
        doNothing().when(mailService).send(any(EmailMessage.class));

        int firedAgain = probationService.scanForTenant(TENANT_A);

        assertThat(firedAgain).isZero();
        assertThat(reminderRows(TENANT_A, PROBATION_A)).isEqualTo(1);
        verify(mailService, never()).send(any(EmailMessage.class));
    }

    // ── Test 3 ───────────────────────────────────────────────────────────────

    @Test @Order(3)
    void test3_crossTenantScanIsolated() {
        seedTenantB();
        reset(mailService);
        doNothing().when(mailService).send(any(EmailMessage.class));

        probationService.scanForTenant(TENANT_A); // scan ONLY tenant A

        assertThat(reminderRows(TENANT_A, PROBATION_A)).isEqualTo(1);
        assertThat(reminderRows(TENANT_B, PROBATION_B)).isZero();
    }

    // ── Test 4 ───────────────────────────────────────────────────────────────

    @Test @Order(4)
    void test4_employeeCannotUpdateProbationConfig() {
        String employeeToken =
            (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345").get("accessToken");

        int status = http().put().uri("/v1/probation/config")
            .header("Authorization", "Bearer " + employeeToken)
            .header("X-Tenant-ID", TENANT_A.toString())
            .header("Content-Type", "application/json")
            .body(Map.of("reminderDaysBefore", 14, "autoExtendEnabled", false, "autoExtendDays", 90))
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity()
            .getStatusCode().value();

        assertThat(status).isEqualTo(403);
    }

    // ── Test 5 ───────────────────────────────────────────────────────────────

    @Test @Order(5)
    void test5_hrManagerCanListUpcoming() {
        String hrToken =
            (String) login(TENANT_A, "hrm@unifiedtree.demo", "Hrms@12345").get("accessToken");

        int status = http().get().uri("/v1/probation/upcoming")
            .header("Authorization", "Bearer " + hrToken)
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity()
            .getStatusCode().value();

        assertThat(status).isEqualTo(200);
    }
}
