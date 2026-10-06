package com.unifiedtree.security.tenant;

import com.hrms.api.attendance.ApproverPath;
import com.hrms.api.leave.ApproverFallbackResolver;
import com.hrms.api.team.PermissionHolders;
import com.unifiedtree.notifications.service.NotificationLookupService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Company access, part 3 (COMPANY_ACCESS.md "Who is told"): a person granted a
 * role in a company counts as a holder of it — and of its permissions — for
 * that company's people in the approver and alert lookups, and before the
 * grants table exists every lookup is exactly what it was.
 */
class CompanyGrantLookupsTest {

    private static final UUID HR_ROLE = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID ADMIN_ROLE = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), applicant = UUID.randomUUID(),
            grantee = UUID.randomUUID(), hr = UUID.randomUUID();
    private JdbcTemplate jdbc;
    private final List<String> sqls = new ArrayList<>();
    private final List<List<Object>> argsOf = new ArrayList<>();

    @BeforeEach
    void setUp() {
        CompanyGrants.reset();
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
    }

    @AfterEach
    void clear() {
        CompanyGrants.reset();   // the cache is static: never leak "ready" into other tests
        TenantContext.clear();
    }

    private void grantsTable(boolean present) {
        when(jdbc.queryForObject(contains("to_regclass('rbac.user_company_access')"), eq(Boolean.class))).thenReturn(present);
        when(jdbc.queryForObject(contains("to_regclass('rbac.user_permission_overrides')"), eq(Boolean.class))).thenReturn(true);
    }

    private void applicantIn(UUID companyId) {
        when(jdbc.queryForList(eq("SELECT company_id FROM hrms.employees WHERE id = ?"), eq(UUID.class), any(Object[].class)))
                .thenReturn(companyId == null ? List.of() : List.of(companyId));
    }

    /** Records every single-row lookup and answers {@code first}. */
    private void roleHolderAnswers(UUID first) {
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(inv -> {
            record(inv);
            ResultSet rs = mock(ResultSet.class);
            when(rs.next()).thenReturn(first != null);
            when(rs.getObject(1, UUID.class)).thenReturn(first);
            return ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs);
        });
    }

    private void record(InvocationOnMock inv) {
        Object[] all = inv.getArguments();
        sqls.add((String) all[0]);
        argsOf.add(Arrays.asList(all).subList(2, all.length));
    }

    // ── the shared helpers ─────────────────────────────────────────────────

    @Test
    void beforeTheGrantsTableExistsTheRoleHolderIsTheSameQueryAsAlways() {
        grantsTable(false);
        roleHolderAnswers(hr);
        assertEquals(hr, CompanyGrants.firstRoleHolder(jdbc, tenant, HR_ROLE, company, applicant));
        assertEquals(1, sqls.size());
        assertFalse(sqls.get(0).contains("user_company_access"));
        assertEquals(List.of(tenant, HR_ROLE, applicant), argsOf.get(0));
    }

    @Test
    void withGrantsTheRoleHolderIsTheLongestServingAcrossRolesAndTheCompanysGrants() {
        grantsTable(true);
        roleHolderAnswers(grantee);
        assertEquals(grantee, CompanyGrants.firstRoleHolder(jdbc, tenant, HR_ROLE, company, applicant));
        String sql = sqls.get(0);
        assertTrue(sql.contains("FROM rbac.user_roles ur"), sql);
        assertTrue(sql.contains("UNION ALL"), sql);
        assertTrue(sql.contains("FROM rbac.user_company_access a"), sql);
        assertTrue(sql.contains("ORDER BY created_at LIMIT 1"), sql);
        assertEquals(List.of(tenant, HR_ROLE, applicant, tenant, company, HR_ROLE, applicant), argsOf.get(0));
        // No company known: the old query.
        sqls.clear();
        argsOf.clear();
        CompanyGrants.firstRoleHolder(jdbc, tenant, HR_ROLE, null, null);
        assertFalse(sqls.get(0).contains("user_company_access"));
        assertEquals(List.of(tenant, HR_ROLE), argsOf.get(0));
    }

    @Test
    void withTheKillSwitchOffGrantsCountNowhere() {
        grantsTable(true);
        roleHolderAnswers(hr);
        CompanyGrants.enabled(false);
        assertFalse(CompanyGrants.ready(jdbc));
        assertEquals(hr, CompanyGrants.firstRoleHolder(jdbc, tenant, HR_ROLE, company, null));
        assertFalse(sqls.get(0).contains("user_company_access"));
        assertEquals(List.of(), CompanyGrants.employeesGrantedPermission(jdbc, tenant, "x.read", company));
        assertEquals(List.of(), new PermissionHolders(jdbc).employeesGranted(tenant, "x.read", company));
    }

    @Test
    void aFailedGrantReadFallsBackToTheRoleHolderAsBefore() {
        grantsTable(true);
        when(jdbc.query(contains("UNION ALL"), any(ResultSetExtractor.class), any(Object[].class)))
                .thenThrow(new DataAccessResourceFailureException("no"));
        when(jdbc.query(argThat((String s) -> s != null && !s.contains("UNION ALL")), any(ResultSetExtractor.class), any(Object[].class)))
                .thenReturn(hr);
        assertEquals(hr, CompanyGrants.firstRoleHolder(jdbc, tenant, HR_ROLE, company, null));
    }

    @Test
    void permissionGranteesAreOnlyReadWithACompanyAndTheTable() {
        assertEquals(List.of(), CompanyGrants.employeesGrantedPermission(jdbc, tenant, "x.read", company));
        grantsTable(true);
        assertEquals(List.of(), CompanyGrants.employeesGrantedPermission(jdbc, tenant, "x.read", null));
        when(jdbc.queryForList(contains("FROM rbac.user_company_access a"), eq(UUID.class), any(Object[].class)))
                .thenAnswer(inv -> { record(inv); return List.of(grantee); });
        assertEquals(List.of(grantee), CompanyGrants.employeesGrantedPermission(jdbc, tenant, "x.read", company));
        assertTrue(sqls.get(0).contains("rp.permission_code = ?"));
        assertTrue(sqls.get(0).contains("o.effect = 'DENY'"), "a per-person denial still wins");
        assertTrue(sqls.get(0).contains("employment_status NOT IN"));
        assertEquals(List.of(tenant, company, "x.read", "x.read"), argsOf.get(0));

        CompanyGrants.employeesGrantedRole(jdbc, tenant, List.of(HR_ROLE, ADMIN_ROLE), company);
        assertTrue(sqls.get(1).contains("a.role_id = ANY(CAST(? AS uuid[]))"));
        assertEquals(List.of(tenant, company, "{" + HR_ROLE + "," + ADMIN_ROLE + "}"), argsOf.get(1));
    }

    // ── the leave / WFH terminal approver ──────────────────────────────────

    @Test
    void theLeaveFallbackCountsAnHrManagerGrantedInTheApplicantsCompany() {
        grantsTable(true);
        applicantIn(company);
        roleHolderAnswers(grantee);
        ApproverFallbackResolver resolver = new ApproverFallbackResolver(jdbc);
        assertEquals(Optional.of(grantee), resolver.resolveTerminalApprover(tenant, applicant));
        assertTrue(sqls.get(0).contains("user_company_access"));
        assertEquals(List.of(tenant, HR_ROLE, applicant, tenant, company, HR_ROLE, applicant), argsOf.get(0));
    }

    @Test
    void withoutGrantsTheLeaveFallbackIsUnchanged() {
        grantsTable(false);
        roleHolderAnswers(hr);
        assertEquals(Optional.of(hr), new ApproverFallbackResolver(jdbc).resolveTerminalApprover(tenant, applicant));
        assertFalse(sqls.get(0).contains("user_company_access"));
        assertEquals(List.of(tenant, HR_ROLE, applicant), argsOf.get(0));
        verify(jdbc, never()).queryForList(contains("hrms.employees"), eq(UUID.class), any(Object[].class));
    }

    // ── the notification lookups ───────────────────────────────────────────

    @Test
    void theNotificationLookupForAPersonCountsGrantsInTheirCompany() {
        NotificationLookupService lookup = new NotificationLookupService(jdbc);
        grantsTable(false);
        roleHolderAnswers(hr);
        assertEquals(hr, lookup.firstEmployeeWithRole(tenant, HR_ROLE, applicant));
        assertFalse(sqls.get(0).contains("user_company_access"), "before the table: as the two-argument lookup");

        CompanyGrants.reset();
        sqls.clear();
        grantsTable(true);
        applicantIn(company);
        assertEquals(hr, lookup.firstEmployeeWithRole(tenant, HR_ROLE, applicant));
        assertTrue(sqls.get(0).contains("user_company_access"));
        assertTrue(argsOf.get(argsOf.size() - 1).contains(company));
    }

    // ── who a request goes to, in lists ────────────────────────────────────

    @Test
    void theApproverShownForARequestUsesTheRequestersCompanysGrants() {
        grantsTable(true);
        UUID otherCompany = UUID.randomUUID(), other = UUID.randomUUID();
        // Neither requester has a manager or a department head.
        doAnswer(inv -> {
            RowCallbackHandler h = inv.getArgument(1);
            for (Object[] row : new Object[][] {{applicant, company}, {other, otherCompany}}) {
                ResultSet rs = mock(ResultSet.class);
                when(rs.getObject("id")).thenReturn(row[0]);
                when(rs.getObject("company_id")).thenReturn(row[1]);
                when(rs.getObject("approver")).thenReturn(null);
                h.processRow(rs);
            }
            return null;
        }).when(jdbc).query(contains("FROM hrms.employees e"), any(RowCallbackHandler.class), any(Object[].class));
        when(jdbc.query(contains("UNION ALL"), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(inv -> {
            record(inv);
            List<Object> args = Arrays.asList(inv.getArguments()).subList(2, inv.getArguments().length);
            boolean hrRole = HR_ROLE.equals(args.get(1));
            return hrRole && args.contains(company) ? grantee : hrRole ? hr : null;
        });

        Map<UUID, UUID> goesTo = new ApproverPath(jdbc).approversOf(List.of(applicant, other));
        assertEquals(grantee, goesTo.get(applicant), "company A's HR manager by grant");
        assertEquals(hr, goesTo.get(other), "the other company keeps the workspace HR manager");
        assertEquals(4, sqls.size(), "HR and admin, once per company");
    }

    // ── permission holders: alerts ─────────────────────────────────────────

    @Test
    void permissionHoldersAddTheGranteesOfThePersonsCompany() {
        PermissionHolders holders = new PermissionHolders(jdbc);
        assertNull(holders.companyOf(applicant), "nothing is read before the table exists");
        assertEquals(List.of(), holders.employeesGranted(tenant, "hrms.probation.reminders.read", company));

        grantsTable(true);
        applicantIn(company);
        when(jdbc.queryForList(contains("FROM rbac.user_company_access a"), eq(UUID.class), any(Object[].class)))
                .thenReturn(List.of(grantee));
        assertEquals(company, holders.companyOf(applicant));
        assertEquals(List.of(grantee), holders.employeesGranted(tenant, "hrms.probation.reminders.read", company));
    }
}
