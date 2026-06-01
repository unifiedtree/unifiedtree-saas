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
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves AES-256-GCM PII encryption is actually wired — not just promised.
 *
 * <p>The critical assertion is: dump the raw ciphertext bytes from the database
 * and prove the plaintext is NOT in there. Everything else (size check,
 * non-determinism, round-trip decrypt) adds structural depth to the proof.
 *
 * <p>Setup (test 1): admin logs in, creates a company and a workforce employee.
 * Tests 2–7 operate on that employee record.
 *
 * <p>Gates proved:
 * <ol>
 *   <li>Setup: employee created and ID captured.</li>
 *   <li>PUT identity with PAN → API responds 200; {@code panEncrypted} in response
 *       is NOT the plaintext PAN.</li>
 *   <li>Raw DB column {@code pan_encrypted} does NOT contain the plaintext PAN.</li>
 *   <li>Decoded raw bytes are ≥ 38 bytes (12-byte IV + 10 plaintext + 16-byte GCM tag).</li>
 *   <li>Encrypting the same PAN twice produces different ciphertext (IV is random).</li>
 *   <li>{@code fieldEncryptor.decrypt(rawDbValue)} recovers the original PAN exactly.</li>
 *   <li>GET /identity returns ciphertext (not plaintext) for {@code panEncrypted},
 *       and that ciphertext decrypts to the original PAN.</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.flyway.locations=classpath:db/canonical,classpath:db/dev-seed",
        "unifiedtree.jwt.secret=integration-test-only-jwt-secret-must-be-32-plus-chars",
        // 32-byte all-zeros key encoded as base64 (44 chars).
        // Any fixed key works here — we just need a valid 32-byte AES key.
        "app.pii.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class PiiEncryptionAtRestIT extends AbstractIntegrationTest {

    private static final String TEST_PAN = "ABCDE1234F";

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_pii_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    // Pre-creates hrms_app (non-superuser LOGIN role) before Spring context starts.
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

    // shared across ordered tests
    private static UUID employeeId;
    private static String adminJwt;

    // ── 1. Setup: create company + employee as admin ─────────────────────────
    @Test
    @Order(1)
    void setUp_createTestEmployee() {
        TenantContext.clear();
        adminJwt = (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345")
            .get("accessToken");
        RestClient http = http();

        Map<String, Object> coReq = Map.of("name", "PII-Test-Corp", "industry", "IT");
        Map<?, ?> company = http.post()
            .uri("/v1/hrms/companies")
            .header("Authorization", "Bearer " + adminJwt)
            .contentType(MediaType.APPLICATION_JSON)
            .body(coReq)
            .retrieve()
            .body(Map.class);
        UUID companyId = UUID.fromString((String) company.get("id"));

        Map<String, Object> empReq = new HashMap<>();
        empReq.put("companyId", companyId.toString());
        empReq.put("firstName", "PII-Test");
        empReq.put("lastName", "Subject");
        empReq.put("email", "pii.subject@example.com");
        empReq.put("employmentType", "FULL_TIME");
        empReq.put("dateOfJoining", "2026-01-01");
        Map<?, ?> emp = http.post()
            .uri("/v1/hrms/employees")
            .header("Authorization", "Bearer " + adminJwt)
            .contentType(MediaType.APPLICATION_JSON)
            .body(empReq)
            .retrieve()
            .body(Map.class);
        employeeId = UUID.fromString((String) emp.get("id"));
        assertThat(employeeId).isNotNull();
    }

    // ── 2. PUT identity → response panEncrypted ≠ plaintext ──────────────────
    @Test
    @Order(2)
    void putIdentity_responsePanEncryptedIsNotPlaintext() {
        Assumptions.assumeTrue(employeeId != null, "requires test 1 to have created the employee");

        Map<String, Object> req = new HashMap<>();
        req.put("pan", TEST_PAN);
        req.put("uan", "123456789012");

        Map<?, ?> resp = http().put()
            .uri("/v1/employees/" + employeeId + "/profile/identity")
            .header("Authorization", "Bearer " + adminJwt)
            .contentType(MediaType.APPLICATION_JSON)
            .body(req)
            .retrieve()
            .body(Map.class);

        // The serialised entity has panEncrypted = Base64(iv || ciphertext || tag),
        // never the plaintext PAN.
        assertThat(resp.get("panEncrypted"))
            .as("PUT identity response: panEncrypted must not equal plaintext PAN")
            .isNotEqualTo(TEST_PAN);
        assertThat(resp.get("panEncrypted"))
            .as("PUT identity response: panEncrypted must not be null")
            .isNotNull();
    }

    // ── 3. Raw DB column does NOT contain the plaintext PAN ──────────────────
    @Test
    @Order(3)
    void rawDbColumn_doesNotContainPlaintext() {
        Assumptions.assumeTrue(employeeId != null, "requires test 1");

        String[] raw = {null};
        withTenantJdbc(TENANT_A, () ->
            raw[0] = jdbc.queryForObject(
                "SELECT pan_encrypted FROM hrms.employee_identities WHERE employee_id = ?",
                String.class, employeeId));

        assertThat(raw[0]).as("raw DB pan_encrypted must not be null").isNotNull();
        assertThat(raw[0])
            .as("raw DB column must NOT contain the plaintext PAN — encryption was bypassed")
            .doesNotContain(TEST_PAN);
    }

    // ── 4. Ciphertext bytes have AES-GCM structure (≥ 38 bytes) ─────────────
    @Test
    @Order(4)
    void rawDbBytes_haveAesGcmStructure() {
        Assumptions.assumeTrue(employeeId != null, "requires test 1");

        String[] raw = {null};
        withTenantJdbc(TENANT_A, () ->
            raw[0] = jdbc.queryForObject(
                "SELECT pan_encrypted FROM hrms.employee_identities WHERE employee_id = ?",
                String.class, employeeId));

        byte[] decoded = Base64.getDecoder().decode(raw[0]);
        // Layout: iv[12] || ciphertext[len(plaintext)] || gcm-tag[16]
        // "ABCDE1234F" = 10 bytes → total ≥ 38 bytes
        assertThat(decoded.length)
            .as("decoded ciphertext must be ≥ 38 bytes (12 IV + plaintext + 16 GCM tag)")
            .isGreaterThanOrEqualTo(38);
    }

    // ── 5. Encryption is non-deterministic (IV is random) ────────────────────
    @Test
    @Order(5)
    void encryption_isNonDeterministic() {
        String first  = fieldEncryptor.encrypt(TEST_PAN);
        String second = fieldEncryptor.encrypt(TEST_PAN);
        assertThat(first)
            .as("encrypting the same PAN twice must produce different ciphertext (random IV)")
            .isNotEqualTo(second);
    }

    // ── 6. Decryption recovers the plaintext PAN ─────────────────────────────
    @Test
    @Order(6)
    void decrypt_recoversPlaintextFromRawDbValue() {
        Assumptions.assumeTrue(employeeId != null, "requires test 1");

        String[] raw = {null};
        withTenantJdbc(TENANT_A, () ->
            raw[0] = jdbc.queryForObject(
                "SELECT pan_encrypted FROM hrms.employee_identities WHERE employee_id = ?",
                String.class, employeeId));

        String decrypted = fieldEncryptor.decrypt(raw[0]);
        assertThat(decrypted)
            .as("fieldEncryptor.decrypt(rawDbValue) must recover the original PAN exactly")
            .isEqualTo(TEST_PAN);
    }

    // ── 7. GET /identity returns ciphertext, and it round-trips ─────────────
    @Test
    @Order(7)
    void getIdentity_panEncryptedRoundTrips() {
        Assumptions.assumeTrue(employeeId != null, "requires test 1");

        Map<?, ?> resp = http().get()
            .uri("/v1/employees/" + employeeId + "/profile/identity")
            .header("Authorization", "Bearer " + adminJwt)
            .retrieve()
            .body(Map.class);

        String ciphertext = (String) resp.get("panEncrypted");
        assertThat(ciphertext)
            .as("GET /identity: panEncrypted must not be the plaintext PAN")
            .isNotEqualTo(TEST_PAN);

        // The ciphertext returned by the API must be the same encrypted value
        // that round-trips correctly through the decryptor.
        assertThat(fieldEncryptor.decrypt(ciphertext))
            .as("GET /identity: fieldEncryptor.decrypt(panEncrypted) must return original PAN")
            .isEqualTo(TEST_PAN);
    }
}
