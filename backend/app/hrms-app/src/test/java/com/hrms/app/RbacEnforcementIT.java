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
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves that {@code @PreAuthorize} annotations are enforced end-to-end under
 * production JWT security ({@code canonical-prod} profile, {@code @EnableMethodSecurity}
 * active).
 *
 * <p>Dev-seed users are loaded so we have concrete login credentials:
 * <ul>
 *   <li>{@code admin@unifiedtree.demo} → SUPER_ADMIN (all permissions)</li>
 *   <li>{@code reader@unifiedtree.demo} → EMPLOYEE (limited permissions)</li>
 * </ul>
 *
 * <p>Gates proved:
 * <ol>
 *   <li>No JWT → 401 on any authenticated endpoint.</li>
 *   <li>Reader JWT → 403 on a {@code hasAnyRole} gate (HR-only list endpoint).</li>
 *   <li>Admin JWT → 200 on that same endpoint.</li>
 *   <li>Reader JWT → 403 on a {@code @perm.check} gate (DB-side permission lookup).</li>
 *   <li>Admin JWT → 200 on that same endpoint.</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        // Include dev-seed so admin / reader demo users exist in the test DB.
        // In prod, canonical-prod restricts Flyway to db/canonical only.
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
class RbacEnforcementIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_rbac_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    // Pre-creates hrms_app (non-superuser LOGIN role) before Spring context starts.
                    .withInitScript("sql/test-init.sql")
                    .withReuse(false);

    @BeforeAll static void startContainer() { POSTGRES.start(); }
    @AfterAll  static void stopContainer()  { POSTGRES.stop();  }

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
                .uri("/v1/employees/company/" + UUID.randomUUID())
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("request without JWT → 401 Unauthorized")
            .isEqualTo(401);
    }

    // ── 2. Reader JWT blocked by hasAnyRole gate ─────────────────────────────
    @Test
    @Order(2)
    void readerJwtBlockedByRoleGate() {
        // GET /v1/employees/company/{id} requires hasAnyRole(HR_MANAGER, COMPANY_ADMIN, SUPER_ADMIN)
        // reader has EMPLOYEE role only → 403
        String readerJwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        HttpClientErrorException ex = expectError(() ->
            http().get()
                .uri("/v1/employees/company/" + UUID.randomUUID())
                .header("Authorization", "Bearer " + readerJwt)
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("reader (EMPLOYEE role) blocked from HR-only list → 403")
            .isEqualTo(403);
    }

    // ── 3. Admin JWT passes hasAnyRole gate ──────────────────────────────────
    @Test
    @Order(3)
    void adminJwtPassesRoleGate() {
        String adminJwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        // SUPER_ADMIN → passes hasAnyRole gate → returns empty page (random company UUID)
        java.util.Map<?, ?> result = http().get()
            .uri("/v1/employees/company/" + UUID.randomUUID())
            .header("Authorization", "Bearer " + adminJwt)
            .retrieve()
            .body(java.util.Map.class);
        assertThat(result)
            .as("admin (SUPER_ADMIN) passes hasAnyRole gate → 200 with empty page")
            .isNotNull();
    }

    // ── 4. Reader JWT blocked by @perm.check (DB-side lookup) ───────────────
    @Test
    @Order(4)
    void readerJwtBlockedByPermCheck() {
        // GET /v1/employees/{id}/profile/addresses requires @perm.check('hrms.employee.profile.read')
        // EMPLOYEE role does NOT have hrms.employee.profile.read in rbac.role_permissions →
        // PermissionChecker queries DB → permission absent → false → 403
        String readerJwt = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        HttpClientErrorException ex = expectError(() ->
            http().get()
                .uri("/v1/employees/" + UUID.randomUUID() + "/profile/addresses")
                .header("Authorization", "Bearer " + readerJwt)
                .retrieve()
                .body(Object.class));
        assertThat(ex.getStatusCode().value())
            .as("reader blocked by @perm.check('hrms.employee.profile.read') → 403")
            .isEqualTo(403);
    }

    // ── 5. Admin JWT passes @perm.check ─────────────────────────────────────
    @Test
    @Order(5)
    void adminJwtPassesPermCheck() {
        // SUPER_ADMIN has hrms.employee.profile.read in DB (seeded by V023) →
        // PermissionChecker returns true → 200 (empty list for unknown UUID)
        String adminJwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        List<?> result = http().get()
            .uri("/v1/employees/" + UUID.randomUUID() + "/profile/addresses")
            .header("Authorization", "Bearer " + adminJwt)
            .retrieve()
            .body(List.class);
        assertThat(result)
            .as("admin passes @perm.check('hrms.employee.profile.read') → 200 empty list")
            .isNotNull();
    }
}
