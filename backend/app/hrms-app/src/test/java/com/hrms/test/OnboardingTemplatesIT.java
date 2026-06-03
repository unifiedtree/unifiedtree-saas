package com.hrms.test;

import com.hrms.app.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies the bug-fix-sprint onboarding change: {@code GET /v1/onboarding/templates}
 * now works WITHOUT a {@code companyId} (returns all of the tenant's templates),
 * still filters when one IS supplied, and stays tenant-isolated via RLS.
 *
 * <p>3 tests:
 * <ol>
 *   <li>no {@code companyId} → 200, returns templates from every company in the tenant</li>
 *   <li>{@code ?companyId=…} → 200, returns only that company's template (regression)</li>
 *   <li>a different tenant's authorised admin → 200, empty list (RLS isolation)</li>
 * </ol>
 *
 * <p>Tenant A is driven by the seeded SUPER_ADMIN ({@code admin@unifiedtree.demo});
 * tenant B by a planted SUPER_ADMIN credential + role grant whose JWT is minted
 * directly (the {@code @perm.check} guard resolves permissions from the DB, so the
 * principal must genuinely hold the role in tenant B).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
                classes = com.hrms.app.HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        // 32-byte base64 key so the attendance-face EmbeddingCipher bean initialises
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
class OnboardingTemplatesIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_onbtpl_it")
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

    private static final UUID COMPANY_1        = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID SUPER_ADMIN_ROLE = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final String T1_NAME = "IT-Onboarding-Company1";
    private static final String T2_NAME = "IT-Onboarding-Company2";
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST_OF_MAP =
            new ParameterizedTypeReference<>() {};

    private static boolean seeded = false;
    private static String  jwtB;

    @BeforeEach
    void seedOnce() {
        if (seeded) return;
        final UUID company2 = UUID.randomUUID();

        // Tenant A: a 2nd company + one template per company (so the company
        // filter has something to exclude).
        withTenantJdbc(TENANT_A, () -> {
            jdbc.update("""
                INSERT INTO org.companies
                    (id, tenant_id, name, is_active, created_at, updated_at, created_by, updated_by, version)
                VALUES (?, ?, 'IT Onboarding Co2', TRUE, now(), now(), 'it', 'it', 0)
                """, company2, TENANT_A);
            jdbc.update("""
                INSERT INTO hrms.onboarding_templates
                    (id, tenant_id, company_id, name, is_active, created_at, updated_at)
                VALUES (gen_random_uuid(), ?, ?, ?, TRUE, now(), now())
                """, TENANT_A, COMPANY_1, T1_NAME);
            jdbc.update("""
                INSERT INTO hrms.onboarding_templates
                    (id, tenant_id, company_id, name, is_active, created_at, updated_at)
                VALUES (gen_random_uuid(), ?, ?, ?, TRUE, now(), now())
                """, TENANT_A, company2, T2_NAME);
        });

        // Tenant B: a SUPER_ADMIN principal that holds the onboarding-read
        // permission in tenant B (so @perm.check passes) but sees 0 templates.
        final UUID bUser = UUID.randomUUID();
        withTenantJdbc(TENANT_B, () -> {
            jdbc.update("""
                INSERT INTO auth.user_credentials (id, tenant_id, email)
                VALUES (?, ?, 'b-admin@it.local')
                """, bUser, TENANT_B);
            jdbc.update("""
                INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_by)
                VALUES (?, ?, ?, ?)
                """, TENANT_B, bUser, SUPER_ADMIN_ROLE, bUser);
        });
        jwtB = jwtService.issueAccessToken(
                bUser, TENANT_B, "b-admin@it.local", List.of("SUPER_ADMIN"), List.of()).token();

        seeded = true;
    }

    private String adminJwt() {
        return (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
    }

    private static List<String> names(List<Map<String, Object>> templates) {
        return templates.stream().map(m -> (String) m.get("name")).toList();
    }

    // ── 1. no companyId → all tenant templates (the fix) ────────────────────
    @Test
    void listTemplates_withoutCompanyId_returnsAllTenantTemplates() {
        var resp = http().get()
                .uri("/v1/onboarding/templates")
                .header("Authorization", "Bearer " + adminJwt())
                .retrieve()
                .toEntity(LIST_OF_MAP);
        assertThat(resp.getStatusCode().value()).as("no companyId → 200 (was 400)").isEqualTo(200);
        assertThat(names(resp.getBody()))
                .as("returns templates from every company in the tenant")
                .contains(T1_NAME, T2_NAME);
    }

    // ── 2. companyId filter still works (regression) ────────────────────────
    @Test
    void listTemplates_withCompanyId_filtersToCompany() {
        var resp = http().get()
                .uri("/v1/onboarding/templates?companyId=" + COMPANY_1)
                .header("Authorization", "Bearer " + adminJwt())
                .retrieve()
                .toEntity(LIST_OF_MAP);
        assertThat(resp.getStatusCode().value()).isEqualTo(200);
        List<String> names = names(resp.getBody());
        assertThat(names).as("company 1's template is present").contains(T1_NAME);
        assertThat(names).as("company 2's template is filtered out").doesNotContain(T2_NAME);
    }

    // ── 3. cross-tenant isolation (RLS) ─────────────────────────────────────
    @Test
    void listTemplates_crossTenantIsolation() {
        var resp = http().get()
                .uri("/v1/onboarding/templates")
                .header("Authorization", "Bearer " + jwtB)
                .retrieve()
                .toEntity(LIST_OF_MAP);
        assertThat(resp.getStatusCode().value()).as("tenant B admin → 200").isEqualTo(200);
        assertThat(resp.getBody())
                .as("RLS: tenant B sees none of tenant A's onboarding templates")
                .isEmpty();
    }
}
