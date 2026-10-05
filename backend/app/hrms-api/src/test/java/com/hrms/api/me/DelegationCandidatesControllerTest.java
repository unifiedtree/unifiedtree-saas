package com.hrms.api.me;

import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchHit;
import com.hrms.employee.workforce.dto.EmployeeSearchDtos.EmployeeSearchResponse;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.server.ResponseStatusException;

import java.lang.reflect.Method;
import java.lang.reflect.RecordComponent;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The approval-delegation colleague picker (GET /v1/approvals/delegation/candidates):
 * who may call it, which workspace and which people it reads, and that only the six
 * picker fields can come back.
 */
class DelegationCandidatesControllerTest {

    private static final UUID TENANT_A = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID TENANT_B = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID ME = UUID.fromString("44444444-4444-4444-4444-444444444444");

    @AfterEach
    void clearTenant() {
        TenantContext.clear();
    }

    // ── who may call it ──────────────────────────────────────────────────────

    @Test
    void theGateIsExactlyTheOneThatLetsSomeoneSetADelegation() throws Exception {
        String create = guard(ApprovalDelegationController.class.getMethod("create",
                ApprovalDelegationController.CreateRequest.class, Jwt.class));
        String candidates = guard(candidatesMethod());
        assertEquals(create, candidates);
        assertEquals("isAuthenticated()", candidates);
        assertFalse(candidates.contains("hrms.employee.read"), "the picker must not need the directory permission");
        assertNotNull(ApprovalDelegationController.class.getMethod("create",
                ApprovalDelegationController.CreateRequest.class, Jwt.class).getAnnotation(PostMapping.class));
    }

    @Test
    void aDeptManagerWithoutTheDirectoryPermissionGetsInAndAnAnonymousCallerDoesNot() throws Exception {
        String g = guard(candidatesMethod());
        // DEPT_MANAGER's codes today: approvals, team management; no hrms.employee.read.
        Set<String> deptManager = Set.of("hrms.leave.approve.l1", "wfh.approve", "hrms.employee.team.manage",
                "attendance.regularization.approve", "hrms.expense.claim.approve");
        assertTrue(allows(g, true, deptManager));
        // MANAGER and EMPLOYEE (they may set a delegation too, so they may pick a delegate).
        assertTrue(allows(g, true, Set.of("attendance.overtime.approve", "attendance.team.read")));
        assertTrue(allows(g, true, Set.of("leave.request.self")));
        // Not signed in: refused, whatever codes are claimed.
        assertFalse(allows(g, false, Set.of("hrms.employee.read")));
        assertFalse(allows(g, false, Set.of()));
    }

    @Test
    void itLivesAtTheApprovalsDelegationCandidatesPath() throws Exception {
        assertArrayEquals(new String[]{"/v1/approvals/delegation"},
                DelegationCandidatesController.class.getAnnotation(RequestMapping.class).value());
        assertArrayEquals(new String[]{"/candidates"}, candidatesMethod().getAnnotation(GetMapping.class).value());
    }

    // ── which workspace ──────────────────────────────────────────────────────

    @Test
    void everyTableIsFencedByTheCallersWorkspace() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        new DelegationCandidatesController(jdbc).candidates("as", 10, jwt(ME));

