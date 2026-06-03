package com.hrms.test;

import com.hrms.app.AbstractIntegrationTest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.RestClientResponseException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies the bug-fix-sprint leave-duration alignment end-to-end through the
 * HTTP layer: the backend {@code LeaveDuration} enum accepts the canonical
 * values the (fixed) frontend now sends, and rejects the old ones.
 *
 * <p>4 tests:
 * <ol>
 *   <li>{@code FULL_DAY}            → 201, totalDays = 1.0</li>
 *   <li>{@code HALF_DAY_MORNING}    → 201, totalDays = 0.5</li>
 *   <li>{@code HALF_DAY_AFTERNOON}  → 201, totalDays = 0.5</li>
 *   <li>{@code FIRST_HALF} (legacy) → 400 (enum deserialization fails — no silent compat)</li>
 * </ol>
 *
 * <p>Authenticates as the seeded SUPER_ADMIN ({@code admin@unifiedtree.demo}),
 * whose JWT carries employee_id {@code 11111111…} (employee + company seeded by
 * dev-seed V902). A leave type and a leave balance are planted via RLS-scoped
 * raw SQL. All applies use a fixed future Monday so working-day math is stable.
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
class LeaveDurationIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_leavedur_it")
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

    // Seeded by dev-seed V900/V902: admin user == employee == company below.
    private static final UUID COMPANY_A = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID ADMIN_EMP  = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE;

    private static boolean  seeded = false;
    private static UUID     leaveTypeId;
    private static LocalDate applyDate;

    @BeforeEach
    void seedOnce() {
        if (seeded) return;
        // A future Monday → always a weekday → one working day; min_notice_days = 0.
        applyDate = LocalDate.now().with(TemporalAdjusters.next(DayOfWeek.MONDAY));
        final UUID ltId = UUID.randomUUID();
        withTenantJdbc(TENANT_A, () -> {
            jdbc.update("""
                INSERT INTO leave_mgmt.leave_types
                    (id, tenant_id, company_id, name, code, annual_entitlement,
                     carry_forward_max_days, is_active)
                VALUES (?, ?, ?, 'IT Duration Leave', 'ITDUR', 20, 0, TRUE)
                """, ltId, TENANT_A, COMPANY_A);
            jdbc.update("""
                INSERT INTO leave_mgmt.leave_balances
                    (id, tenant_id, employee_id, leave_type_id, year, total_entitlement)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, 20)
                """, TENANT_A, ADMIN_EMP, ltId, applyDate.getYear());
        });
        leaveTypeId = ltId;
        seeded = true;
    }

    private String adminJwt() {
        return (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
    }

    private Map<String, Object> applyBody(String duration) {
        Map<String, Object> body = new HashMap<>();
        body.put("leaveTypeId", leaveTypeId.toString());
        body.put("startDate", applyDate.format(ISO));
        body.put("endDate", applyDate.format(ISO));
        body.put("duration", duration);
        body.put("reason", "IT " + duration);
        return body;
    }

    private void assertApplied(String duration, double expectedDays) {
        var resp = http().post()
                .uri("/v1/leave/apply")
                .header("Authorization", "Bearer " + adminJwt())
                .contentType(MediaType.APPLICATION_JSON)
                .body(applyBody(duration))
                .retrieve()
                .toEntity(Map.class);
        assertThat(resp.getStatusCode().value())
                .as("%s leave request → 201 Created", duration)
                .isEqualTo(201);
        assertThat(((Number) resp.getBody().get("totalDays")).doubleValue())
                .as("%s leave request → totalDays", duration)
                .isEqualTo(expectedDays);
    }

    // ── 1. FULL_DAY → 201, 1.0 day ──────────────────────────────────────────
    @Test
    void applyLeave_fullDay_succeeds() {
        assertApplied("FULL_DAY", 1.0);
    }

    // ── 2. HALF_DAY_MORNING → 201, 0.5 day ──────────────────────────────────
    @Test
    void applyLeave_halfDayMorning_succeeds() {
        assertApplied("HALF_DAY_MORNING", 0.5);
    }

    // ── 3. HALF_DAY_AFTERNOON → 201, 0.5 day ────────────────────────────────
    @Test
    void applyLeave_halfDayAfternoon_succeeds() {
        assertApplied("HALF_DAY_AFTERNOON", 0.5);
    }

    // ── 4. legacy FIRST_HALF is rejected (no silent backward compat) ────────
    @Test
    void applyLeave_oldFirstHalfFormat_rejected() {
        RestClientResponseException ex = null;
        try {
            http().post()
                .uri("/v1/leave/apply")
                .header("Authorization", "Bearer " + adminJwt())
                .contentType(MediaType.APPLICATION_JSON)
                .body(applyBody("FIRST_HALF"))
                .retrieve()
                .toBodilessEntity();
        } catch (RestClientResponseException e) {
            ex = e;
        }
        assertThat(ex)
                .as("legacy FIRST_HALF must be rejected, not processed")
                .isNotNull();
        // The backend enum no longer accepts FIRST_HALF → deserialization fails, and
        // GlobalExceptionHandler maps the malformed body to 400 (not 500).
        assertThat(ex.getStatusCode().value())
                .as("malformed enum → 400 Bad Request (not silently accepted, not a 500)")
                .isEqualTo(400);
    }
}
