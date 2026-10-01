package com.hrms.api.workforce;

import com.hrms.api.workforce.OrgChartScope.Link;
import com.hrms.api.workforce.OrgChartService.Card;
import com.hrms.api.workforce.OrgChartService.OrgChart;
import com.hrms.api.workforce.OrgChartService.Person;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * GET /v1/hrms/org-chart: who sees what (the whole company with
 * hrms.employee.read, else the caller's own line and everyone below them),
 * where the status shows, which company is shown, and that a missing table
 * answers FEATURE_NOT_READY instead of an error. Every query is tenant-filtered.
 */
class OrgChartServiceTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CO = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static final UUID CO2 = UUID.fromString("cccccccc-cccc-cccc-cccc-000000000002");

    private static final UUID OWNER = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID MGR = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID READER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID INTERN = UUID.fromString("66666666-6666-6666-6666-666666666666");
    private static final UUID FIN = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID OTHER = UUID.fromString("77777777-7777-7777-7777-777777777777");

    private JdbcTemplate jdbc;
    private PermissionChecker perm;
    private OrgChartService service;
    /** The card ids each cards query asked for. */
    private final List<String> cardRequests = new ArrayList<>();

    private final List<Link> people = new ArrayList<>(List.of(
            new Link(OWNER, null, CO, "Admin User"),
            new Link(MGR, OWNER, CO, "Dept Manager"),
            new Link(READER, MGR, CO, "Reader User"),
            new Link(INTERN, READER, CO, "Intern One"),
            new Link(FIN, OWNER, CO, "Finance Lead"),
            new Link(OTHER, null, CO2, "Other Company")));

    private final Map<UUID, Card> cards = new LinkedHashMap<>(Map.of(
            OWNER, new Card("Admin User", "HR Manager", null, null, null, "ACTIVE"),
            MGR, new Card("Dept Manager", "Engineering Manager", "Engineering", "Head office", "https://cdn.example/m.png", "NOTICE_PERIOD"),
            READER, new Card("Reader User", "Software Engineer", "Engineering", "Head office", null, "ACTIVE"),
            INTERN, new Card("Intern One", "Intern", "Engineering", null, null, "PROBATION"),
            FIN, new Card("Finance Lead", "Finance Lead", "Finance", null, null, "SUSPENDED"),
            OTHER, new Card("Other Company", null, null, null, null, "ACTIVE")));

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        TenantContext.setTenantId(TENANT);
        jdbc = mock(JdbcTemplate.class);
        perm = mock(PermissionChecker.class);
        service = new OrgChartService(jdbc, perm);
        when(jdbc.query(contains("e.employment_status NOT IN ('EXITED', 'TERMINATED')"), any(RowMapper.class), eq(TENANT)))
                .thenAnswer(inv -> new ArrayList<>(people));
        when(jdbc.query(contains("FROM org.companies c WHERE c.tenant_id = ? AND c.id = ?"), any(RowMapper.class), eq(TENANT), eq(CO)))
                .thenReturn(List.of("UnifiedTree Demo Corp"));
        when(jdbc.query(contains("FROM org.companies c WHERE c.tenant_id = ? AND c.id = ?"), any(RowMapper.class), eq(TENANT), eq(CO2)))
                .thenReturn(List.of("Second Co"));
        when(jdbc.query(contains("ORDER BY c.is_active DESC"), any(RowMapper.class), eq(TENANT)))
                .thenReturn(List.of(Map.entry(CO2, "Second Co")));
        when(jdbc.query(contains("LEFT JOIN org.branches"), any(RowMapper.class), eq(TENANT), anyString())).thenAnswer(inv -> {
            String ids = inv.getArgument(3);
            cardRequests.add(ids);
            List<Map.Entry<UUID, Card>> rows = new ArrayList<>();
            for (String s : ids.substring(1, ids.length() - 1).split(",")) {
                if (s.isBlank()) continue;
                UUID u = UUID.fromString(s);
                if (cards.containsKey(u)) rows.add(Map.entry(u, cards.get(u)));
            }
            return rows;
        });
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private static Authentication auth(String... permissions) {
        return new UsernamePasswordAuthenticationToken("u", null, Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList());
    }

    private static Jwt token(UUID employeeId) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString());
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    private static Person person(OrgChart c, UUID id) {
        return c.people().stream().filter(p -> p.id().equals(id)).findFirst().orElseThrow();
    }

    private static List<UUID> ids(OrgChart c) {
        return c.people().stream().map(Person::id).toList();
    }

    // ── who sees what ─────────────────────────────────────────────────────

    @Test
    void anOwnerWithEmployeeReadSeesTheWholeCompanyTree() {
        OrgChart c = service.chart(CO, token(OWNER), auth("hrms.employee.read"));
        assertThat(c.scope()).isEqualTo("COMPANY");
        assertThat(c.companyId()).isEqualTo(CO);
        assertThat(c.companyName()).isEqualTo("UnifiedTree Demo Corp");
        assertThat(c.viewerEmployeeId()).isEqualTo(OWNER);
        assertThat(ids(c)).containsExactlyInAnyOrder(OWNER, MGR, READER, INTERN, FIN).doesNotContain(OTHER);
        assertThat(person(c, OWNER).parentId()).isNull();
        assertThat(person(c, MGR).parentId()).isEqualTo(OWNER);
        assertThat(person(c, READER).parentId()).isEqualTo(MGR);
        assertThat(person(c, OWNER).directReports()).isEqualTo(2);
        assertThat(person(c, MGR).directReports()).isEqualTo(1);
        // Everyone's record is open to them, so every status shows.
        assertThat(c.people()).allSatisfy(p -> {
            assertThat(p.canViewRecord()).isTrue();
            assertThat(p.status()).isNotNull();
        });
        assertThat(person(c, MGR).designation()).isEqualTo("Engineering Manager");
        assertThat(person(c, MGR).department()).isEqualTo("Engineering");
        assertThat(person(c, MGR).location()).isEqualTo("Head office");
        assertThat(person(c, MGR).photoUrl()).isEqualTo("https://cdn.example/m.png");
    }

    @Test
    void anEmployeeSeesTheirManagerAndTheChainToTheTopAndNobodyUnrelated() {
        OrgChart c = service.chart(null, token(READER), auth("attendance.checkin.self", "hrms.ess.read"));
        assertThat(c.scope()).isEqualTo("TEAM");
        assertThat(c.companyId()).isEqualTo(CO);
        assertThat(ids(c)).containsExactly(OWNER, MGR, READER, INTERN);   // top first, down to the reader, then below
        assertThat(ids(c)).doesNotContain(FIN, OTHER);
        assertThat(person(c, READER).relation()).isEqualTo("SELF");
        assertThat(person(c, MGR).relation()).isEqualTo("ABOVE");
        assertThat(person(c, INTERN).relation()).isEqualTo("BELOW");
        assertThat(person(c, READER).parentId()).isEqualTo(MGR);
        // Only the people on the chart are read (no card for unrelated people).
        assertThat(String.join("", cardRequests)).doesNotContain(FIN.toString()).doesNotContain(OTHER.toString());
    }

    @Test
    void theStatusShowsOnlyWhereTheViewerMayOpenTheRecord() {
        OrgChart c = service.chart(null, token(READER), auth("hrms.ess.read"));
        // Their own record: yes. Their manager on notice, and their own report, not to an employee without team rights.
        assertThat(person(c, READER).status()).isEqualTo("ACTIVE");
        assertThat(person(c, READER).canViewRecord()).isTrue();
        assertThat(person(c, MGR).status()).isNull();
        assertThat(person(c, MGR).canViewRecord()).isFalse();
        assertThat(person(c, INTERN).status()).isNull();
        // Public fields stay.
        assertThat(person(c, MGR).designation()).isEqualTo("Engineering Manager");
        assertThat(person(c, MGR).directReports()).isEqualTo(1);
    }

    @Test
    void aManagerWithTeamRightsSeesTheirDirectReportsStatusButNotFurtherDown() {
        OrgChart c = service.chart(null, token(MGR), auth("hrms.employee.team.manage", "attendance.team.read"));
        assertThat(c.scope()).isEqualTo("TEAM");
        assertThat(ids(c)).containsExactly(OWNER, MGR, READER, INTERN);
        assertThat(person(c, READER).relation()).isEqualTo("BELOW");
        assertThat(person(c, READER).canViewRecord()).isTrue();
        assertThat(person(c, READER).status()).isEqualTo("ACTIVE");
        // Only the direct manager may open a record: not the intern under the reader, not their own manager.
        assertThat(person(c, INTERN).canViewRecord()).isFalse();
        assertThat(person(c, INTERN).status()).isNull();
        assertThat(person(c, OWNER).canViewRecord()).isFalse();
        // Their own status (on notice) shows to them.
        assertThat(person(c, MGR).status()).isEqualTo("NOTICE_PERIOD");
    }

    @Test
    void teamRightsHeldOnlyInTheDatabaseCountLikeTheRecordEndpoint() {
        when(perm.check("hrms.employee.team.manage")).thenReturn(true);
        OrgChart c = service.chart(null, token(MGR), auth("attendance.team.read"));
        assertThat(person(c, READER).canViewRecord()).isTrue();
    }

    @Test
    void theCompanyAskedForIsAnyCompanyOfTheWorkspaceElseTheCallersOwnElseTheFirst() {
        assertThat(service.chart(CO2, token(OWNER), auth("hrms.employee.read")).people()).extracting(Person::id).containsExactly(OTHER);
        assertThat(service.chart(null, token(OWNER), auth("hrms.employee.read")).companyId()).isEqualTo(CO);
        // No employee record: the workspace's first company.
        OrgChart none = service.chart(null, token(null), auth("hrms.employee.read"));
        assertThat(none.companyId()).isEqualTo(CO2);
        assertThat(none.viewerEmployeeId()).isNull();
    }

    @Test
    void aCompanyOutsideTheWorkspaceIsRefused() {
        UUID elsewhere = UUID.randomUUID();
        when(jdbc.query(contains("FROM org.companies c WHERE c.tenant_id = ? AND c.id = ?"), any(RowMapper.class), eq(TENANT), eq(elsewhere)))
                .thenReturn(List.of());
        assertThatThrownBy(() -> service.chart(elsewhere, token(OWNER), auth("hrms.employee.read")))
                .isInstanceOf(BusinessRuleException.class)
                .hasMessageContaining("isn’t in this workspace");
    }

    @Test
    void withoutEmployeeReadTheCompanyAskedForIsIgnored() {
        OrgChart c = service.chart(CO2, token(READER), auth("hrms.ess.read"));
        assertThat(c.scope()).isEqualTo("TEAM");
        assertThat(ids(c)).doesNotContain(OTHER);
    }

    @Test
    void aLoginWithoutAnEmployeeRecordAndWithoutEmployeeReadGetsAnEmptyChart() {
        OrgChart c = service.chart(null, token(null), auth("hrms.ess.read"));
        assertThat(c.scope()).isEqualTo("TEAM");
        assertThat(c.people()).isEmpty();
        assertThat(c.viewerEmployeeId()).isNull();
        assertThat(cardRequests).isEmpty();
    }

    @Test
    void someoneWhoLeftIsNotOnTheChartAndTheirReportsHangAtTheTop() {
        // The service reads active people only; a manager who left is simply not among them.
        people.removeIf(l -> l.id().equals(MGR));
        OrgChart c = service.chart(CO, token(OWNER), auth("hrms.employee.read"));
        assertThat(ids(c)).doesNotContain(MGR);
        assertThat(person(c, READER).parentId()).isNull();
        assertThat(person(c, READER).note()).isEqualTo("MANAGER_NOT_SHOWN");
    }

    @Test
    void aReportingLoopIsCutAndMarked() {
        people.removeIf(l -> l.id().equals(OWNER));
        people.add(new Link(OWNER, FIN, CO, "Admin User"));          // Admin → Finance → Admin
        OrgChart c = service.chart(CO, token(OWNER), auth("hrms.employee.read"));
        assertThat(ids(c)).containsExactlyInAnyOrder(OWNER, MGR, READER, INTERN, FIN);
        assertThat(c.people().stream().filter(p -> "CYCLE".equals(p.note())).map(Person::id)).containsExactly(OWNER);
        assertThat(person(c, OWNER).parentId()).isNull();
    }

    // ── safety ────────────────────────────────────────────────────────────

    @Test
    void aMissingTableAnswersFeatureNotReady() {
        BadSqlGrammarException missing = new BadSqlGrammarException("org chart", "SELECT …",
                new SQLException("relation \"hrms.employees\" does not exist", "42P01"));
        when(jdbc.query(contains("e.employment_status NOT IN ('EXITED', 'TERMINATED')"), any(RowMapper.class), eq(TENANT)))
                .thenThrow(missing);
        assertThatThrownBy(() -> service.chart(null, token(READER), auth("hrms.ess.read"))).isInstanceOf(FeatureNotReady.class);
    }

    @Test
    void aMissingColumnInTheCardQueryAnswersFeatureNotReady() {
        BadSqlGrammarException missing = new BadSqlGrammarException("org chart", "SELECT …",
                new SQLException("column e.job_title does not exist", "42703"));
        when(jdbc.query(contains("LEFT JOIN org.branches"), any(RowMapper.class), eq(TENANT), anyString())).thenThrow(missing);
        assertThatThrownBy(() -> service.chart(CO, token(OWNER), auth("hrms.employee.read"))).isInstanceOf(FeatureNotReady.class);
    }

    @Test
    void otherDatabaseErrorsAreNotHidden() {
        BadSqlGrammarException syntax = new BadSqlGrammarException("org chart", "SELECT …", new SQLException("syntax error", "42601"));
        when(jdbc.query(contains("e.employment_status NOT IN ('EXITED', 'TERMINATED')"), any(RowMapper.class), eq(TENANT)))
                .thenThrow(syntax);
        assertThatThrownBy(() -> service.chart(null, token(READER), auth("hrms.ess.read"))).isSameAs(syntax);
    }

    @Test
    void everyQueryIsFilteredByTheTenant() {
        service.chart(CO, token(OWNER), auth("hrms.employee.read"));
        verify(jdbc).query(contains("WHERE e.tenant_id = ? AND e.is_active = TRUE"), any(RowMapper.class), eq(TENANT));
        verify(jdbc).query(contains("WHERE e.tenant_id = ? AND e.id = ANY"), any(RowMapper.class), eq(TENANT), anyString());
        verify(jdbc).query(contains("WHERE c.tenant_id = ? AND c.id = ?"), any(RowMapper.class), eq(TENANT), eq(CO));
        verify(jdbc, never()).query(contains("ORDER BY c.is_active DESC"), any(RowMapper.class), any());
    }

    // ── small rules ───────────────────────────────────────────────────────

    @Test
    void onlyWebAddressesAreShownAsPhotos() {
        assertThat(OrgChartService.photo("https://cdn.example/a.png")).isEqualTo("https://cdn.example/a.png");
        assertThat(OrgChartService.photo(" http://x/y.jpg ")).isEqualTo("http://x/y.jpg");
        assertThat(OrgChartService.photo("javascript:alert(1)")).isNull();
        assertThat(OrgChartService.photo("avatars/123.png")).isNull();
        assertThat(OrgChartService.photo(null)).isNull();
    }

    @Test
    void namesAreFirstAndLastName() {
        assertThat(OrgChartService.fullName(" Asha ", "Rao")).isEqualTo("Asha Rao");
        assertThat(OrgChartService.fullName("Asha", null)).isEqualTo("Asha");
        assertThat(OrgChartService.fullName(" ", null)).isEqualTo("Employee");
    }

    @Test
    void theEndpointIsOpenToEveryoneSignedInUnderTheHrmsPath() throws Exception {
        var method = OrgChartController.class.getMethod("chart", UUID.class, Jwt.class, Authentication.class);
        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("isAuthenticated()");
        assertThat(method.getAnnotation(GetMapping.class)).isNotNull();
        // Under /v1/hrms, which TenantModuleGuard already ties to the HRMS module.
        assertThat(OrgChartController.class.getAnnotation(RequestMapping.class).value()).containsExactly("/v1/hrms/org-chart");
    }
}
