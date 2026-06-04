package com.hrms.test;

import com.hrms.api.mail.MailDeliveryException;
import com.hrms.api.mail.MailService;
import com.hrms.app.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
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
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;

/**
 * Verifies the invitation email is sent ASYNCHRONOUSLY + best-effort, so a slow or
 * unreachable SMTP server never blocks the request, and the token's send_status is
 * tracked (PENDING → SENT | FAILED) for the UI to surface a retry.
 *
 * <p>Drives a credential-only workspace user through {@code POST
 * /v1/workspace/users/{userId}/invite/resend} (→ {@code sendInviteToCredential}), which
 * runs the same async send path as the employee invite, without needing an employee row.
 * {@link MailService} is mocked so we can deterministically simulate working / failing /
 * slow SMTP.
 *
 * <ol>
 *   <li>working SMTP → token eventually SENT, no error</li>
 *   <li>failing (slow) SMTP → invite returns immediately (non-blocking), token FAILED + error</li>
 *   <li>resend after a failure → token SENT and the error is cleared</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
                classes = com.hrms.app.HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
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
class InvitationAsyncSendIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_inviteasync_it")
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

    /** The real SmtpMailService is replaced so we can simulate SMTP behaviour. */
    @MockBean
    private MailService mailService;

    private static final ParameterizedTypeReference<Map<String, Object>> MAP =
            new ParameterizedTypeReference<>() {};

    private String adminJwt() {
        return (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
    }

    /** Seed an inactive, credential-only workspace user (no employee) in tenant A. */
    private UUID seedInvitableUser() {
        UUID userId = UUID.randomUUID();
        String email = "async-it-" + userId + "@it.local";
        withTenantJdbc(TENANT_A, () -> jdbc.update("""
                INSERT INTO auth.user_credentials (id, tenant_id, email, is_active)
                VALUES (?, ?, ?, FALSE)
                """, userId, TENANT_A, email));
        return userId;
    }

    private void resend(UUID userId) {
        http().post()
                .uri("/v1/workspace/users/" + userId + "/invite/resend")
                .header("Authorization", "Bearer " + adminJwt())
                .header("Content-Type", "application/json")
                .body("{}")
                .retrieve()
                .toEntity(MAP);
    }

    /** Poll the latest INVITATION token's send_status until it leaves PENDING (or times out). */
    private String[] awaitSendOutcome(UUID userId) throws InterruptedException {
        for (int i = 0; i < 60; i++) {            // up to ~12s
            String[] holder = new String[2];
            withTenantJdbc(TENANT_A, () -> {
                List<Map<String, Object>> rows = jdbc.queryForList("""
                        SELECT send_status, last_send_error
                          FROM auth.invitation_tokens
                         WHERE user_id = ? AND purpose = 'INVITATION'
                         ORDER BY created_at DESC
                         LIMIT 1
                        """, userId);
                if (!rows.isEmpty()) {
                    holder[0] = (String) rows.get(0).get("send_status");
                    holder[1] = (String) rows.get(0).get("last_send_error");
                }
            });
            if (holder[0] != null && !"PENDING".equals(holder[0])) return holder;
            Thread.sleep(200);
        }
        throw new AssertionError("invitation send_status stayed PENDING (async send never completed)");
    }

    // ── 1. working SMTP → SENT ───────────────────────────────────────────────
    @Test
    void createInvite_withWorkingSmtp_eventuallySent() throws Exception {
        doNothing().when(mailService).send(any());
        UUID userId = seedInvitableUser();

        resend(userId);

        String[] outcome = awaitSendOutcome(userId);
        assertThat(outcome[0]).as("send_status after working SMTP").isEqualTo("SENT");
        assertThat(outcome[1]).as("no error on success").isNull();
    }

    // ── 2. failing/slow SMTP → returns immediately, FAILED ───────────────────
    @Test
    void createInvite_withFailingSmtp_returnsImmediately_statusFailed() throws Exception {
        // Simulate a slow, ultimately-failing SMTP server.
        doAnswer(inv -> {
            Thread.sleep(2000);
            throw new MailDeliveryException("Simulated SMTP outage", null);
        }).when(mailService).send(any());
        UUID userId = seedInvitableUser();

        long start = System.currentTimeMillis();
        resend(userId);
        long elapsedMs = System.currentTimeMillis() - start;

        assertThat(elapsedMs)
                .as("invite must NOT block on the (2s) SMTP send — it is fired async after commit")
                .isLessThan(1500);

        String[] outcome = awaitSendOutcome(userId);
        assertThat(outcome[0]).as("send_status after SMTP failure").isEqualTo("FAILED");
        assertThat(outcome[1]).as("failure detail is captured").contains("Simulated SMTP outage");
    }

    // ── 3. resend after a failure clears the error on success ────────────────
    @Test
    void resendInvite_afterFailure_clearsErrorOnSuccess() throws Exception {
        AtomicBoolean fail = new AtomicBoolean(true);
        doAnswer(inv -> {
            if (fail.get()) throw new MailDeliveryException("Simulated SMTP outage", null);
            return null;
        }).when(mailService).send(any());

        UUID userId = seedInvitableUser();

        // First attempt fails.
        resend(userId);
        assertThat(awaitSendOutcome(userId)[0]).isEqualTo("FAILED");

        // SMTP recovers; resend issues a fresh token and succeeds.
        fail.set(false);
        resend(userId);

        String[] outcome = awaitSendOutcome(userId);
        assertThat(outcome[0]).as("send_status after successful resend").isEqualTo("SENT");
        assertThat(outcome[1]).as("error cleared on success").isNull();
    }
}
