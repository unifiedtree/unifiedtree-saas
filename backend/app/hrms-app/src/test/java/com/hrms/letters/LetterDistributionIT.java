package com.hrms.letters;

import com.hrms.app.AbstractIntegrationTest;
import com.hrms.app.HrmsApplication;
import com.hrms.letters.service.LetterEmailService;
import com.hrms.letters.service.PdfRenderer;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Bulk Letter Distribution integration tests (backend; NOT UI-coupled).
 *
 * Proves the distribution lifecycle end-to-end against the real async pipeline:
 * create (202) → recipients snapshotted → @Async generate+email per recipient →
 * terminal job status — plus the permission gate (HR can distribute, Finance and
 * plain employees cannot) and recipient-resolution validation. PdfRenderer and
 * LetterEmailService are mocked so we test the distribution contract + status
 * transitions, not rendering/SMTP fidelity (same approach as LetterFlowIT).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        // 32-byte base64 key so the attendance-face EmbeddingCipher bean initialises
        // regardless of any UNIFIEDTREE_FACE_ENCRYPTION_KEY env var on the host.
        "unifiedtree.face.encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        "unifiedtree.face.enabled=false",
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "unifiedtree.letters.local-path=${java.io.tmpdir}/ut-letterdist-it",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class LetterDistributionIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_letterdist_it")
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

    // Mock heavy I/O — assert the distribution contract, not rendering/SMTP.
    @MockBean PdfRenderer pdfRenderer;
    @MockBean LetterEmailService emailService;

    private static final UUID TENANT_A_COMPANY = UUID.fromString("aaaaaaaa-cccc-cccc-cccc-aaaaaaaaaaaa");
    private static final UUID EMP_READER = UUID.fromString("22222222-2222-2222-2222-222222222222"); // reader@ (has email)
    private static final UUID EMP_FIN    = UUID.fromString("55555555-5555-5555-5555-555555555555"); // fin@ (has email)

    private static String TEMPLATE_ID;
    private static String JOB_ID;

    @BeforeEach
    void mocks() {
        when(pdfRenderer.render(any())).thenReturn("PDF-BYTES".getBytes());
        doNothing().when(emailService).send(any(), any(), any(), any(), any(), any());
    }

    private String token(String email) {
        return (String) login(TENANT_A, email, "Hrms@12345").get("accessToken");
    }

    @SuppressWarnings("unchecked")
    private String createTemplate() {
        Map<String, Object> resp = http().post().uri("/v1/letters/templates")
                .header("Authorization", "Bearer " + token("admin@unifiedtree.demo"))
                .header("Content-Type", "application/json")
                .body(Map.of("companyId", TENANT_A_COMPANY.toString(),
                             "name", "Distribution IT Template", "type", "CUSTOM",
                             "subject", "Document for {{employee.firstName}}",
                             "bodyHtml", "<p>Hi {{employee.firstName}}, your document is attached.</p>"))
                .retrieve().body(Map.class);
        return (String) resp.get("id");
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map> postDistribution(String token, Map<String, Object> body) {
        return http().post().uri("/v1/letters/distributions")
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json").body(body)
                .retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getJob(String token, String jobId) {
        return http().get().uri("/v1/letters/distributions/" + jobId)
                .header("Authorization", "Bearer " + token)
                .retrieve().body(Map.class);
    }

    /** Poll the job until it reaches a terminal status (async generate+send is fast with mocks). */
    private Map<String, Object> pollTerminal(String token, String jobId) throws InterruptedException {
        for (int i = 0; i < 40; i++) {
            Map<String, Object> job = getJob(token, jobId);
            String st = (String) job.get("status");
            if ("COMPLETED".equals(st) || "FAILED".equals(st) || "PARTIAL_FAILURE".equals(st)) return job;
            Thread.sleep(400);
        }
        throw new AssertionError("distribution " + jobId + " did not reach a terminal status in time");
    }

    private Map<String, Object> recipientFilterCustom(List<UUID> ids) {
        return Map.of("type", "CUSTOM_LIST", "employeeIds", ids.stream().map(UUID::toString).toList());
    }

    // ── 1. HR manager creates a distribution → both recipients SENT, job COMPLETED ──

    @Test @Order(1)
    void test1_hrManagerDistributes_completesAllSent() throws InterruptedException {
        TEMPLATE_ID = createTemplate();

        var resp = postDistribution(token("hrm@unifiedtree.demo"), Map.of(
                "templateId", TEMPLATE_ID,
                "title", "Q2 Policy Update",
                "recipientFilter", recipientFilterCustom(List.of(EMP_READER, EMP_FIN))));

        assertThat(resp.getStatusCode().value()).isEqualTo(202);   // queued
        assertThat(resp.getBody()).isNotNull();
        assertThat(resp.getBody().get("status")).isEqualTo("PENDING");
        assertThat(((Number) resp.getBody().get("totalRecipients")).intValue()).isEqualTo(2);
        JOB_ID = (String) resp.getBody().get("id");

        Map<String, Object> done = pollTerminal(token("hrm@unifiedtree.demo"), JOB_ID);
        assertThat(done.get("status")).isEqualTo("COMPLETED");
        assertThat(((Number) done.get("sentCount")).intValue()).isEqualTo(2);
        assertThat(((Number) done.get("failedCount")).intValue()).isZero();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> recipients = (List<Map<String, Object>>) done.get("recipients");
        assertThat(recipients).hasSize(2);
        assertThat(recipients).allSatisfy(r -> assertThat(r.get("sendStatus")).isEqualTo("SENT"));

        // The async worker actually attempted a send per sendable recipient.
        verify(emailService, times(2)).send(any(), any(), any(), any(), any(), any());
    }

    // ── 2. FINANCE_LEAD cannot distribute (not granted hrms.letters.distribute) ──

    @Test @Order(2)
    void test2_financeLeadForbidden() {
        var resp = postDistribution(token("fin@unifiedtree.demo"), Map.of(
                "templateId", TEMPLATE_ID,
                "title", "Should be blocked",
                "recipientFilter", recipientFilterCustom(List.of(EMP_READER))));
        assertThat(resp.getStatusCode().value()).isEqualTo(403);
    }

    // ── 3. A plain EMPLOYEE cannot distribute ──

    @Test @Order(3)
    void test3_employeeForbidden() {
        var resp = postDistribution(token("reader@unifiedtree.demo"), Map.of(
                "templateId", TEMPLATE_ID,
                "title", "Should be blocked",
                "recipientFilter", recipientFilterCustom(List.of(EMP_FIN))));
        assertThat(resp.getStatusCode().value()).isEqualTo(403);
    }

    // ── 4. Empty recipient resolution → 400 NO_RECIPIENTS (nothing queued) ──

    @Test @Order(4)
    void test4_emptyRecipients_rejected() {
        var resp = postDistribution(token("hrm@unifiedtree.demo"), Map.of(
                "templateId", TEMPLATE_ID,
                "title", "No one",
                "recipientFilter", Map.of("type", "CUSTOM_LIST", "employeeIds", List.of())));
        assertThat(resp.getStatusCode().value()).isEqualTo(400);
        assertThat(resp.getBody()).isNotNull();
        assertThat(String.valueOf(resp.getBody().get("errorCode"))).isEqualTo("NO_RECIPIENTS");
    }

    // ── 5. SUPER_ADMIN lists + reads the job created in test 1 ──

    @Test @Order(5)
    @SuppressWarnings("unchecked")
    void test5_superAdminListsAndGets() {
        assertThat(JOB_ID).as("job created in test 1").isNotNull();
        Map<String, Object> page = http().get().uri("/v1/letters/distributions")
                .header("Authorization", "Bearer " + token("admin@unifiedtree.demo"))
                .retrieve().body(Map.class);
        List<Map<String, Object>> content = (List<Map<String, Object>>) page.get("content");
        assertThat(content).extracting(j -> j.get("id")).contains(JOB_ID);

        Map<String, Object> detail = getJob(token("admin@unifiedtree.demo"), JOB_ID);
        assertThat(detail.get("title")).isEqualTo("Q2 Policy Update");
        assertThat((List<?>) detail.get("recipients")).hasSize(2);
    }

    // ── 6. Retry on a job with no FAILED recipients → 0 re-queued ──

    @Test @Order(6)
    @SuppressWarnings("unchecked")
    void test6_retryNoFailures_returnsZero() {
        assertThat(JOB_ID).as("job created in test 1").isNotNull();
        Map<String, Object> resp = http().post().uri("/v1/letters/distributions/" + JOB_ID + "/retry")
                .header("Authorization", "Bearer " + token("hrm@unifiedtree.demo"))
                .retrieve().body(Map.class);
        assertThat(((Number) resp.get("retried")).intValue()).isZero();
    }
}
