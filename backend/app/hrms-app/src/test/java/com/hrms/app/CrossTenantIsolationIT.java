package com.hrms.app;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves Row-Level Security blocks cross-tenant access at every layer.
 *
 * <p>Uses the {@code canonical} (smoke) profile with {@code @EnableMethodSecurity}
 * active. HTTP tests mint JWTs directly via {@link com.unifiedtree.auth.service.JwtService}
 * (no credentials required) to satisfy {@code @PreAuthorize} role gates while
 * proving RLS isolation through separate per-tenant JWT {@code tenant_id} claims.
 *
 * <p>Gates proved:
 * <ol>
 *   <li>JDBC: tenant B sees 0 rows of data inserted by tenant A.</li>
 *   <li>JDBC: no tenant context → fail-closed (0 rows returned).</li>
 *   <li>JDBC: WITH CHECK blocks inserting a row with mismatched {@code tenant_id}.</li>
 *   <li>HTTP: tenant B GET employee list returns 0 results.</li>
 *   <li>HTTP: tenant B GET employee by UUID returns 404.</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("canonical")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class CrossTenantIsolationIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_rls_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    // Creates hrms_app (non-superuser) before Spring context starts
                    // so HikariCP can connect as it on first pool validation.
                    .withInitScript("sql/test-init.sql")
                    .withReuse(false);

    @BeforeAll static void startContainer() { POSTGRES.start(); }
    @AfterAll  static void stopContainer()  { POSTGRES.stop();  }

    @DynamicPropertySource
    static void dataSourceProps(DynamicPropertyRegistry r) {
        // App connections use hrms_app (non-superuser) so FORCE ROW LEVEL SECURITY
        // policies actually apply. Superusers bypass RLS even with FORCE RLS.
        r.add("spring.datasource.url",      POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", () -> "hrms_app");
        r.add("spring.datasource.password", () -> "hrms_app_test");
        r.add("spring.datasource.hikari.maximum-pool-size", () -> "5");
        r.add("spring.datasource.hikari.minimum-idle",      () -> "1");
        // Flyway must run DDL as superuser. spring.flyway.url triggers a separate
        // (non-pooled) DataSource for Flyway so it isn't subject to the hrms_app credentials.
        r.add("spring.flyway.url",      POSTGRES::getJdbcUrl);
        r.add("spring.flyway.user",     POSTGRES::getUsername);
        r.add("spring.flyway.password", POSTGRES::getPassword);
    }

    private static final UUID PROBE_COMPANY_ID = UUID.randomUUID();
    private static UUID   createdEmployeeId;
    private static String jwtA;   // SUPER_ADMIN JWT scoped to TENANT_A
    private static String jwtB;   // SUPER_ADMIN JWT scoped to TENANT_B

    // ── 1. JDBC: tenant B cannot see tenant A rows ───────────────────────────
    @Test
    @Order(1)
    void jdbcTenantBCannotSeeTenantARows() {
        withTenantJdbc(TENANT_A, () ->
            jdbc.update(
                "INSERT INTO hrms.classification_rules " +
                "(id, tenant_id, company_id, name, code, is_active, created_at, updated_at, version) " +
                "VALUES (gen_random_uuid(), ?, ?, 'RLS_PROBE_A', 'RPA1', TRUE, now(), now(), 0)",
                TENANT_A, PROBE_COMPANY_ID));

        int[] countB = {-1};
        withTenantJdbc(TENANT_B, () ->
            countB[0] = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.classification_rules WHERE name = 'RLS_PROBE_A'",
                Integer.class));
        assertThat(countB[0]).as("RLS: tenant B sees 0 rows inserted by tenant A").isEqualTo(0);

        int[] countA = {-1};
        withTenantJdbc(TENANT_A, () ->
            countA[0] = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.classification_rules WHERE name = 'RLS_PROBE_A'",
                Integer.class));
        assertThat(countA[0]).as("RLS: tenant A sees its own row").isEqualTo(1);
    }

    // ── 2. JDBC: no tenant context → 0 rows (fail-closed) ───────────────────
    @Test
    @Order(2)
    void jdbcNoTenantContextReturnsZeroRows() {
        jdbc.execute("BEGIN");
        try {
            // Drop superuser: hrms_app is non-superuser so FORCE RLS applies.
            // Deliberately omit SET LOCAL app.tenant_id
            // → current_tenant_id() returns NULL → RLS hides all rows
            jdbc.execute("SET LOCAL ROLE hrms_app");
            Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.classification_rules WHERE name = 'RLS_PROBE_A'",
                Integer.class);
            jdbc.execute("COMMIT");
            assertThat(count).as("RLS fail-closed: no tenant context returns 0 rows").isEqualTo(0);
        } catch (RuntimeException e) {
            try { jdbc.execute("ROLLBACK"); } catch (Exception ignored) { }
            throw e;
        }
    }

    // ── 3. JDBC: WITH CHECK blocks mismatched tenant_id ─────────────────────
    @Test
    @Order(3)
    void jdbcWithCheckBlocksMismatchedTenantIdOnInsert() {
        // Session context = TENANT_A, but row declares tenant_id = TENANT_B.
        // RLS WITH CHECK: NEW.tenant_id = current_tenant_id() → TENANT_B ≠ TENANT_A → violation.
        jdbc.execute("BEGIN");
        try {
            jdbc.execute("SET LOCAL ROLE hrms_app");
            jdbc.execute("SET LOCAL app.tenant_id = '" + TENANT_A + "'");
            assertThatThrownBy(() ->
                jdbc.update(
                    "INSERT INTO hrms.classification_rules " +
                    "(id, tenant_id, company_id, name, code, is_active, created_at, updated_at, version) " +
                    "VALUES (gen_random_uuid(), '" + TENANT_B + "', '" + PROBE_COMPANY_ID + "', " +
                    "'WITH_CHECK_PROBE', 'WCP1', TRUE, now(), now(), 0)")
            ).as("WITH CHECK: inserting a row with wrong tenant_id must fail")
             .isInstanceOf(org.springframework.dao.DataAccessException.class);
        } finally {
            try { jdbc.execute("ROLLBACK"); } catch (Exception ignored) { }
        }
    }

    // ── 4. HTTP: tenant B GET list sees 0 employees created by tenant A ─────
    //
    // JWTs carry the tenant_id claim; TenantContextFilter prefers the JWT claim
    // over the X-Tenant-ID header. Separate JWTs are minted here (no DB users
    // needed) so @PreAuthorize role gates pass while RLS isolation is still proven.
    @Test
    @Order(4)
    void httpTenantBSeesEmptyEmployeeList() {
        TenantContext.clear();

        // Mint JWTs for both tenants. These are stored as static fields so test 5
        // can reuse them without re-minting.
        jwtA = jwtService.issueAccessToken(
            UUID.randomUUID(), TENANT_A, "rls-admin-a@test.local",
            List.of("SUPER_ADMIN"),
            List.of("org.company.write", "hrms.employee.write")
        ).token();
        jwtB = jwtService.issueAccessToken(
            UUID.randomUUID(), TENANT_B, "rls-admin-b@test.local",
            List.of("SUPER_ADMIN"),
            List.of()
        ).token();

        RestClient http = http();

        Map<String, Object> coReq = Map.of("name", "RLS-Test-Corp", "industry", "Technology");
        Map<?, ?> company = http.post()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + jwtA)
            .contentType(MediaType.APPLICATION_JSON)
            .body(coReq)
            .retrieve()
            .body(Map.class);
        UUID companyId = UUID.fromString((String) company.get("id"));

        Map<String, Object> empReq = new HashMap<>();
        empReq.put("companyId", companyId.toString());
        empReq.put("firstName", "RLS-Test");
        empReq.put("lastName", "Employee");
        empReq.put("email", "rls.isolation@example.com");
        empReq.put("employmentType", "FULL_TIME");
        empReq.put("dateOfJoining", "2026-01-01");
        Map<?, ?> emp = http.post()
            .uri("/v1/hrms/employees")
            .header("Authorization", "Bearer " + jwtA)
            .contentType(MediaType.APPLICATION_JSON)
            .body(empReq)
            .retrieve()
            .body(Map.class);
        createdEmployeeId = UUID.fromString((String) emp.get("id"));

        // TENANT_A JWT: RLS scope = TENANT_A → sees its own employee
        Map<?, ?> dirA = http.get()
            .uri("/v1/hrms/employees?companyId=" + companyId)
            .header("Authorization", "Bearer " + jwtA)
            .retrieve()
            .body(Map.class);
        assertThat(((Number) dirA.get("totalElements")).intValue())
            .as("Tenant A sees its own employee").isGreaterThanOrEqualTo(1);

        // TENANT_B JWT: RLS scope = TENANT_B → sees 0 employees (different tenant)
        Map<?, ?> dirB = http.get()
            .uri("/v1/hrms/employees?companyId=" + companyId)
            .header("Authorization", "Bearer " + jwtB)
            .retrieve()
            .body(Map.class);
        assertThat(((Number) dirB.get("totalElements")).intValue())
            .as("RLS: tenant B cannot see tenant A's employees").isEqualTo(0);
    }

    // ── 5. HTTP: GET employee by UUID returns 404 for wrong tenant ───────────
    @Test
    @Order(5)
    void httpGetEmployeeByIdReturns404ForWrongTenant() {
        Assumptions.assumeTrue(createdEmployeeId != null,
            "requires test 4 to have created a test employee");
        RestClient http = http();

        // TENANT_A JWT: owner can retrieve the employee
        Map<?, ?> found = http.get()
            .uri("/v1/hrms/employees/" + createdEmployeeId)
            .header("Authorization", "Bearer " + jwtA)
            .retrieve()
            .body(Map.class);
        assertThat(found.get("id")).isEqualTo(createdEmployeeId.toString());

        // TENANT_B JWT: RLS hides the row → service throws ResourceNotFoundException → 404
        HttpClientErrorException ex = expectError(() ->
            http.get()
                .uri("/v1/hrms/employees/" + createdEmployeeId)
                .header("Authorization", "Bearer " + jwtB)
                .retrieve()
                .body(Map.class));
        assertThat(ex.getStatusCode().value())
            .as("RLS: tenant B cannot fetch tenant A's employee by ID → 404")
            .isEqualTo(404);
    }
}
