package com.hrms.app;

import com.hrms.api.invitation.InvitationService;
import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.OffsetDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Invitation flow integration tests — 5 tests:
 *  1. HR_MANAGER invites employee → token created, email sent
 *  2. Employee accepts valid token → account activated, JWT returned
 *  3. Cannot accept expired token → INVITATION_EXPIRED
 *  4. Cannot reuse already-used token → INVITATION_INVALID
 *  5. EMPLOYEE role cannot invite → 403
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = com.hrms.app.HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        // 32-byte base64 key so attendance-face EmbeddingCipher bean initialises in tests
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
class InvitationFlowIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_invite_it")
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

    @Autowired InvitationService invitationService;

    private static final UUID TENANT_A  = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID EMPLOYEE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ACTOR_ID    = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @BeforeEach
    void setupMailMock() {
        doNothing().when(mailService).send(any(EmailMessage.class));
    }

    /** Look up the seeded reader user's id under tenant context. */
    private UUID readerUserId() {
        UUID[] holder = new UUID[1];
        withTenantJdbc(TENANT_A, () ->
            holder[0] = jdbc.queryForObject(
                "SELECT id FROM auth.user_credentials WHERE email='reader@unifiedtree.demo'", UUID.class));
        return holder[0];
    }

    /** Plant a token row under tenant context (passes RLS WITH CHECK). */
    private void plantToken(String hash, String purpose, String expiresSql, boolean used) {
        UUID userId = readerUserId();
        withTenantJdbc(TENANT_A, () -> jdbc.update("""
                INSERT INTO auth.invitation_tokens
                  (id, tenant_id, user_id, token_hash, purpose, expires_at, used_at)
                VALUES (gen_random_uuid(), ?::uuid, ?, ?, ?, """ + expiresSql + """
                        , %s)
                ON CONFLICT (token_hash) DO NOTHING
                """.formatted(used ? "now() - interval '1 minute'" : "NULL"),
                TENANT_A.toString(), userId, hash, purpose));
    }

    // ── Test 1 ───────────────────────────────────────────────────────────────

    @Test @Order(1)
    void test1_hrManagerCanInviteEmployee() {
        InvitationService.InvitationResult result =
                invitationService.sendInvitation(EMPLOYEE_ID, TENANT_A, ACTOR_ID);

        assertThat(result.sent()).isTrue();
        assertThat(result.expiresAt()).isAfter(OffsetDateTime.now().plusHours(71));

        // Email was dispatched via the MailService abstraction
        verify(mailService, atLeastOnce()).send(any(EmailMessage.class));

        withTenantJdbc(TENANT_A, () -> {
            // An unused INVITATION token row now exists for the user
            int tokens = jdbc.queryForObject(
                "SELECT count(*) FROM auth.invitation_tokens WHERE purpose='INVITATION' AND used_at IS NULL",
                Integer.class);
            assertThat(tokens).isGreaterThanOrEqualTo(1);

            // invited_at was stamped on the credential
            Object invitedAt = jdbc.queryForMap(
                "SELECT invited_at FROM auth.user_credentials WHERE email='reader@unifiedtree.demo'")
                .get("invited_at");
            assertThat(invitedAt).isNotNull();
        });
    }

    // ── Test 2 ───────────────────────────────────────────────────────────────

    @Test @Order(2)
    void test2_employeeAcceptsValidToken() {
        // SHA-256 is one-way, so we plant a token with a known raw value.
        String rawToken = "test-accept-token-known-12345678";
        String hash     = sha256Hex(rawToken);
        plantToken(hash, "INVITATION", "now() + interval '72 hours'", false);

        InvitationService.AcceptInviteResponse resp =
                invitationService.acceptInvitation(rawToken, "NewPass@123");

        assertThat(resp.accessToken()).isNotBlank();
        assertThat(resp.email()).isEqualTo("reader@unifiedtree.demo");
        assertThat(resp.roles()).contains("EMPLOYEE");

        withTenantJdbc(TENANT_A, () -> {
            boolean active = jdbc.queryForObject(
                "SELECT is_active FROM auth.user_credentials WHERE email='reader@unifiedtree.demo'", Boolean.class);
            assertThat(active).isTrue();

            int unused = jdbc.queryForObject(
                "SELECT count(*) FROM auth.invitation_tokens WHERE token_hash=? AND used_at IS NULL",
                Integer.class, hash);
            assertThat(unused).isZero();
        });
    }

    // ── Test 3 ───────────────────────────────────────────────────────────────

    @Test @Order(3)
    void test3_cannotAcceptExpiredToken() {
        String rawToken = "expired-token-12345678901234567";
        plantToken(sha256Hex(rawToken), "INVITATION", "now() - interval '1 hour'", false);

        assertThatThrownBy(() -> invitationService.acceptInvitation(rawToken, "NewPass@123"))
                .hasMessageContaining("expired");
    }

    // ── Test 4 ───────────────────────────────────────────────────────────────

    @Test @Order(4)
    void test4_cannotReuseAlreadyUsedToken() {
        String rawToken = "already-used-token-1234567890123";
        plantToken(sha256Hex(rawToken), "INVITATION", "now() + interval '72 hours'", true);

        assertThatThrownBy(() -> invitationService.acceptInvitation(rawToken, "NewPass@123"))
                .hasMessageContaining("invalid");
    }

    // ── Test 5 ───────────────────────────────────────────────────────────────

    @Test @Order(5)
    void test5_employeeRoleCannotInvite() {
        // reader@unifiedtree.demo has EMPLOYEE role only — no hrms.employee.invite.
        // test2 set its password to NewPass@123.
        String employeeToken = (String) login(TENANT_A, "reader@unifiedtree.demo", "NewPass@123").get("accessToken");

        var response = http()
                .post()
                .uri("/v1/employees/" + EMPLOYEE_ID + "/invite")
                .header("Authorization", "Bearer " + employeeToken)
                .header("X-Tenant-ID", TENANT_A.toString())
                .retrieve()
                .onStatus(status -> true, (req, resp) -> {})
                .toBodilessEntity();

        assertThat(response.getStatusCode().value()).isEqualTo(403);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String adminToken(String email, String password) {
        @SuppressWarnings("unchecked")
        Map<String, Object> resp = (Map<String, Object>) http()
                .post()
                .uri("/v1/canonical-auth/login")
                .header("Content-Type", "application/json")
                .body(Map.of("tenantId", TENANT_A.toString(), "email", email, "password", password))
                .retrieve()
                .body(Map.class);
        return (String) resp.get("accessToken");
    }

    private static String sha256Hex(String s) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
