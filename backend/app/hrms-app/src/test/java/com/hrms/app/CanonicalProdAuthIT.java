package com.hrms.app;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatusCode;
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

/**
 * Phase 1 acceptance test for the JWT-backed canonical security setup.
 *
 * <p>Profile combination is {@code canonical,canonical-prod}. The smoke
 * X-Tenant-ID security config refuses to load. JWT is the only path to
 * tenant resolution and authority assignment.
 *
 * <p>Gates proved:
 * <ol>
 *   <li>Admin login returns a JWT and identity claims.</li>
 *   <li>{@code /me} echoes the JWT identity back.</li>
 *   <li>Calls with only the {@code X-Tenant-ID} header (no JWT) are rejected.</li>
 *   <li>Admin JWT can POST and GET HRMS resources.</li>
 *   <li>Reader JWT (limited permissions) is blocked from POST.</li>
 *   <li>Login with the wrong tenant id is rejected.</li>
 *   <li>Tampered JWT is rejected.</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class CanonicalProdAuthIT {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_canonical_prod_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    .withReuse(false);

    @BeforeAll  static void startContainer() { POSTGRES.start(); }
    @AfterAll   static void stopContainer()  { POSTGRES.stop();  }

    @DynamicPropertySource
    static void dataSourceProps(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",      POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.hikari.maximum-pool-size", () -> "5");
        r.add("spring.datasource.hikari.minimum-idle",      () -> "1");
    }

    @LocalServerPort int port;

    private static final UUID TENANT_A = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID TENANT_B = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    private RestClient http() {
        return RestClient.builder().baseUrl("http://localhost:" + port + "/api").build();
    }

    // -- 1. Admin login returns a usable JWT --------------------------------
    @Test
    @Order(1)
    void adminLoginReturnsJwt() {
        Map<?, ?> resp = login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345");
        assertThat(resp.get("accessToken")).asString().startsWith("eyJ");
        assertThat(resp.get("roles")).asList().contains("SUPER_ADMIN");
        assertThat(resp.get("permissions")).asList().isNotEmpty();
    }

    // -- 2. /me echoes JWT identity -----------------------------------------
    @Test
    @Order(2)
    void meEchoesJwt() {
        String jwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
        Map<?, ?> me = http().get()
            .uri("/v1/canonical-auth/me")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(Map.class);
        assertThat(me.get("tenantId")).isEqualTo(TENANT_A.toString());
        assertThat(me.get("roles")).asList().contains("SUPER_ADMIN");
    }

    // -- 3. X-Tenant-ID alone is rejected -----------------------------------
    @Test
    @Order(3)
    void xTenantHeaderAloneRejected() {
        HttpClientErrorException ex = expectError(() -> http().get()
            .uri("/v1/hrms/companies")
            .header("X-Tenant-ID", TENANT_A.toString())
            .retrieve()
            .body(Map.class));
        assertThat(ex.getStatusCode().value()).isEqualTo(401);
    }

    // -- 4. Admin JWT can POST + GET ---------------------------------------
    @Test
    @Order(4)
    void adminJwtCanPostAndGet() {
        String jwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");

        Map<String, Object> body = new HashMap<>();
        body.put("name", "IT-Acme");
        body.put("industry", "Tech");
        Map<?, ?> company = http().post()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + jwt)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(Map.class);
        assertThat(company.get("name")).isEqualTo("IT-Acme");

        List<?> list = http().get()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + jwt)
            .retrieve()
            .body(List.class);
        assertThat(list).isNotEmpty();
    }

    // -- 5. Reader JWT is blocked from POST ---------------------------------
    @Test
    @Order(5)
    void readerJwtBlockedFromPost() {
        String reader = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345").get("accessToken");
        HttpClientErrorException ex = expectError(() -> http().post()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + reader)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("name", "ReaderShouldNotCreate"))
            .retrieve()
            .body(Map.class));
        assertThat(ex.getStatusCode().value()).isEqualTo(403);
    }

    // -- 6. Wrong-tenant login is rejected ---------------------------------
    @Test
    @Order(6)
    void wrongTenantLoginIsRejected() {
        HttpClientErrorException ex = expectError(() -> login(TENANT_B, "admin@unifiedtree.demo", "Hrms@12345"));
        // 422 BusinessRuleException -> INVALID_CREDENTIALS (RLS hides the user)
        HttpStatusCode sc = ex.getStatusCode();
        assertThat(sc.value()).isIn(401, 422);
    }

    // -- 7. Tampered JWT is rejected ---------------------------------------
    @Test
    @Order(7)
    void tamperedJwtRejected() {
        String jwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
        String tampered = jwt.substring(0, jwt.length() - 5) + "AAAAA";
        HttpClientErrorException ex = expectError(() -> http().get()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + tampered)
            .retrieve()
            .body(Map.class));
        assertThat(ex.getStatusCode().value()).isEqualTo(401);
    }

    // -- helpers ------------------------------------------------------------

    private Map<?, ?> login(UUID tenantId, String email, String password) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId.toString());
        body.put("email", email);
        body.put("password", password);
        return http().post()
            .uri("/v1/canonical-auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(Map.class);
    }

    private HttpClientErrorException expectError(Runnable r) {
        try { r.run(); }
        catch (HttpClientErrorException e) { return e; }
        catch (RuntimeException e) {
            if (e.getCause() instanceof HttpClientErrorException hcee) return hcee;
            throw e;
        }
        throw new AssertionError("expected error, got success");
    }
}
