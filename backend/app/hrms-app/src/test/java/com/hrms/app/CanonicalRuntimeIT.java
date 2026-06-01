package com.hrms.app;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Runtime guarantees of the canonical architecture, end-to-end against a
 * Testcontainers Postgres 16 instance.
 *
 * <p>This single test class is the parity gate for the canonical backend:
 * <ol>
 *   <li>Flyway applies V001..V0xx cleanly on a brand-new Postgres database.</li>
 *   <li>Hibernate {@code ddl-auto=validate} passes once Flyway is done.</li>
 *   <li>Row-Level Security isolates tenant A from tenant B at the DB level.</li>
 *   <li>The HRMS workforce REST surface (company -&gt; branch -&gt; department
 *       -&gt; designation -&gt; employee) round-trips and respects tenant
 *       scope.</li>
 * </ol>
 *
 * <p>Spring profile {@code canonical} is active for this test. The canonical
 * security config is the smoke-test one (X-Tenant-ID header, no auth) which
 * is fine because the container is bound to a random local port.
 *
 * <p>Container lifecycle is managed manually (no {@code @Testcontainers}
 * annotation) so we don't need the {@code testcontainers:junit-jupiter}
 * artifact -- the local Maven mirror was unable to fetch it.
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
class CanonicalRuntimeIT {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_canonical_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    .withReuse(false);

    @BeforeAll
    static void startContainer() {
        POSTGRES.start();
    }

    @AfterAll
    static void stopContainer() {
        POSTGRES.stop();
    }

