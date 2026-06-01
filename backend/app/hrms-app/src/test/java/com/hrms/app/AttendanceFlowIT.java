package com.hrms.app;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.HttpClientErrorException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Attendance flow integration tests — proves the canonical attendance surface
 * is live and permission-gated correctly.
 *
 * <p>5 tests:
 * <ol>
 *   <li>No JWT → 401 on any attendance endpoint.</li>
 *   <li>EMPLOYEE JWT → 2xx on GET /today (204 when no record, auth gate open).</li>
 *   <li>EMPLOYEE JWT → 200 on GET /history (empty list, auth gate open).</li>
 *   <li>EMPLOYEE JWT → 403 on GET /dashboard (needs attendance.team.read).</li>
 *   <li>SUPER_ADMIN JWT → 200 on GET /dashboard (has attendance.team.read).</li>
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
class AttendanceFlowIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_attendance_it")
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
                .uri("/v1/attendance/today")
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("request without JWT → 401 Unauthorized")
            .isEqualTo(401);
    }

    // ── 2. EMPLOYEE can read today's record (2xx; 204 when no punch exists) ──
    @Test
    @Order(2)
    void employeeCanGetTodayRecord() {
        String jwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        ResponseEntity<Void> response = http().get()
            .uri("/v1/attendance/today")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .toBodilessEntity();
        assertThat(response.getStatusCode().is2xxSuccessful())
            .as("EMPLOYEE with attendance.checkin.self → 2xx on /today")
            .isTrue();
    }

    // ── 3. EMPLOYEE can read attendance history (200, empty list) ─────────────
    @Test
    @Order(3)
    void employeeCanGetHistory() {
        String jwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        Object result = http().get()
            .uri("/v1/attendance/history")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(Object.class);
        assertThat(result)
            .as("EMPLOYEE can read own attendance history → 200")
            .isNotNull();
    }

    // ── 4. EMPLOYEE blocked from team dashboard (403) ─────────────────────────
    @Test
    @Order(4)
    void employeeBlockedFromDashboard() {
        String jwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        HttpClientErrorException ex = expectError(() ->
            http().get()
                .uri("/v1/attendance/dashboard")
                .header("Authorization", "Bearer " + jwt)
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("EMPLOYEE (no attendance.team.read) blocked from dashboard → 403")
            .isEqualTo(403);
    }

    // ── 5. SUPER_ADMIN can read team dashboard (200) ──────────────────────────
    @Test
    @Order(5)
    void adminCanReadDashboard() {
        String jwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        Object result = http().get()
            .uri("/v1/attendance/dashboard")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(Object.class);
        assertThat(result)
            .as("SUPER_ADMIN (has attendance.team.read) can read dashboard → 200")
            .isNotNull();
    }
}
