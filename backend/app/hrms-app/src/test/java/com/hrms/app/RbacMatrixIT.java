package com.hrms.app;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.HttpClientErrorException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Allow / deny RBAC matrix for the permission work delivered in the RBAC
 * completion task. Each behaviour is proved with an ALLOW (a role that holds
 * the permission → 2xx) and a DENY (a role that does not → 403), under the
 * production JWT security profile.
 *
 * <p>Seeded logins (all password {@code Hrms@12345}, tenant A):
 * <ul>
 *   <li>{@code admin@unifiedtree.demo} → SUPER_ADMIN</li>
 *   <li>{@code hrm@unifiedtree.demo}   → HR_MANAGER</li>
 *   <li>{@code fin@unifiedtree.demo}   → FINANCE_LEAD</li>
 *   <li>{@code reader@unifiedtree.demo}→ EMPLOYEE</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({"canonical", "canonical-prod"})
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
class RbacMatrixIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_rbac_matrix_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
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

    private String token(String email) {
        return (String) login(TENANT_A, email, "Hrms@12345").get("accessToken");
    }

    private int statusOfGet(String uri, String jwt) {
        HttpClientErrorException ex = expectError(() ->
            http().get().uri(uri).header("Authorization", "Bearer " + jwt).retrieve().body(Object.class));
        return ex.getStatusCode().value();
    }

    // ── Phase 4: GET /v1/rbac/users/{userId}/roles ───────────────────────────
    @Test
    void userRoles_allow_admin() {
        Map<?, ?> body = http().get()
            .uri("/v1/rbac/users/" + UUID.randomUUID() + "/roles")
            .header("Authorization", "Bearer " + token("admin@unifiedtree.demo"))
            .retrieve().body(Map.class);
        assertThat(body).as("SUPER_ADMIN can read user roles → 200").isNotNull();
    }

    @Test
    void userRoles_deny_employee() {
        assertThat(statusOfGet("/v1/rbac/users/" + UUID.randomUUID() + "/roles", token("reader@unifiedtree.demo")))
            .as("EMPLOYEE lacks rbac.role.write → 403").isEqualTo(403);
    }

    // ── Phase 10: custom role create / update / delete ───────────────────────
    @Test
    void roleCrud_allow_admin() {
        String jwt = token("admin@unifiedtree.demo");
        Map<?, ?> created = http().post()
            .uri("/v1/rbac/roles")
            .header("Authorization", "Bearer " + jwt)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("code", "TEST_ROLE_" + System.nanoTime(), "displayName", "Test Role"))
            .retrieve().body(Map.class);
        assertThat(created).as("create custom role → 201").isNotNull();
        String id = String.valueOf(created.get("id"));

        Map<?, ?> updated = http().put()
            .uri("/v1/rbac/roles/" + id)
            .header("Authorization", "Bearer " + jwt)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("displayName", "Test Role Renamed"))
            .retrieve().body(Map.class);
        assertThat(updated.get("displayName")).isEqualTo("Test Role Renamed");

        http().delete()
            .uri("/v1/rbac/roles/" + id)
            .header("Authorization", "Bearer " + jwt)
            .retrieve().toBodilessEntity();
    }

    @Test
    void roleCreate_deny_employee() {
        HttpClientErrorException ex = expectError(() ->
            http().post()
                .uri("/v1/rbac/roles")
                .header("Authorization", "Bearer " + token("reader@unifiedtree.demo"))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("code", "X", "displayName", "X"))
                .retrieve().body(Object.class));
        assertThat(ex.getStatusCode().value()).as("EMPLOYEE cannot create roles → 403").isEqualTo(403);
    }

    // ── Phase 3: enforced directory reads + no-lockout backfill ──────────────
    @Test
    void companiesRead_allow_employee_afterBackfill() {
        // V065 enforces org.company.read on GET /v1/hrms/companies and backfills it to
        // EMPLOYEE — this proves the enforcement did not lock existing users out.
        Object body = http().get()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + token("reader@unifiedtree.demo"))
            .retrieve().body(Object.class);
        assertThat(body).as("EMPLOYEE keeps company-list access via org.company.read backfill → 200").isNotNull();
    }

    @Test
    void departmentsRead_allow_employee_afterBackfill() {
        Object body = http().get()
            .uri("/v1/hrms/departments")
            .header("Authorization", "Bearer " + token("reader@unifiedtree.demo"))
            .retrieve().body(Object.class);
        assertThat(body).as("EMPLOYEE keeps department-list access via hrms.department.read → 200").isNotNull();
    }

    @Test
    void contractorsRead_deny_employee() {
        // hrms.contractor.read was NOT backfilled to EMPLOYEE (no privilege expansion).
        assertThat(statusOfGet("/v1/hrms/contractors", token("reader@unifiedtree.demo")))
            .as("EMPLOYEE lacks hrms.contractor.read → 403").isEqualTo(403);
    }

    @Test
    void contractorsRead_allow_hrManager() {
        Object body = http().get()
            .uri("/v1/hrms/contractors")
            .header("Authorization", "Bearer " + token("hrm@unifiedtree.demo"))
            .retrieve().body(Object.class);
        assertThat(body).as("HR_MANAGER keeps contractor access via hrms.contractor.read backfill → 200").isNotNull();
    }

    // ── Phase 9: FINANCE_LEAD separation of duties ───────────────────────────
    @Test
    void leaveApproval_deny_financeLead() {
        assertThat(statusOfGet("/v1/leave/approvals/pending", token("fin@unifiedtree.demo")))
            .as("FINANCE_LEAD leave approval revoked by V066 → 403").isEqualTo(403);
    }

    @Test
    void leaveApproval_allow_hrManager() {
        Object body = http().get()
            .uri("/v1/leave/approvals/pending")
            .header("Authorization", "Bearer " + token("hrm@unifiedtree.demo"))
            .retrieve().body(Object.class);
        assertThat(body).as("HR_MANAGER retains hrms.leave.approve.l1 → 200").isNotNull();
    }

    @Test
    void employeeImport_deny_financeLead() {
        assertThat(statusOfGet("/v1/bulk-import/employees/template", token("fin@unifiedtree.demo")))
            .as("FINANCE_LEAD employee.import revoked by V066 → 403").isEqualTo(403);
    }

    @Test
    void regularizationApproval_deny_financeLead() {
        // Clean GET-based proof of a V066 revocation (POST authoring endpoints use @Valid,
        // which would 400 before @PreAuthorize and make a deny assertion ambiguous).
        assertThat(statusOfGet("/v1/attendance/corrections/approvals", token("fin@unifiedtree.demo")))
            .as("FINANCE_LEAD attendance.regularization.approve revoked by V066 → 403").isEqualTo(403);
    }

    @Test
    void letterTemplateRead_allow_financeLead() {
        // Separation of duties keeps template.read (to generate letters) while revoking authoring.
        Object body = http().get()
            .uri("/v1/letters/templates")
            .header("Authorization", "Bearer " + token("fin@unifiedtree.demo"))
            .retrieve().body(Object.class);
        assertThat(body).as("FINANCE_LEAD retains hrms.letters.template.read → 200").isNotNull();
    }

    // ── Representative module gates ──────────────────────────────────────────
    @Test
    void payrollRuns_deny_employee() {
        assertThat(statusOfGet("/v1/payroll/runs", token("reader@unifiedtree.demo")))
            .as("EMPLOYEE lacks payroll.runs.read → 403").isEqualTo(403);
    }

    @Test
    void auditEvents_deny_employee() {
        assertThat(statusOfGet("/v1/audit/events?page=0&size=5", token("reader@unifiedtree.demo")))
            .as("EMPLOYEE lacks audit.read → 403").isEqualTo(403);
    }
}