    @DynamicPropertySource
    static void dataSourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",      POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.hikari.maximum-pool-size", () -> "5");
        r.add("spring.datasource.hikari.minimum-idle",      () -> "1");
    }

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    private static final UUID TENANT_A = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID TENANT_B = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    // -- 1. Flyway --------------------------------------------------------------
    @Test
    @Order(1)
    void flywayAppliedAllCanonicalMigrations() {
        Integer applied = jdbc.queryForObject(
            "SELECT COUNT(*) FROM public.flyway_schema_history_canonical WHERE success = TRUE",
            Integer.class);
        // V0 baseline + V001..V014 = 15 rows; bump this floor when migrations grow
        assertThat(applied)
            .as("Flyway-applied migration count")
            .isGreaterThanOrEqualTo(15);
    }

    // -- 2. All 9 canonical schemas exist --------------------------------------
    @Test
    @Order(2)
    void canonicalSchemasExist() {
        List<String> expected = List.of(
            "platform","auth","rbac","org","hrms","attendance","leave_mgmt","settings","audit");
        for (String s : expected) {
            Integer present = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = ?",
                Integer.class, s);
            assertThat(present).as("schema present: " + s).isEqualTo(1);
        }
    }

    // -- 3. RLS isolation -------------------------------------------------------
    @Test
    @Order(3)
    void rlsIsolatesTenantsAtTheDatabase() {
        UUID companyId = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");

        jdbc.execute("BEGIN");
        try {
            jdbc.execute("SET LOCAL app.tenant_id = '" + TENANT_A + "'");
            jdbc.update(
                "INSERT INTO hrms.classification_rules " +
                "(id, tenant_id, company_id, name, code, is_active, created_at, updated_at, version) " +
                "VALUES (gen_random_uuid(), '" + TENANT_A + "', '" + companyId + "', " +
                "'IT_A','A1', TRUE, now(), now(), 0)");
            jdbc.execute("COMMIT");
        } catch (RuntimeException e) {
            jdbc.execute("ROLLBACK");
            throw e;
        }

        jdbc.execute("BEGIN");
        try {
            jdbc.execute("SET LOCAL app.tenant_id = '" + TENANT_B + "'");
            jdbc.update(
                "INSERT INTO hrms.classification_rules " +
                "(id, tenant_id, company_id, name, code, is_active, created_at, updated_at, version) " +
                "VALUES (gen_random_uuid(), '" + TENANT_B + "', '" + companyId + "', " +
                "'IT_B','B1', TRUE, now(), now(), 0)");
            jdbc.execute("COMMIT");
        } catch (RuntimeException e) {
            jdbc.execute("ROLLBACK");
            throw e;
        }

        // Tenant A sees only A
        Integer fromA = countWithTenant(TENANT_A);
        assertThat(fromA).as("RLS - tenant A sees only A").isEqualTo(1);

        // Tenant B sees only B
        Integer fromB = countWithTenant(TENANT_B);
        assertThat(fromB).as("RLS - tenant B sees only B").isEqualTo(1);

        // No tenant -> 0 rows (fail-closed)
        Integer fromNone = countWithoutTenant();
        assertThat(fromNone)
            .as("RLS - no tenant context returns 0 rows (fail-closed)")
            .isEqualTo(0);
    }

    private Integer countWithTenant(UUID tenant) {
        jdbc.execute("BEGIN");
        try {
            jdbc.execute("SET LOCAL app.tenant_id = '" + tenant + "'");
            Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.classification_rules WHERE name LIKE 'IT_%'",
                Integer.class);
            jdbc.execute("COMMIT");
            return n;
        } catch (RuntimeException e) {
            jdbc.execute("ROLLBACK");
            throw e;
        }
    }

    private Integer countWithoutTenant() {
        jdbc.execute("BEGIN");
        try {
            // no SET LOCAL app.tenant_id -> current_tenant_id() returns NULL -> RLS hides everything
            Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.classification_rules WHERE name LIKE 'IT_%'",
                Integer.class);
            jdbc.execute("COMMIT");
            return n;
        } catch (RuntimeException e) {
            jdbc.execute("ROLLBACK");
            throw e;
        }
    }

    // -- 4. HRMS REST smoke (company -> branch -> dept -> designation -> employee) ---
    @Test
    @Order(4)
    void hrmsRestSurfaceRoundTripsAndIsolatesByTenant() {
        TenantContext.clear();

        RestClient http = RestClient.builder()
            .baseUrl("http://localhost:" + port + "/api")
            .build();

        // Create company under tenant A
        Map<String, Object> companyReq = new HashMap<>();
        companyReq.put("name", "IT Demo Corp");
        companyReq.put("industry", "Technology");
        Map<?, ?> company = http.post()
            .uri("/v1/hrms/companies")
            .header("X-Tenant-ID", TENANT_A.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(companyReq)
            .retrieve()
            .body(Map.class);
        assertThat(company).isNotNull();
        assertThat(company.get("name")).isEqualTo("IT Demo Corp");
        UUID companyId = UUID.fromString((String) company.get("id"));

        // Branch
        Map<String, Object> branchReq = new HashMap<>();
        branchReq.put("companyId", companyId.toString());
        branchReq.put("name", "Bangalore HQ");
        branchReq.put("code", "BLR");
        branchReq.put("city", "Bangalore");
        branchReq.put("latitude", 12.9716);
        branchReq.put("longitude", 77.5946);
        branchReq.put("geoFenceRadiusMeters", 500);
        branchReq.put("isHeadquarters", true);
        Map<?, ?> branch = http.post()
            .uri("/v1/hrms/branches")
            .header("X-Tenant-ID", TENANT_A.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(branchReq)
            .retrieve()
            .body(Map.class);
        UUID branchId = UUID.fromString((String) branch.get("id"));

        // Department
        Map<String, Object> deptReq = new HashMap<>();
        deptReq.put("companyId", companyId.toString());
        deptReq.put("name", "Engineering");
        deptReq.put("code", "ENG");
        Map<?, ?> dept = http.post()
            .uri("/v1/hrms/departments")
            .header("X-Tenant-ID", TENANT_A.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(deptReq)
            .retrieve()
            .body(Map.class);
        UUID deptId = UUID.fromString((String) dept.get("id"));

        // Designation
        Map<String, Object> desReq = new HashMap<>();
        desReq.put("companyId", companyId.toString());
        desReq.put("title", "Senior Engineer");
        desReq.put("grade", "L3");
        desReq.put("departmentId", deptId.toString());
        Map<?, ?> des = http.post()
            .uri("/v1/hrms/designations")
            .header("X-Tenant-ID", TENANT_A.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(desReq)
            .retrieve()
            .body(Map.class);
        UUID desId = UUID.fromString((String) des.get("id"));

        // Employee
        Map<String, Object> empReq = new HashMap<>();
        empReq.put("companyId", companyId.toString());
        empReq.put("firstName", "Priya");
        empReq.put("lastName", "Sharma");
        empReq.put("email", "priya.it@demo");
        empReq.put("phone", "9999988888");
        empReq.put("gender", "FEMALE");
        empReq.put("departmentId", deptId.toString());
        empReq.put("designationId", desId.toString());
        empReq.put("branchId", branchId.toString());
        empReq.put("employmentType", "FULL_TIME");
        empReq.put("dateOfJoining", "2026-01-15");
        Map<?, ?> emp = http.post()
            .uri("/v1/hrms/employees")
            .header("X-Tenant-ID", TENANT_A.toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(empReq)
            .retrieve()
            .body(Map.class);
        assertThat(emp.get("firstName")).isEqualTo("Priya");
        assertThat(emp.get("employmentStatus")).isEqualTo("PROBATION");

        // GET as tenant A -> sees the employee
        Map<?, ?> dirA = http.get()
            .uri("/v1/hrms/employees?companyId=" + companyId)
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve()
            .body(Map.class);
        assertThat(((Number) dirA.get("totalElements")).intValue())
            .as("Tenant A sees own employee").isGreaterThanOrEqualTo(1);

        // GET as tenant B (cross-tenant) -> sees ZERO
        Map<?, ?> dirB = http.get()
            .uri("/v1/hrms/employees?companyId=" + companyId)
            .header("X-Tenant-ID", TENANT_B.toString())
            .retrieve()
            .body(Map.class);
        assertThat(((Number) dirB.get("totalElements")).intValue())
            .as("Tenant B cannot see tenant A's employees").isEqualTo(0);
    }
}
