package com.hrms.app;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.HttpClientErrorException;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Milestone 4C security + contract tests for {@code GET /v1/search}.
 *
 * <p>Every assertion here is made against the HTTP endpoint (or the database
 * directly). The SPA hiding a row is not a control and is not tested here.
 *
 * <ol>
 *   <li>Same-tenant caller with {@code hrms.employee.read} finds the employee,
 *       with the minimal contract and nothing sensitive.</li>
 *   <li>Cross-tenant caller with the SAME permission and the SAME query text
 *       (tenant B has an employee with the identical name and code) gets only
 *       its own row, never tenant A's id.</li>
 *   <li>Callers without {@code hrms.employee.read} are refused with 403: a
 *       plain EMPLOYEE, and an approver-type caller holding team-attendance and
 *       leave-approval rights but no directory read. (Note the seeded
 *       DEPT_MANAGER role <em>does</em> hold {@code hrms.employee.read} since
 *       V037, so a real DEPT_MANAGER can search the tenant directory — that is
 *       the existing product rule, which search deliberately mirrors rather
 *       than re-decides.)</li>
 *   <li>No JWT: 401.</li>
 *   <li>Input contract: under 2 chars is 400, LIKE metacharacters literal,
 *       injection text inert, limit clamped, ordering exact then prefix then
 *       substring, inactive rows excluded, {@code truncated} flag.</li>
 *   <li>Performance evidence: single-statement plan and wall-clock timing.</li>
 *   <li>The directory's own gate is unchanged.</li>
 * </ol>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
