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
import static org.mockito.Mockito.when;

/**
 * Workspace Users & Access integration tests (Prompt 10) — 5 tests:
 *  1. SUPER_ADMIN lists workspace users -> 200, admin + reader present, reader has EMPLOYEE under hrms.
 *  2. SUPER_ADMIN assigns DEPT_MANAGER to reader -> 204; reader now shows DEPT_MANAGER.
 *  3. Assigning a role whose module (crm) is inactive -> 422 MODULE_NOT_ACTIVE.
 *  4. SUPER_ADMIN revokes DEPT_MANAGER -> 204; reader no longer shows it.
 *  5. EMPLOYEE (reader) cannot list workspace users -> 403.
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
class WorkspaceAccessIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_wsaccess_it")
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

    @MockBean MailService mailService;

    @BeforeEach
    void setupMailMock() { doNothing().when(mailService).send(any(EmailMessage.class)); }

    private static final UUID CRM_MANAGER_ROLE = UUID.fromString("0000000c-0000-0000-0000-00000000c001");

    private String adminToken()  { return (String) login(TENANT_A, "admin@unifiedtree.demo",  "Hrms@12345").get("accessToken"); }

    private UUID readerUserId() {
        UUID[] holder = new UUID[1];
        withTenantJdbc(TENANT_A, () ->
            holder[0] = jdbc.queryForObject(
                "SELECT id FROM auth.user_credentials WHERE email='reader@unifiedtree.demo'", UUID.class));
        return holder[0];
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> listUsers(String token) {
        return http().get().uri("/v1/workspace/users")
            .header("Authorization", "Bearer " + token)
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve()
            .body(List.class);
    }

    private int mutate(HttpMethod method, String uri, String token, Object body) {
        var spec = http().method(method).uri(uri)
            .header("Authorization", "Bearer " + token)
            .header("X-Tenant-ID", TENANT_A.toString());
        if (body != null) spec = spec.header("Content-Type", "application/json").body(body);
        return spec.retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> findUser(List<Map<String, Object>> users, String email) {
        return users.stream().filter(u -> email.equals(u.get("email"))).findFirst().orElse(null);
    }

    @SuppressWarnings("unchecked")
    private List<String> roleCodes(Map<String, Object> user) {
        List<Map<String, Object>> roles = (List<Map<String, Object>>) user.get("roles");
        return roles.stream().map(r -> (String) r.get("roleCode")).toList();
    }

    // ── Test 1 ───────────────────────────────────────────────────────────────

    @Test @Order(1)
    void test1_superAdminListsWorkspaceUsers() {
        List<Map<String, Object>> users = listUsers(adminToken());
        assertThat(users).isNotEmpty();

        Map<String, Object> admin = findUser(users, "admin@unifiedtree.demo");
        assertThat(admin).isNotNull();
        assertThat(roleCodes(admin)).contains("SUPER_ADMIN");

        Map<String, Object> reader = findUser(users, "reader@unifiedtree.demo");
        assertThat(reader).isNotNull();
        assertThat(roleCodes(reader)).contains("EMPLOYEE");
        // EMPLOYEE's permissions live under module 'hrms'
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rRoles = (List<Map<String, Object>>) reader.get("roles");
        assertThat(rRoles.stream().anyMatch(r -> "EMPLOYEE".equals(r.get("roleCode")) && "hrms".equals(r.get("module")))).isTrue();
    }

    // ── Test 2 ───────────────────────────────────────────────────────────────

    @Test @Order(2)
    void test2_assignDeptManagerToReader() {
        UUID readerId = readerUserId();
        int status = mutate(HttpMethod.POST, "/v1/workspace/users/" + readerId + "/roles",
            adminToken(), Map.of("roleCode", "DEPT_MANAGER"));
        assertThat(status).isEqualTo(204);

        Map<String, Object> reader = findUser(listUsers(adminToken()), "reader@unifiedtree.demo");
        assertThat(roleCodes(reader)).contains("DEPT_MANAGER");
    }

    // ── Test 3 ───────────────────────────────────────────────────────────────

    @Test @Order(3)
    void test3_assigningInactiveModuleRoleIsRejected() {
        // Seed a CRM_MANAGER role gated by the inactive 'crm' module.
        withTenantJdbc(TENANT_A, () -> {
            jdbc.update("""
                INSERT INTO rbac.permissions (code, display_name, module, description)
                VALUES ('crm.lead.read', 'View CRM leads', 'crm', 'Read CRM leads')
                ON CONFLICT (code) DO NOTHING
                """);
            jdbc.update("""
                INSERT INTO rbac.roles
                  (id, tenant_id, code, display_name, description, is_system, is_default_for_new_users, created_at)
                VALUES (?::uuid, ?::uuid, 'CRM_MANAGER', 'CRM Manager', 'Tenant role for CRM', FALSE, FALSE, now())
                ON CONFLICT (tenant_id, code) DO NOTHING
                """, CRM_MANAGER_ROLE.toString(), TENANT_A.toString());
            jdbc.update("""
                INSERT INTO rbac.role_permissions (role_id, permission_code)
                VALUES (?::uuid, 'crm.lead.read') ON CONFLICT DO NOTHING
                """, CRM_MANAGER_ROLE.toString());
        });

        UUID readerId = readerUserId();
        Map<?, ?> body = http().post().uri("/v1/workspace/users/" + readerId + "/roles")
            .header("Authorization", "Bearer " + adminToken())
            .header("X-Tenant-ID", TENANT_A.toString())
            .header("Content-Type", "application/json")
            .body(Map.of("roleCode", "CRM_MANAGER"))
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class).getBody();

        assertThat(body).isNotNull();
        assertThat(body.get("errorCode")).isEqualTo("MODULE_NOT_ACTIVE");
    }

    // ── Test 4 ───────────────────────────────────────────────────────────────

    @Test @Order(4)
    void test4_revokeDeptManager() {
        UUID readerId = readerUserId();
        int status = mutate(HttpMethod.DELETE,
            "/v1/workspace/users/" + readerId + "/roles/DEPT_MANAGER", adminToken(), null);
        assertThat(status).isEqualTo(204);

        Map<String, Object> reader = findUser(listUsers(adminToken()), "reader@unifiedtree.demo");
        assertThat(roleCodes(reader)).doesNotContain("DEPT_MANAGER");
        assertThat(roleCodes(reader)).contains("EMPLOYEE"); // not left role-less
    }

    // ── Test 5 ───────────────────────────────────────────────────────────────

    @Test @Order(5)
    void test5_employeeCannotListWorkspaceUsers() {
        String readerToken = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345").get("accessToken");
        int status = http().get().uri("/v1/workspace/users")
            .header("Authorization", "Bearer " + readerToken)
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity().getStatusCode().value();
        assertThat(status).isEqualTo(403);
    }
}
