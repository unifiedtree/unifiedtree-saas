package com.hrms.test;

import com.hrms.app.AbstractIntegrationTest;
import com.hrms.app.HrmsApplication;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Reproduction test for the production 500s on the payroll dashboard GET list
 * endpoints (/v1/payroll/settings, /components, /runs). Critically, this calls
 * them the way the browser does under canonical-prod: Authorization Bearer ONLY,
 * with NO X-Tenant-ID header (canonical-prod refuses the header, so the tenant
 * must come from the JWT's tenant_id claim).
 *
 * If these pass, the payroll READ code is sound for a valid login JWT and the
 * production 500s are environmental (prod tokens missing the tenant_id claim, or
 * DB migration drift) — not a code defect in these handlers.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
                classes = HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        "unifiedtree.face.encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        "unifiedtree.face.enabled=false",
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class PayrollListIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_payrolllist_it")
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

    private String adminToken() {
        return (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
    }

    /** Bearer ONLY — no X-Tenant-ID header (matches the canonical-prod browser flow). */
    private ResponseEntity<String> getJwtOnly(String uri) {
        return http().get().uri(uri)
                .header("Authorization", "Bearer " + adminToken())
                .retrieve().onStatus(s -> true, (rq, rs) -> {})
                .toEntity(String.class);
    }

    private void putJwtOnly(String uri, Object body) {
        http().put().uri(uri)
                .header("Authorization", "Bearer " + adminToken())
                .header("Content-Type", "application/json")
                .body(body)
                .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity();
    }

    private void postJwtOnly(String uri) {
        http().post().uri(uri)
                .header("Authorization", "Bearer " + adminToken())
                .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity();
    }

    // ── 1. GET /v1/payroll/settings (after a settings row exists) ───────────
    @Test @Order(1)
    void getSettings_returns200() {
        putJwtOnly("/v1/payroll/settings",
                Map.of("pfEnabled", true, "esiEnabled", false, "ptEnabled", true, "ptStateCode", "KA"));
        ResponseEntity<String> resp = getJwtOnly("/v1/payroll/settings");
        assertThat(resp.getStatusCode().value())
                .as("GET /v1/payroll/settings (JWT-only) → 200, body: %s", resp.getBody())
                .isEqualTo(200);
    }

    // ── 2. GET /v1/payroll/components (after seeding 9 defaults) ────────────
    @Test @Order(2)
    void getComponents_returns200() {
        postJwtOnly("/v1/payroll/components/seed-defaults");
        ResponseEntity<String> resp = getJwtOnly("/v1/payroll/components");
        assertThat(resp.getStatusCode().value())
                .as("GET /v1/payroll/components (JWT-only) → 200, body: %s", resp.getBody())
                .isEqualTo(200);
    }

    // ── 3. GET /v1/payroll/runs (list, possibly empty) ──────────────────────
    @Test @Order(3)
    void getRuns_returns200() {
        ResponseEntity<String> resp = getJwtOnly("/v1/payroll/runs");
        assertThat(resp.getStatusCode().value())
                .as("GET /v1/payroll/runs (JWT-only) → 200, body: %s", resp.getBody())
                .isEqualTo(200);
    }
}
