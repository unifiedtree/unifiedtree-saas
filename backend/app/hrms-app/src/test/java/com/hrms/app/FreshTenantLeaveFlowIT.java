package com.hrms.app;

import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

/**
 * HRMS Audit P0-1 — FRESH-TENANT leave-approver routing proof. The approval queue
 * filters by approver_id, so a null approver makes a leave request invisible to
 * everyone (the worst customer-facing bug in the audit). This suite provisions
 * brand-new tenants and drives the real HTTP flow (login → apply → approve) to
 * prove the resolution chain never leaves an approver unset:
 *
 *   1. no manager + no department head, an HR_MANAGER exists → approver = HR_MANAGER (Layer 3 fallback)
 *   2. reporting manager set                                 → approver = manager   (Layer 1)
 *   3. no manager, department HAS a head                     → approver = dept head (Layer 2)
 *   4. no manager, no head, NO HR_MANAGER and NO admin       → 422 NO_APPROVER_AVAILABLE, nothing persisted
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
class FreshTenantLeaveFlowIT extends AbstractIntegrationTest {

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("unifiedtree_freshleave_it")
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

    @MockBean MailService mailService;
    @Autowired JdbcTemplate raw;   // superuser-ish app role; we scope via withTenantJdbc

    private static final String PW   = "Hrms@12345";
    // bcrypt cost-10 hash of Hrms@12345 (from dev-seed V900) — lets seeded users log in.
    private static final String HASH = "$2a$10$PeLol1qt9lhuoT9c.XBvmuSWIWQ0/.P0m6D7xJegBQezSJ3iG5emu";
    private static final UUID ROLE_EMPLOYEE   = UUID.fromString("00000000-0000-0000-0000-000000000004");
    private static final UUID ROLE_HR_MANAGER = UUID.fromString("00000000-0000-0000-0000-000000000002");

    private static final UUID T1 = UUID.fromString("11110000-0000-0000-0000-000000000001");
    private static final UUID T2 = UUID.fromString("22220000-0000-0000-0000-000000000002");
    private static final UUID T3 = UUID.fromString("33330000-0000-0000-0000-000000000003");
    private static final UUID T4 = UUID.fromString("44440000-0000-0000-0000-000000000004");

    @BeforeEach void setup() { doNothing().when(mailService).send(any(EmailMessage.class)); }

    // ── seeding helpers ─────────────────────────────────────────────────────────

    private void provisionTenant(UUID tenant, String slug) {
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO platform.tenants (id, subdomain, display_name, contact_email, status, plan_type) " +
            "VALUES (?::uuid, ?, ?, ?, 'ACTIVE', 'ENTERPRISE') ON CONFLICT (id) DO NOTHING",
            tenant.toString(), slug, slug, slug + "@itest.demo"));
    }

    private UUID addCompany(UUID tenant, String name) {
        UUID id = UUID.randomUUID();
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO org.companies (id, tenant_id, name) VALUES (?::uuid, ?::uuid, ?)",
            id.toString(), tenant.toString(), name));
        return id;
    }

    private UUID addDepartment(UUID tenant, UUID companyId, UUID headEmployeeId) {
        UUID id = UUID.randomUUID();
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO hrms.departments (id, tenant_id, company_id, name, department_head_employee_id) " +
            "VALUES (?::uuid, ?::uuid, ?::uuid, 'Engineering', ?::uuid)",
            id.toString(), tenant.toString(), companyId.toString(),
            headEmployeeId == null ? null : headEmployeeId.toString()));
        return id;
    }

    private UUID addEmployee(UUID tenant, UUID companyId, String code, String first, UUID managerId, UUID deptId) {
        UUID id = UUID.randomUUID();
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO hrms.employees " +
            "(id, tenant_id, company_id, employee_code, first_name, employment_type, employment_status, " +
            " reporting_manager_id, department_id) " +
            "VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, 'FULL_TIME', 'PROBATION', ?::uuid, ?::uuid)",
            id.toString(), tenant.toString(), companyId.toString(), code, first,
            managerId == null ? null : managerId.toString(),
            deptId == null ? null : deptId.toString()));
        return id;
    }

    private void addUser(UUID tenant, String email, String mobile, UUID employeeId, UUID roleId) {
        UUID userId = UUID.randomUUID();
        withTenantJdbc(tenant, () -> {
            jdbc.update(
                "INSERT INTO auth.user_credentials " +
                "(id, tenant_id, email, mobile_number, password_hash, employee_id, is_active, " +
                " is_biometric_enabled, failed_login_count, created_at, updated_at, created_by, updated_by, version) " +
                "VALUES (?::uuid, ?::uuid, ?, ?, ?, ?::uuid, TRUE, FALSE, 0, now(), now(), 'it', 'it', 0)",
                userId.toString(), tenant.toString(), email, mobile, HASH, employeeId.toString());
            jdbc.update(
                "INSERT INTO rbac.user_roles (tenant_id, user_id, role_id, granted_at, granted_by) " +
                "VALUES (?::uuid, ?::uuid, ?::uuid, now(), ?::uuid)",
                tenant.toString(), userId.toString(), roleId.toString(), userId.toString());
        });
    }

    private UUID addLeaveType(UUID tenant, UUID companyId) {
        UUID id = UUID.randomUUID();
        withTenantJdbc(tenant, () -> jdbc.update(
            "INSERT INTO leave_mgmt.leave_types " +
            "(id, tenant_id, company_id, name, code, annual_entitlement, is_paid_leave, is_active) " +
            "VALUES (?::uuid, ?::uuid, ?::uuid, 'Casual Leave', 'CL', 20, TRUE, TRUE)",
            id.toString(), tenant.toString(), companyId.toString()));
        return id;
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────────

    private String token(UUID tenant, String email) {
        return (String) login(tenant, email, PW).get("accessToken");
    }

    @SuppressWarnings("unchecked")
    private org.springframework.http.ResponseEntity<Map> apply(String token, UUID tenant, UUID leaveTypeId) {
        return http().post().uri("/v1/leave/apply")
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", tenant.toString())
            .header("Content-Type", "application/json")
            .body(Map.of("leaveTypeId", leaveTypeId.toString(),
                         "startDate", "2027-03-01", "endDate", "2027-03-03",
                         "duration", "FULL_DAY", "reason", "Fresh-tenant IT"))
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toEntity(Map.class);
    }

    @SuppressWarnings("unchecked")
    private List<?> pending(String token, UUID tenant) {
        Map<String, Object> body = http().get().uri("/v1/leave/approvals/pending")
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", tenant.toString())
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).body(Map.class);
        Object content = body == null ? null : body.get("content");
        return content instanceof List ? (List<?>) content : List.of();
    }

    private int l1Decide(String token, UUID tenant, String requestId, String status) {
        return http().post().uri("/v1/leave/" + requestId + "/l1-decision")
            .header("Authorization", "Bearer " + token).header("X-Tenant-ID", tenant.toString())
            .header("Content-Type", "application/json")
            .body(Map.of("status", status, "comment", "ok"))
            .retrieve().onStatus(s -> true, (rq, rs) -> {}).toBodilessEntity().getStatusCode().value();
    }

    private String approverId(UUID tenant, UUID employeeId) {
        String[] box = new String[1];
        withTenantJdbc(tenant, () -> box[0] = jdbc.query(
            "SELECT approver_id::text FROM leave_mgmt.leave_requests WHERE employee_id = ?::uuid",
            rs -> rs.next() ? rs.getString(1) : null, employeeId.toString()));
        return box[0];
    }

    private int requestCount(UUID tenant, UUID employeeId) {
        Integer[] box = new Integer[1];
        withTenantJdbc(tenant, () -> box[0] = jdbc.queryForObject(
            "SELECT count(*) FROM leave_mgmt.leave_requests WHERE employee_id = ?::uuid",
            Integer.class, employeeId.toString()));
        return box[0];
    }

    // ── Scenario 1 — Layer 3: HR_MANAGER fallback (the one read most carefully) ────

    @Test @Order(1)
    void test1_noManagerNoHead_fallsBackToHrManager() {
        provisionTenant(T1, "freshleave1");
        UUID company = addCompany(T1, "Fresh One");
        UUID leaveType = addLeaveType(T1, company);
        UUID applicant = addEmployee(T1, company, "F1-EMP", "Asha", null, null);   // no manager, no dept
        UUID hrEmp     = addEmployee(T1, company, "F1-HR", "Hema", null, null);
        addUser(T1, "emp@freshleave1.demo", "9000000011", applicant, ROLE_EMPLOYEE);
        addUser(T1, "hr@freshleave1.demo",  "9000000012", hrEmp,     ROLE_HR_MANAGER);

        var resp = apply(token(T1, "emp@freshleave1.demo"), T1, leaveType);
        assertThat(resp.getStatusCode().value()).isEqualTo(201);

        // Layer-3 fallback fired: approver is the HR manager's employee id, NOT null.
        assertThat(approverId(T1, applicant)).isEqualTo(hrEmp.toString());

        // ...and the request is visible in that HR manager's approval queue.
        String hrToken = token(T1, "hr@freshleave1.demo");
        List<?> queue = pending(hrToken, T1);
        assertThat(queue).hasSize(1);
        String requestId = (String) ((Map<?, ?>) queue.get(0)).get("id");

        // L1 approve escalates to L2 (correct lifecycle transition).
        assertThat(l1Decide(hrToken, T1, requestId, "APPROVED")).isEqualTo(200);
        withTenantJdbc(T1, () -> assertThat(jdbc.queryForObject(
            "SELECT status FROM leave_mgmt.leave_requests WHERE id = ?::uuid", String.class, requestId))
            .isEqualTo("PENDING_L2"));
    }

    // ── Scenario 2 — Layer 1: explicit reporting manager ──────────────────────────

    @Test @Order(2)
    void test2_reportingManager_routesToManager() {
        provisionTenant(T2, "freshleave2");
        UUID company = addCompany(T2, "Fresh Two");
        UUID leaveType = addLeaveType(T2, company);
        UUID manager   = addEmployee(T2, company, "F2-MGR", "Manoj", null, null);
        UUID applicant = addEmployee(T2, company, "F2-EMP", "Bharat", manager, null);
        addUser(T2, "emp@freshleave2.demo", "9000000021", applicant, ROLE_EMPLOYEE);
        addUser(T2, "mgr@freshleave2.demo", "9000000022", manager,   ROLE_HR_MANAGER); // so they can view the queue

        var resp = apply(token(T2, "emp@freshleave2.demo"), T2, leaveType);
        assertThat(resp.getStatusCode().value()).isEqualTo(201);
        assertThat(approverId(T2, applicant)).isEqualTo(manager.toString());
        assertThat(pending(token(T2, "mgr@freshleave2.demo"), T2)).hasSize(1);
    }

    // ── Scenario 3 — Layer 2: department head (pre-existing path, fresh-tenant proof) ─

    @Test @Order(3)
    void test3_departmentHead_routesToHead() {
        provisionTenant(T3, "freshleave3");
        UUID company = addCompany(T3, "Fresh Three");
        UUID leaveType = addLeaveType(T3, company);
        UUID head = addEmployee(T3, company, "F3-HEAD", "Devi", null, null);
        UUID dept = addDepartment(T3, company, head);
        UUID applicant = addEmployee(T3, company, "F3-EMP", "Chitra", null, dept);   // no manager, dept has head
        addUser(T3, "emp@freshleave3.demo", "9000000031", applicant, ROLE_EMPLOYEE);

        var resp = apply(token(T3, "emp@freshleave3.demo"), T3, leaveType);
        assertThat(resp.getStatusCode().value()).isEqualTo(201);
        assertThat(approverId(T3, applicant)).isEqualTo(head.toString());
    }

    // ── Scenario 4 — no approver anywhere → fail loudly, persist nothing ──────────

    @Test @Order(4)
    void test4_noApproverAtAll_blocksAndPersistsNothing() {
        provisionTenant(T4, "freshleave4");
        UUID company = addCompany(T4, "Fresh Four");
        UUID leaveType = addLeaveType(T4, company);
        UUID applicant = addEmployee(T4, company, "F4-EMP", "Esha", null, null);
        addUser(T4, "emp@freshleave4.demo", "9000000041", applicant, ROLE_EMPLOYEE);  // no HR, no admin

        var resp = apply(token(T4, "emp@freshleave4.demo"), T4, leaveType);
        assertThat(resp.getStatusCode().value()).isEqualTo(422);
        assertThat(resp.getBody()).isNotNull();
        assertThat(resp.getBody().get("errorCode")).isEqualTo("NO_APPROVER_AVAILABLE");
        assertThat(requestCount(T4, applicant)).isZero();   // rolled back / never persisted
    }
}