        String sql = jdbc.sql;
        assertTrue(sql.contains("WHERE e.tenant_id = ?"), sql);
        assertTrue(sql.contains("d.tenant_id = ?"), sql);
        assertTrue(sql.contains("g.tenant_id = ?"), sql);
        assertTrue(sql.contains("u.tenant_id = ?"), sql);
        assertTrue(sql.contains("m.tenant_id = e.tenant_id"), sql);
        assertEquals(4, jdbc.args.stream().filter(TENANT_A::equals).count(), jdbc.args.toString());
        assertEquals(placeholders(sql), jdbc.args.size(), "every ? has its value");
    }

    @Test
    void anotherWorkspacesCallerReadsOnlyTheirOwnWorkspace() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_B);
        new DelegationCandidatesController(jdbc).candidates("as", 10, jwt(ME));
        assertEquals(4, jdbc.args.stream().filter(TENANT_B::equals).count());
        assertFalse(jdbc.args.contains(TENANT_A), "workspace A is never asked for from workspace B");
    }

    @Test
    void noWorkspaceOnTheThreadMeansNoQuery() {
        Capture jdbc = new Capture(List.of());
        assertThrows(IllegalStateException.class,
                () -> new DelegationCandidatesController(jdbc).candidates("as", 10, jwt(ME)));
        assertNull(jdbc.sql);
    }

    // ── which people ─────────────────────────────────────────────────────────

    @Test
    void theCallerIsLeftOut() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        new DelegationCandidatesController(jdbc).candidates("de", 10, jwt(ME));
        assertTrue(jdbc.sql.contains("AND e.id <> ?"));
        assertEquals(ME, jdbc.args.get(4), "the caller's employee id is the one excluded");
    }

    @Test
    void peopleWhoLeftAreSuspendedOrRemovedAreLeftOut() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        new DelegationCandidatesController(jdbc).candidates("de", 10, jwt(ME));
        String sql = jdbc.sql;
        assertTrue(sql.contains("AND e.is_active = TRUE"), sql);
        assertTrue(sql.contains("e.employment_status NOT IN (?, ?, ?, ?, ?)"), sql);
        assertTrue(jdbc.args.containsAll(List.of("EXITED", "TERMINATED", "SUSPENDED", "RESIGNED", "RETIRED")));
        // The statuses ApprovalDelegationController.create refuses are all among them.
        assertTrue(DelegationCandidatesController.EXCLUDED_STATUSES.containsAll(List.of("EXITED", "TERMINATED", "SUSPENDED")));
        // Working people stay in.
        for (String working : List.of("ACTIVE", "PROBATION", "NOTICE_PERIOD", "ON_LEAVE")) {
            assertFalse(jdbc.args.contains(working), working);
        }
    }

    @Test
    void onlyPeopleWithAnActiveLoginAreListed() {
        String sql = DelegationCandidatesController.sql(0);
        assertTrue(sql.contains("EXISTS (SELECT 1 FROM auth.user_credentials u"), sql);
        assertTrue(sql.contains("u.employee_id = e.id AND u.is_active = TRUE"), sql);
    }

    @Test
    void matchingIsByPrefixOfNameCodeOrEmailAndCaseInsensitive() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        new DelegationCandidatesController(jdbc).candidates("  ReA  ", 10, jwt(ME));
        String sql = jdbc.sql;
        for (String col : List.of("lower(e.first_name) LIKE ?", "lower(coalesce(e.last_name, '')) LIKE ?",
                "lower(concat_ws(' ', e.first_name, e.last_name)) LIKE ?", "lower(e.employee_code) LIKE ?",
                "lower(coalesce(e.email, '')) LIKE ?", "lower(m.email) LIKE ?")) {
            assertTrue(sql.contains(col), col);
        }
        assertEquals(6, jdbc.args.stream().filter("rea%"::equals).count(), "trimmed, lower-cased, prefix");
        assertFalse(jdbc.args.contains("%rea%"), "a prefix match, not anywhere in the text");
    }

    @Test
    void eachWordOfATwoWordQueryMatchesTheStartOfAName() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        new DelegationCandidatesController(jdbc).candidates("dep man", 10, jwt(ME));
        assertTrue(jdbc.args.contains("dep%"));
        assertTrue(jdbc.args.contains("man%"));
        assertEquals(placeholders(jdbc.sql), jdbc.args.size());
        // The placeholders line up for every word count.
        for (int n = 0; n <= 6; n++) {
            List<String> words = IntStream.range(0, n).mapToObj(i -> "w" + i).toList();
            List<String> tokens = DelegationCandidatesController.tokens(String.join(" ", words));
            assertEquals(placeholders(DelegationCandidatesController.sql(tokens.size())),
                    DelegationCandidatesController.args(TENANT_A, ME, "q", tokens, 5).size(), n + " words");
        }
    }

    @Test
    void typedWildcardsAreMatchedLiterally() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        new DelegationCandidatesController(jdbc).candidates("a%_", 10, jwt(ME));
        assertTrue(jdbc.args.contains("a\\%\\_%"), jdbc.args.toString());
    }

    @Test
    void aQueryUnderTwoCharactersIsRefusedWithoutAQuery() {
        Capture jdbc = new Capture(List.of());
        TenantContext.setTenantId(TENANT_A);
        DelegationCandidatesController c = new DelegationCandidatesController(jdbc);
        for (String q : List.of("", " ", "a", "  b  ")) {
            ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> c.candidates(q, 10, jwt(ME)));
            assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
        }
        assertNull(jdbc.sql);
    }

    @Test
    void theLimitIsClampedToTwentyAndOneExtraRowSaysThereAreMore() {
        TenantContext.setTenantId(TENANT_A);
        List<EmployeeSearchHit> many = IntStream.range(0, 21).mapToObj(i -> hit("P" + i)).toList();
        Capture jdbc = new Capture(many);
        EmployeeSearchResponse r = new DelegationCandidatesController(jdbc).candidates("pe", 500, jwt(ME));
        assertEquals(21, jdbc.args.get(jdbc.args.size() - 1), "asks for one past the page");
        assertEquals(20, r.limit());
        assertEquals(20, r.employees().size());
        assertTrue(r.truncated());

        Capture few = new Capture(List.of(hit("A"), hit("B")));
        EmployeeSearchResponse small = new DelegationCandidatesController(few).candidates("pe", 0, jwt(ME));
        assertEquals(1, small.limit());
        assertEquals(1, small.employees().size());
        assertTrue(small.truncated());

        Capture exact = new Capture(List.of(hit("A")));
        EmployeeSearchResponse one = new DelegationCandidatesController(exact).candidates("pe", 10, jwt(ME));
        assertEquals(10, one.limit());
        assertFalse(one.truncated());
    }

    // ── what comes back ──────────────────────────────────────────────────────

    @Test
    void aHitCarriesTheSixPickerFieldsAndNothingElse() {
        List<String> fields = Arrays.stream(EmployeeSearchHit.class.getRecordComponents())
                .map(RecordComponent::getName).toList();
        assertEquals(List.of("id", "displayName", "employeeCode", "departmentName", "jobTitle", "profilePhotoUrl"), fields);
    }

    @Test
    void theStatementSelectsOnlyThePickerColumns() {
        String sql = DelegationCandidatesController.sql(2);
        String select = sql.substring(sql.indexOf("SELECT") + 6, sql.indexOf("FROM hrms.employees")).replaceAll("\\s+", " ").trim();
        assertEquals("e.id, e.first_name, e.last_name, e.employee_code, e.profile_photo_url, "
                + "d.name AS department_name, g.title AS job_title", select);
        String lower = sql.toLowerCase(Locale.ROOT);
        for (String secret : List.of("ctc", "salary", "bank", "pan_number", "aadhaar", "passport", "pf_uan", "esi_number",
                "phone", "date_of_birth", "address", "emergency", "personal_email", "gender", "marital", "blood",
                "face_", "password", "mfa", "tax_regime")) {
            assertFalse(lower.contains(secret), "the statement must not touch " + secret);
        }
    }

    @Test
    void aRowBecomesAHitWithTheFullName() throws Exception {
        UUID id = UUID.randomUUID();
        ResultSet rs = mock(ResultSet.class);
        when(rs.getObject("id", UUID.class)).thenReturn(id);
        when(rs.getString("first_name")).thenReturn(" Reader ");
        when(rs.getString("last_name")).thenReturn(null);
        when(rs.getString("employee_code")).thenReturn("EMP002");
        when(rs.getString("department_name")).thenReturn("Engineering");
        when(rs.getString("job_title")).thenReturn("Analyst");
        when(rs.getString("profile_photo_url")).thenReturn("https://cdn/x.png");
        EmployeeSearchHit h = DelegationCandidatesController.ROW.mapRow(rs, 0);
        assertEquals(new EmployeeSearchHit(id, "Reader", "EMP002", "Engineering", "Analyst", "https://cdn/x.png"), h);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Method candidatesMethod() throws NoSuchMethodException {
        return DelegationCandidatesController.class.getMethod("candidates", String.class, int.class, Jwt.class);
    }

    private static String guard(Method m) {
        PreAuthorize p = m.getAnnotation(PreAuthorize.class);
        assertNotNull(p, m.getName() + " has no @PreAuthorize");
        return p.value();
    }

    private static long placeholders(String sql) {
        return sql.chars().filter(ch -> ch == '?').count();
    }

    private static EmployeeSearchHit hit(String name) {
        return new EmployeeSearchHit(UUID.randomUUID(), name, "C-" + name, null, null, null);
    }

    private static Jwt jwt(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", employeeId.toString())
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
    }

    private static boolean allows(String expression, boolean signedIn, Set<String> held) {
        StandardEvaluationContext ctx = new StandardEvaluationContext(new Root(signedIn, held));
        Boolean ok = new SpelExpressionParser().parseExpression(expression).getValue(ctx, Boolean.class);
        return Boolean.TRUE.equals(ok);
    }

    /** The parts of Spring Security's expression root a guard here could use. */
    public static final class Root {
        private final boolean signedIn;
        private final Set<String> held;
        Root(boolean signedIn, Set<String> held) { this.signedIn = signedIn; this.held = held; }
        public boolean isAuthenticated() { return signedIn; }
        public boolean hasAuthority(String code) { return signedIn && held.contains(code); }
        public boolean hasAnyAuthority(String... codes) { return signedIn && Arrays.stream(codes).anyMatch(held::contains); }
    }

    /** Records the statement and its values, and answers with fixed rows. */
    private static final class Capture extends JdbcTemplate {
        private final List<EmployeeSearchHit> rows;
        String sql;
        List<Object> args;

        Capture(List<EmployeeSearchHit> rows) { this.rows = rows; }

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            this.sql = sql;
            this.args = new ArrayList<>(Arrays.asList(args));
            return (List<T>) new ArrayList<>(rows);
        }
    }
}
