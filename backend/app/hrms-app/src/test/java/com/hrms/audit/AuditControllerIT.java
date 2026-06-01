package com.hrms.audit;

import com.hrms.app.AbstractIntegrationTest;
import com.hrms.app.HrmsApplication;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.web.client.HttpClientErrorException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies AuditController security, tenant isolation, and filter behaviour
 * against a real PostgreSQL database under production JWT security.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = HrmsApplication.class)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
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
class AuditControllerIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_audit_it")
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
        // Flyway needs superuser (ut_test) to CREATE EXTENSION, CREATE SCHEMA, set up RLS.
        r.add("spring.flyway.url",      POSTGRES::getJdbcUrl);
        r.add("spring.flyway.user",     POSTGRES::getUsername);
        r.add("spring.flyway.password", POSTGRES::getPassword);
    }

    // Fixed UUIDs so tests are deterministic across runs.
    private static final UUID KNOWN_ACTOR  = UUID.fromString("a1b2c3d4-0000-0000-0000-aabbccddeeff");
    private static final UUID KNOWN_ENTITY = UUID.fromString("e5f6a7b8-0000-0000-0000-aabbccddeeff");
    private static final UUID TENANT_B_EVENT_ID = UUID.fromString("bbbbbbbb-dead-beef-0000-aabbccddeeff");

    // Instants used by the date-range filter test.
    private static final Instant T_NOW    = Instant.now();
    private static final Instant T_PAST   = T_NOW.minus(2, ChronoUnit.HOURS);
    private static final Instant T_FUTURE = T_NOW.plus(1, ChronoUnit.HOURS);

    // ── helpers ──────────────────────────────────────────────────────────

    private void insertAuditEvent(UUID tenantId, UUID id, UUID actorUserId,
                                   String action, String entityType, UUID entityId,
                                   Instant occurredAt) {
        withTenantJdbc(tenantId, () ->
            jdbc.update("""
                INSERT INTO audit.events
                    (id, tenant_id, occurred_at, occurred_date, actor_user_id,
                     module, action, entity_type, entity_id, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, tenantId,
                java.sql.Timestamp.from(occurredAt),
                java.sql.Date.valueOf(occurredAt.atZone(java.time.ZoneOffset.UTC).toLocalDate()),
                actorUserId, "hrms", action, entityType, entityId, "IT seeded event")
        );
    }

    private String adminToken() {
        return (String) login(TENANT_A, "admin@unifiedtree.demo", "Hrms@12345").get("accessToken");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> queryEvents(String token, String queryString) {
        String uri = "/v1/audit/events" + (queryString != null ? "?" + queryString : "");
        return http().get()
                .uri(uri)
                .header("Authorization", "Bearer " + token)
                .retrieve()
                .body(Map.class);
    }

    // ── tests ─────────────────────────────────────────────────────────────

    /**
     * SUPER_ADMIN can query the audit log and receives a paged response with
     * at least the event seeded in this test.
     */
    @Test @Order(1)
    void superAdmin_queriesAuditLog_returns200WithPagedData() {
        UUID eventId = UUID.fromString("aaaaaaaa-1111-0000-0000-aabbccddeeff");
        insertAuditEvent(TENANT_A, eventId, KNOWN_ACTOR, "CREATE", "Employee", KNOWN_ENTITY, T_NOW);

        Map<String, Object> resp = queryEvents(adminToken(), null);

        assertThat(resp).containsKeys("data", "meta");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) resp.get("data");
        assertThat(data).isNotEmpty();

        @SuppressWarnings("unchecked")
        Map<String, Object> meta = (Map<String, Object>) resp.get("meta");
        assertThat(((Number) meta.get("total")).longValue()).isGreaterThanOrEqualTo(1L);
    }

    /**
     * Audit events belonging to TENANT_B are never visible when querying
     * as a TENANT_A principal — tenant isolation holds.
     */
    @Test @Order(2)
    void crossTenantIsolation_tenantBEventsNotVisibleToTenantA() {
        insertAuditEvent(TENANT_B, TENANT_B_EVENT_ID, UUID.randomUUID(),
                "DELETE", "Employee", UUID.randomUUID(), T_NOW);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data =
                (List<Map<String, Object>>) queryEvents(adminToken(), null).get("data");

        assertThat(data)
                .extracting(e -> e.get("id"))
                .doesNotContain(TENANT_B_EVENT_ID.toString());
    }

    /**
     * A principal with the EMPLOYEE role (no audit.read permission) receives 403.
     */
    @Test @Order(3)
    void employee_queriesAuditLog_receives403() {
        String readerToken = (String) login(TENANT_A, "reader@unifiedtree.demo", "Hrms@12345")
                .get("accessToken");

        HttpClientErrorException ex = expectError(() ->
                http().get()
                        .uri("/v1/audit/events")
                        .header("Authorization", "Bearer " + readerToken)
                        .retrieve()
                        .toBodilessEntity()
        );

        assertThat(ex.getStatusCode().value()).isEqualTo(403);
    }

    /**
     * Filtering by {@code actor} UUID returns only events produced by that actor.
     */
    @Test @Order(4)
    void filterByActor_returnsOnlyMatchingEvents() {
        UUID otherActor = UUID.fromString("cccccccc-0000-0000-0000-aabbccddeeff");
        UUID byActorEventId = UUID.fromString("aaaaaaaa-2222-0000-0000-aabbccddeeff");

        insertAuditEvent(TENANT_A, byActorEventId, KNOWN_ACTOR, "UPDATE", "Employee", KNOWN_ENTITY, T_NOW);
        insertAuditEvent(TENANT_A, UUID.fromString("aaaaaaaa-3333-0000-0000-aabbccddeeff"),
                otherActor, "CREATE", "Department", UUID.randomUUID(), T_NOW);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>)
                queryEvents(adminToken(), "actor=" + KNOWN_ACTOR).get("data");

        assertThat(data).isNotEmpty();
        assertThat(data).extracting(e -> e.get("actorUserId"))
                .allMatch(id -> KNOWN_ACTOR.toString().equals(id));
    }

    /**
     * Filtering by {@code from} and {@code to} timestamps returns only events
     * within the specified window.
     */
    @Test @Order(5)
    void filterByDateRange_returnsOnlyEventsInWindow() {
        Instant inWindow    = T_PAST.plus(30, ChronoUnit.MINUTES);
        Instant outOfWindow = T_FUTURE.plus(1, ChronoUnit.SECONDS); // strictly after the query window

        UUID inWindowEventId  = UUID.fromString("aaaaaaaa-4444-0000-0000-aabbccddeeff");
        UUID outWindowEventId = UUID.fromString("aaaaaaaa-5555-0000-0000-aabbccddeeff");

        insertAuditEvent(TENANT_A, inWindowEventId,  KNOWN_ACTOR, "CREATE", "Leave", KNOWN_ENTITY, inWindow);
        insertAuditEvent(TENANT_A, outWindowEventId, KNOWN_ACTOR, "CREATE", "Leave", KNOWN_ENTITY, outOfWindow);

        String qs = "from=" + T_PAST.toString() + "&to=" + T_FUTURE.toString();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>)
                queryEvents(adminToken(), qs).get("data");

        List<String> ids = data.stream().map(e -> (String) e.get("id")).toList();
        assertThat(ids).contains(inWindowEventId.toString());
        assertThat(ids).doesNotContain(outWindowEventId.toString());
    }
}
