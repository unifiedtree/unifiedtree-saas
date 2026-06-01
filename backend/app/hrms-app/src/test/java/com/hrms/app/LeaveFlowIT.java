package com.hrms.app;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.HttpClientErrorException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Leave flow integration tests — proves the canonical leave surface is live
 * and permission-gated correctly.
 *
 * <p>5 tests:
 * <ol>
 *   <li>No JWT → 401 on any leave endpoint.</li>
 *   <li>EMPLOYEE JWT → 200 on GET /my (empty page; has leave.balance.read).</li>
 *   <li>EMPLOYEE JWT → 200 on GET /my/balances (empty list; has leave.balance.read).</li>
 *   <li>EMPLOYEE JWT → 403 on GET /approvals/pending (needs hrms.leave.approve.l1).</li>
 *   <li>SUPER_ADMIN JWT → 200 on GET /approvals/pending (has hrms.leave.approve.l1).</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class LeaveFlowIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_leave_it")
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

    // ── 1. No JWT → 401 ──────────────────────────────────────────────────────
    @Test
    @Order(1)
    void noJwtReturns401() {
        HttpClientErrorException ex = expectError(() ->
            http().get()
                .uri("/v1/leave/my")
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("request without JWT → 401 Unauthorized")
            .isEqualTo(401);
    }

    // ── 2. EMPLOYEE can list own leave requests (200, empty page) ─────────────
    @Test
    @Order(2)
    void employeeCanGetMyLeaves() {
        String jwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        Object result = http().get()
            .uri("/v1/leave/my")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(Object.class);
        assertThat(result)
            .as("EMPLOYEE can list own leave requests → 200")
            .isNotNull();
    }

    // ── 3. EMPLOYEE can read own leave balances (200, empty list) ─────────────
    @Test
    @Order(3)
    void employeeCanGetBalances() {
        String jwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        Object result = http().get()
            .uri("/v1/leave/my/balances")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(Object.class);
        assertThat(result)
            .as("EMPLOYEE can read own leave balances → 200")
            .isNotNull();
    }

    // ── 4. EMPLOYEE blocked from L1 approvals list (403) ─────────────────────
    @Test
    @Order(4)
    void employeeBlockedFromApprovals() {
        String jwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        HttpClientErrorException ex = expectError(() ->
            http().get()
                .uri("/v1/leave/approvals/pending")
                .header("Authorization", "Bearer " + jwt)
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("EMPLOYEE (no hrms.leave.approve.l1) blocked from approvals → 403")
            .isEqualTo(403);
    }

    // ── 5. SUPER_ADMIN can read L1 pending approvals (200, empty page) ────────
    @Test
    @Order(5)
    void adminCanReadPendingApprovals() {
        String jwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        Object result = http().get()
            .uri("/v1/leave/approvals/pending")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(Object.class);
        assertThat(result)
            .as("SUPER_ADMIN (has hrms.leave.approve.l1) can read pending approvals → 200")
            .isNotNull();
    }
}