// BOTH profiles, deliberately. `canonical` alone activates CanonicalSecurityConfig,
// which is `anyRequest().permitAll()` — under it the 401/403 cases below would pass
// while proving nothing. `canonical-prod` is the config that actually authenticates
// the JWT and evaluates @PreAuthorize, so it is the only honest place to assert a
// permission gate. (Same pairing as RbacEnforcementIT.)
@ActiveProfiles({"canonical", "canonical-prod"})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestPropertySource(properties = {
        "spring.kafka.bootstrap-servers=",
        "hrms.kafka.enabled=false",
        "hrms.face-recognition.enabled=false",
        "hrms.attendance.geofence-enforce=false",
        "spring.autoconfigure.exclude=" +
            "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration," +
            "org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration"
})
class EmployeeSearchIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_search_it")
                    .withUsername("ut_test")
                    .withPassword("ut_test")
                    .withInitScript("sql/test-init.sql")
                    .withReuse(false);

    /**
     * Escape hatch for machines that cannot run Docker (this repo's ITs need
     * Testcontainers, and Docker Desktop needs hardware virtualisation, which
     * not every dev box has enabled). Point these at an EMPTY database on a
     * running PostgreSQL and the suite behaves identically:
     *
     * <pre>
     * mvn -pl app/hrms-app verify -Dit.test=EmployeeSearchIT \
     *     -Dit.postgres.url=jdbc:postgresql://localhost:5432/unifiedtree_search_it \
     *     -Dit.postgres.superuser=postgres -Dit.postgres.superpass=…
     * </pre>
     *
     * The database must already contain the {@code hrms_app} login role from
     * {@code src/test/resources/sql/test-init.sql}. The app still connects as
     * that non-superuser role, so RLS is enforced exactly as in the container;
     * {@link #appRoleIsNotSuperuser()} refuses to let the suite report success
     * if it is not.
     */
    private static final String  LOCAL_URL  = System.getProperty("it.postgres.url");
    private static final boolean USE_DOCKER = LOCAL_URL == null;

    @BeforeAll static void startContainer() { if (USE_DOCKER) POSTGRES.start(); }
    @AfterAll  static void stopContainer()  { if (USE_DOCKER) POSTGRES.stop();  }

    @DynamicPropertySource
    static void dataSourceProps(DynamicPropertyRegistry r) {
        // Non-superuser app role so FORCE ROW LEVEL SECURITY actually fires.
        r.add("spring.datasource.url",      () -> USE_DOCKER ? POSTGRES.getJdbcUrl() : LOCAL_URL);
        r.add("spring.datasource.username", () -> "hrms_app");
        r.add("spring.datasource.password", () -> "hrms_app_test");
        r.add("spring.datasource.hikari.maximum-pool-size", () -> "5");
        r.add("spring.datasource.hikari.minimum-idle",      () -> "1");
        // Flyway runs the DDL as a superuser on its own (non-pooled) DataSource.
        r.add("spring.flyway.url",      () -> USE_DOCKER ? POSTGRES.getJdbcUrl()   : LOCAL_URL);
        r.add("spring.flyway.user",     () -> USE_DOCKER ? POSTGRES.getUsername()  : System.getProperty("it.postgres.superuser", "postgres"));
        r.add("spring.flyway.password", () -> USE_DOCKER ? POSTGRES.getPassword()  : System.getProperty("it.postgres.superpass", ""));
    }

    /** The only keys a hit may carry. Anything else is a contract leak. */
    private static final Set<String> HIT_KEYS = Set.of(
            "id", "displayName", "employeeCode", "departmentName", "jobTitle", "profilePhotoUrl");

    private static final UUID COMPANY_A = UUID.randomUUID();
    private static final UUID COMPANY_B = UUID.randomUUID();
    private static final UUID DEPT_A    = UUID.randomUUID();
    private static final UUID DESIG_A   = UUID.randomUUID();

    private static final UUID XANTHEQ_A   = UUID.randomUUID();   // exact first-name hit, tenant A
    private static final UUID XANTHEQA_A  = UUID.randomUUID();   // prefix hit
    private static final UUID REXANTHEQ_A = UUID.randomUUID();   // substring hit
    private static final UUID INACTIVE_A  = UUID.randomUUID();   // same name, is_active = false
    private static final UUID XANTHEQ_B   = UUID.randomUUID();   // identical name + code, tenant B
    private static final int  BOUND_ROWS  = 12;                  // > default limit (8)

    private static String jwtReadA;          // HR_MANAGER, hrms.employee.read, tenant A
    private static String jwtReadB;          // HR_MANAGER, hrms.employee.read, tenant B
    private static String jwtEmployeeA;      // EMPLOYEE, no directory permission
    /** Approver-type caller: team attendance + leave approval, but NO directory read. */
    private static String jwtApproverNoDirectoryA;

    // -- 0. The RLS assertions below are only meaningful as a non-superuser --
    @Test
    @Order(0)
    void appRoleIsNotSuperuser() {
        // PostgreSQL superusers bypass RLS even with FORCE ROW LEVEL SECURITY.
        // If the suite ever ran as one, the cross-tenant test would be testing
        // nothing, so refuse to run rather than report a green security suite.
        Boolean superuser = jdbc.queryForObject(
                "SELECT rolsuper FROM pg_roles WHERE rolname = current_user", Boolean.class);
        assertThat(superuser)
            .as("app connection must NOT be a superuser, or RLS is bypassed and these tests prove nothing")
            .isFalse();
        assertThat(jdbc.queryForObject("SELECT current_user", String.class)).isEqualTo("hrms_app");
    }

    // -- 1. Seed -----------------------------------------------------------
    @Test
    @Order(1)
    void seed() {
        TenantContext.clear();

        withTenantJdbc(TENANT_A, () -> {
            jdbc.update("INSERT INTO hrms.departments (id, tenant_id, company_id, name) VALUES (?, ?, ?, 'Engineering')",
                    DEPT_A, TENANT_A, COMPANY_A);
            jdbc.update("INSERT INTO hrms.designations (id, tenant_id, company_id, title) VALUES (?, ?, ?, 'Senior Engineer')",
                    DESIG_A, TENANT_A, COMPANY_A);
            employee(TENANT_A, COMPANY_A, XANTHEQ_A,   "EMP-SRCH-001", "Xantheq",   "Orvalle", "xantheq.orvalle@search-it.local", DEPT_A, DESIG_A, "https://cdn.example/x.png", true);
            employee(TENANT_A, COMPANY_A, XANTHEQA_A,  "EMP-SRCH-002", "Xantheqa",  "Prime",   "xantheqa.prime@search-it.local",  DEPT_A, null,    null, true);
            employee(TENANT_A, COMPANY_A, REXANTHEQ_A, "EMP-SRCH-003", "Rexantheq", "Doe",     "rexantheq.doe@search-it.local",   null,   null,    null, true);
            employee(TENANT_A, COMPANY_A, INACTIVE_A,  "EMP-SRCH-004", "Xantheq",   "Gone",    "xantheq.gone@search-it.local",    DEPT_A, DESIG_A, null, false);
            for (int i = 1; i <= BOUND_ROWS; i++) {
                employee(TENANT_A, COMPANY_A, UUID.randomUUID(), String.format("EMP-BND-%02d", i),
                        "Boundprobe", "Row" + i, "boundprobe." + i + "@search-it.local", null, null, null, true);
            }
        });
        // Tenant B: the SAME name and the SAME employee code. If search leaked
        // across tenants this is the row that would prove it.
        withTenantJdbc(TENANT_B, () ->
            employee(TENANT_B, COMPANY_B, XANTHEQ_B, "EMP-SRCH-001", "Xantheq", "Orvalle",
                    "xantheq.orvalle@tenant-b.local", null, null, null, true));

        // JWTs carry roles + permissions as claims; hasAuthority() reads the
        // permissions claim, so these mint exactly the authority sets under test.
        jwtReadA = jwtService.issueAccessToken(UUID.randomUUID(), TENANT_A, "search-hr-a@test.local",
                List.of("HR_MANAGER"), List.of("hrms.employee.read")).token();
        jwtReadB = jwtService.issueAccessToken(UUID.randomUUID(), TENANT_B, "search-hr-b@test.local",
                List.of("HR_MANAGER"), List.of("hrms.employee.read")).token();
        jwtEmployeeA = jwtService.issueAccessToken(UUID.randomUUID(), TENANT_A, "search-ess-a@test.local",
                List.of("EMPLOYEE"), List.of("attendance.checkin.self", "leave.request.self", "hrms.ess.read")).token();
        // Deliberately NOT the seeded DEPT_MANAGER authority set: that role holds
        // hrms.employee.read (V037) and may search. This is a caller who can approve
        // and see team attendance but was never granted directory read.
        jwtApproverNoDirectoryA = jwtService.issueAccessToken(UUID.randomUUID(), TENANT_A, "search-approver-a@test.local",
                List.of("DEPT_MANAGER"), List.of("attendance.team.read", "hrms.leave.approve.l1")).token();

        int[] visibleA = {-1};
        withTenantJdbc(TENANT_A, () -> visibleA[0] = jdbc.queryForObject(
                "SELECT COUNT(*) FROM hrms.employees WHERE employee_code LIKE 'EMP-SRCH-%' OR employee_code LIKE 'EMP-BND-%'", Integer.class));
        assertThat(visibleA[0]).as("seed landed in tenant A").isEqualTo(4 + BOUND_ROWS);
    }

    private void employee(UUID tenant, UUID company, UUID id, String code, String first, String last,
                          String email, UUID dept, UUID desig, String photo, boolean active) {
        jdbc.update("""
            INSERT INTO hrms.employees
              (id, tenant_id, company_id, employee_code, first_name, last_name, email,
               department_id, designation_id, profile_photo_url, is_active, date_of_joining)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE '2026-01-01')
            """, id, tenant, company, code, first, last, email, dept, desig, photo, active);
    }

    // -- 2. Same scope: found, minimal contract ----------------------------
    @Test
    @Order(2)
    void sameTenantReaderFindsEmployeeWithMinimalContract() {
        Map<?, ?> body = search(jwtReadA, "xantheq", null);
        List<Map<?, ?>> hits = hits(body);

        assertThat(ids(hits))
            .as("same-tenant reader sees the active matches, not the inactive one, never tenant B")
            .containsExactly(XANTHEQ_A.toString(), XANTHEQA_A.toString(), REXANTHEQ_A.toString());

        Map<?, ?> top = hits.get(0);
        assertThat(top.get("displayName")).isEqualTo("Xantheq Orvalle");
        assertThat(top.get("employeeCode")).isEqualTo("EMP-SRCH-001");
        assertThat(top.get("departmentName")).isEqualTo("Engineering");
        assertThat(top.get("jobTitle")).isEqualTo("Senior Engineer");
        assertThat(top.get("profilePhotoUrl")).isEqualTo("https://cdn.example/x.png");

        for (Map<?, ?> h : hits) {
            assertThat(h.keySet().stream().map(Object::toString).toList())
                .as("hit carries ONLY the six contract fields (no email/phone/DOB/salary/bank/UAN)")
                .allMatch(HIT_KEYS::contains);
        }
        assertThat(body.get("limit")).isEqualTo(8);
        assertThat(body.get("truncated")).isEqualTo(false);
    }

    // -- 3. Cross-tenant: same text, same permission, only its own row -----
    @Test
    @Order(3)
    void crossTenantReaderNeverSeesTenantARows() {
        for (String q : List.of("xantheq", "Xantheq Orvalle", "EMP-SRCH-001", "xantheq.orvalle")) {
            List<String> got = ids(hits(search(jwtReadB, q, null)));
            assertThat(got).as("tenant B query [%s] returns only tenant B's own row", q)
                .containsExactly(XANTHEQ_B.toString());
            assertThat(got).doesNotContain(XANTHEQ_A.toString(), XANTHEQA_A.toString(), REXANTHEQ_A.toString());
        }
        // And the bound-probe rows exist only in A.
        assertThat(hits(search(jwtReadB, "boundprobe", null))).isEmpty();
    }

    // -- 4. No permission: 403 (employee, and manager without directory read)
    @Test
    @Order(4)
    void callerWithoutDirectoryPermissionIsRefused() {
        HttpClientErrorException ess = expectError(() -> search(jwtEmployeeA, "xantheq", null));
        assertThat(ess.getStatusCode().value()).as("EMPLOYEE without hrms.employee.read is 403").isEqualTo(403);
        assertThat(ess.getResponseBodyAsString()).doesNotContain("Xantheq", XANTHEQ_A.toString());

        HttpClientErrorException mgr = expectError(() -> search(jwtApproverNoDirectoryA, "xantheq", null));
        assertThat(mgr.getStatusCode().value())
            .as("approver with team-attendance/leave rights but no hrms.employee.read is 403")
            .isEqualTo(403);
        assertThat(mgr.getResponseBodyAsString()).doesNotContain("Xantheq", XANTHEQ_A.toString());
    }

    // -- 5. No JWT: 401 ----------------------------------------------------
    @Test
    @Order(5)
    void anonymousIsUnauthorized() {
        HttpClientErrorException ex = expectError(() -> search(null, "xantheq", null));
        assertThat(ex.getStatusCode().value()).isEqualTo(401);
    }

    // -- 6. Input contract -------------------------------------------------
    @Test
    @Order(6)
    void queryShorterThanTwoCharsIsRejected() {
        for (String q : List.of("x", " x ", "   ", "")) {
            HttpClientErrorException ex = expectError(() -> search(jwtReadA, q, null));
            assertThat(ex.getStatusCode().value()).as("q=[%s] is 400", q).isEqualTo(400);
        }
        HttpClientErrorException missing = expectError(() ->
            http().get().uri("/v1/search").header("Authorization", "Bearer " + jwtReadA).retrieve().body(Map.class));
        assertThat(missing.getStatusCode().value()).as("missing q is 400").isEqualTo(400);
    }

    @Test
    @Order(7)
    void likeMetacharactersAndInjectionTextAreInert() {
        assertThat(hits(search(jwtReadA, "%%", null))).as("percent is literal, not a wildcard").isEmpty();
        assertThat(hits(search(jwtReadA, "__", null))).as("underscore is literal, not a wildcard").isEmpty();
        assertThat(hits(search(jwtReadA, "' OR '1'='1", null))).as("parameterised: injection text matches nothing").isEmpty();
        assertThat(hits(search(jwtReadA, "xantheq' --", null))).isEmpty();
    }

    @Test
    @Order(8)
    void rankingIsExactThenPrefixThenSubstringAndCaseInsensitive() {
        assertThat(ids(hits(search(jwtReadA, "XANTHEQ", null))))
            .as("exact first name, then prefix, then substring; case-insensitive")
            .containsExactly(XANTHEQ_A.toString(), XANTHEQA_A.toString(), REXANTHEQ_A.toString());
        assertThat(ids(hits(search(jwtReadA, "xantheq orvalle", null))))
            .as("full name matches").startsWith(XANTHEQ_A.toString());
        assertThat(ids(hits(search(jwtReadA, "emp-srch-003", null))))
            .as("employee code matches, case-insensitive").containsExactly(REXANTHEQ_A.toString());
        assertThat(ids(hits(search(jwtReadA, "rexantheq.doe@search", null))))
            .as("work email matches").containsExactly(REXANTHEQ_A.toString());
        assertThat(ids(hits(search(jwtReadA, "orvalle", null))))
            .as("last name matches; inactive Gone row never appears").containsExactly(XANTHEQ_A.toString());
    }

    @Test
    @Order(9)
    void resultsAreBoundedAndTruncationIsReported() {
        Map<?, ?> dflt = search(jwtReadA, "boundprobe", null);
        List<String> codes = hits(dflt).stream().map(h -> (String) h.get("employeeCode")).toList();
        assertThat(codes).as("default limit 8 of 12 matches").hasSize(8);
        assertThat(codes).as("deterministic: employee_code ascending").isSorted();
        assertThat(dflt.get("truncated")).isEqualTo(true);

        Map<?, ?> clampedHigh = search(jwtReadA, "boundprobe", 500);
        assertThat(clampedHigh.get("limit")).as("limit clamped to 20").isEqualTo(20);
        assertThat(hits(clampedHigh)).hasSize(BOUND_ROWS);
        assertThat(clampedHigh.get("truncated")).isEqualTo(false);

        Map<?, ?> clampedLow = search(jwtReadA, "boundprobe", 0);
        assertThat(clampedLow.get("limit")).isEqualTo(1);
        assertThat(hits(clampedLow)).hasSize(1);
        assertThat(clampedLow.get("truncated")).isEqualTo(true);
    }

    // -- 10. Performance evidence ------------------------------------------
    @Test
    @Order(10)
    void performanceEvidence() {
        // One statement, LIMIT applied, RLS predicate present. Printed so the
        // milestone report can quote the actual plan.
        List<String> plan = new ArrayList<>();
        withTenantJdbc(TENANT_A, () -> plan.addAll(jdbc.queryForList("""
            EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
            SELECT e.id, e.first_name, e.last_name, e.employee_code, e.profile_photo_url, d.name, g.title
            FROM hrms.employees e
            LEFT JOIN hrms.departments d ON d.id = e.department_id
            LEFT JOIN hrms.designations g ON g.id = e.designation_id
            WHERE e.is_active = TRUE
              AND (lower(e.employee_code) LIKE '%xantheq%' OR lower(e.first_name) LIKE '%xantheq%'
                   OR lower(e.last_name) LIKE '%xantheq%'
                   OR lower(concat_ws(' ', e.first_name, e.last_name)) LIKE '%xantheq%'
                   OR lower(e.email) LIKE '%xantheq%')
            ORDER BY 1 LIMIT 9
            """, String.class)));
        System.out.println("=== EmployeeSearchIT EXPLAIN ===");
        plan.forEach(System.out::println);
        assertThat(String.join("\n", plan)).contains("Limit");
        assertThat(String.join("\n", plan)).contains("current_tenant_id");   // RLS predicate is in the plan

        search(jwtReadA, "xantheq", null);   // warm
        int n = 20;
        long t0 = System.nanoTime();
        for (int i = 0; i < n; i++) search(jwtReadA, i % 2 == 0 ? "xantheq" : "boundprobe", null);
        double avgMs = (System.nanoTime() - t0) / 1_000_000.0 / n;
        System.out.printf("=== EmployeeSearchIT avg latency over %d requests: %.1f ms ===%n", n, avgMs);
        assertThat(avgMs).as("typeahead round-trip stays well under a second").isLessThan(1000);
    }

    // -- 11. Existing directory gate unchanged -----------------------------
    @Test
    @Order(11)
    void directoryGateIsUnchanged() {
        HttpClientErrorException ex = expectError(() ->
            http().get().uri("/v1/hrms/employees?search=xantheq")
                .header("Authorization", "Bearer " + jwtEmployeeA).retrieve().body(Map.class));
        assertThat(ex.getStatusCode().value()).as("EMPLOYEE still cannot list the directory").isEqualTo(403);

        Map<?, ?> dir = http().get().uri("/v1/hrms/employees?search=xantheq")
                .header("Authorization", "Bearer " + jwtReadA).retrieve().body(Map.class);
        assertThat(((Number) dir.get("totalElements")).intValue())
            .as("directory and search agree on what the same caller may see").isEqualTo(3);
    }

    // -- helpers -----------------------------------------------------------
    private Map<?, ?> search(String jwt, String q, Integer limit) {
        var spec = http().get().uri(b -> {
            b.path("/v1/search").queryParam("q", q);
            if (limit != null) b.queryParam("limit", limit);
            return b.build();
        });
        if (jwt != null) spec = spec.header("Authorization", "Bearer " + jwt);
        return spec.retrieve().body(Map.class);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<?, ?>> hits(Map<?, ?> body) {
        return (List<Map<?, ?>>) body.get("employees");
    }

    private static List<String> ids(List<Map<?, ?>> hits) {
        return hits.stream().map(h -> (String) h.get("id")).toList();
    }
}
