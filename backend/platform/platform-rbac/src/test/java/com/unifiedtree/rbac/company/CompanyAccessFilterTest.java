package com.unifiedtree.rbac.company;

import com.unifiedtree.rbac.company.CompanyAccess.Grant;
import com.unifiedtree.rbac.company.CompanyAccess.Profile;
import com.unifiedtree.rbac.company.CompanyAccess.RoleRef;
import com.unifiedtree.security.tenant.CompanyContext;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * X-Company-Id, companyId parameters and /companies/{id} paths: accessible
 * companies pass, others are refused before any controller runs, and in a
 * company reached through a grant the request carries that company's roles and
 * permissions. A request that names no company is untouched (old clients).
 */
class CompanyAccessFilterTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID home = UUID.randomUUID();
    private final UUID granted = UUID.randomUUID();
    private final UUID other = UUID.randomUUID();
    private final CompanyAccessService access = mock(CompanyAccessService.class);
    private final CompanyAccessFilter filter = new CompanyAccessFilter(access);

    private final RoleRef employeeRole = new RoleRef(UUID.randomUUID(), "EMPLOYEE", "Employee", true);
    private final CompanyContext.Scope grantedScope = new CompanyContext.Scope(granted, Set.of(employeeRole.id()),
            List.of("EMPLOYEE"), Set.of("leave.request.self", "org.company.read"));

    /** What the controller would see. */
    private final AtomicReference<Authentication> seenAuth = new AtomicReference<>();
    private final AtomicReference<UUID> seenCompany = new AtomicReference<>();
    private final AtomicReference<CompanyContext.Scope> seenScope = new AtomicReference<>();
    private boolean chainRan;
    private final FilterChain chain = (req, res) -> {
        chainRan = true;
        seenAuth.set(SecurityContextHolder.getContext().getAuthentication());
        seenCompany.set(CompanyContext.getCompanyId());
        seenScope.set(CompanyContext.getScope());
    };
    private JwtAuthenticationToken original;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        TenantContext.setUserId(user);
        Jwt jwt = Jwt.withTokenValue("token").header("alg", "HS256")
                .subject(user.toString()).claim("tenant_id", tenant.toString())
                .claim("roles", List.of("DEPT_MANAGER")).claim("permissions", List.of("attendance.team.read", "org.company.read"))
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(600)).build();
        original = new JwtAuthenticationToken(jwt,
                List.of(new SimpleGrantedAuthority("ROLE_DEPT_MANAGER"), new SimpleGrantedAuthority("attendance.team.read"),
                        new SimpleGrantedAuthority("org.company.read")), user.toString());
        SecurityContextHolder.getContext().setAuthentication(original);
        when(access.enforced()).thenReturn(true);
        when(access.profile(user)).thenReturn(scopedPerson());
        when(access.scope(any(), any())).thenAnswer(inv -> {
            Profile p = inv.getArgument(0);
            UUID c = inv.getArgument(1);
            return p.needsScope(c) ? grantedScope : null;
        });
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
        CompanyContext.clear();
        SecurityContextHolder.clearContext();
    }

    private Profile scopedPerson() {
        return new Profile(user, true, UUID.randomUUID(), home,
                List.of(new RoleRef(UUID.randomUUID(), "DEPT_MANAGER", "Dept Manager", true)),
                List.of(new Grant(granted, employeeRole, UUID.randomUUID(), OffsetDateTime.now())));
    }

    private Profile owner() {
        return new Profile(user, true, UUID.randomUUID(), home,
                List.of(new RoleRef(UUID.randomUUID(), "OWNER", "Owner", true)), List.of());
    }

    private MockHttpServletRequest get(String path) {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api" + path);
        req.setContextPath("/api");
        int q = path.indexOf('?');
        if (q >= 0) {
            req.setRequestURI("/api" + path.substring(0, q));
            req.setQueryString(path.substring(q + 1));
        }
        return req;
    }

    private MockHttpServletResponse run(MockHttpServletRequest req) throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(req, res, chain);
        return res;
    }

    private static List<String> authorities(Authentication a) {
        List<String> out = new ArrayList<>();
        for (GrantedAuthority g : a.getAuthorities()) out.add(g.getAuthority());
        return out;
    }

    // ── no company named: exactly as before ─────────────────────────────────

    @Test
    void aRequestThatNamesNoCompanyIsUntouchedAndReadsNothing() throws Exception {
        MockHttpServletResponse res = run(get("/v1/hrms/departments"));
        assertTrue(chainRan);
        assertEquals(200, res.getStatus());
        assertSame(original, seenAuth.get());
        assertNull(seenCompany.get());
        assertNull(seenScope.get());
        verify(access, never()).profile(any());
    }

    @Test
    void theKillSwitchTurnsEveryCheckOff() throws Exception {
        when(access.enforced()).thenReturn(false);
        MockHttpServletRequest req = get("/v1/hrms/departments?companyId=" + other);
        req.addHeader("X-Company-Id", other.toString());
        assertEquals(200, run(req).getStatus());
        assertTrue(chainRan);
        assertNull(seenCompany.get());
        verify(access, never()).profile(any());
    }

    // ── the header ──────────────────────────────────────────────────────────

    @Test
    void theHomeCompanyRunsWithTheSessionsOwnPermissions() throws Exception {
        MockHttpServletRequest req = get("/v1/hrms/departments");
        req.addHeader("X-Company-Id", home.toString());
        assertEquals(200, run(req).getStatus());
        assertSame(original, seenAuth.get());
        assertEquals(home, seenCompany.get());
        assertNull(seenScope.get());
    }

    @Test
    void aGrantedCompanyRunsWithTheRolesAndPermissionsGrantedThere() throws Exception {
        MockHttpServletRequest req = get("/v1/attendance/dashboard");
        req.addHeader("X-Company-Id", granted.toString());
        assertEquals(200, run(req).getStatus());
        Authentication a = seenAuth.get();
        assertNotSame(original, a);
        assertTrue(authorities(a).containsAll(List.of("ROLE_EMPLOYEE", "leave.request.self", "org.company.read")));
        assertFalse(authorities(a).contains("attendance.team.read"), "the home role's permission does not follow");
        assertFalse(authorities(a).contains("ROLE_DEPT_MANAGER"));
        Jwt jwt = (Jwt) a.getPrincipal();
        assertEquals(List.of("EMPLOYEE"), jwt.getClaimAsStringList("roles"));
        assertFalse(jwt.getClaimAsStringList("permissions").contains("attendance.team.read"));
        assertEquals(user.toString(), jwt.getSubject());
        assertEquals(tenant.toString(), jwt.getClaimAsString("tenant_id"));
        assertEquals(granted, seenCompany.get());
        assertSame(grantedScope, seenScope.get());
        // and the request leaves nothing behind
        assertSame(original, SecurityContextHolder.getContext().getAuthentication());
        assertNull(CompanyContext.getCompanyId());
        assertNull(CompanyContext.getScope());
    }

    @Test
    void aCompanyThePersonCannotAccessIsRefusedBeforeTheController() throws Exception {
        MockHttpServletRequest req = get("/v1/hrms/departments");
        req.addHeader("X-Company-Id", other.toString());
        MockHttpServletResponse res = run(req);
        assertFalse(chainRan);
        assertEquals(403, res.getStatus());
        assertTrue(res.getContentAsString().contains("\"errorCode\":\"COMPANY_ACCESS_DENIED\""));
        assertNull(CompanyContext.getCompanyId());
    }

    @Test
    void aHeaderThatIsNotAnIdIsABadRequest() throws Exception {
        MockHttpServletRequest req = get("/v1/hrms/departments");
        req.addHeader("X-Company-Id", "not-a-uuid");
        MockHttpServletResponse res = run(req);
        assertFalse(chainRan);
        assertEquals(400, res.getStatus());
        assertTrue(res.getContentAsString().contains("INVALID_COMPANY_ID"));
    }

    @Test
    void theCompanyListAndMeIgnoreAStaleHeaderSoTheClientCanRecover() throws Exception {
        for (String path : List.of("/v1/me/companies", "/v1/canonical-auth/me")) {
            chainRan = false;
            MockHttpServletRequest req = get(path);
            req.addHeader("X-Company-Id", other.toString());
            assertEquals(200, run(req).getStatus(), path);
            assertTrue(chainRan, path);
            assertNull(seenCompany.get(), path);
            assertSame(original, seenAuth.get(), path);
        }
    }

    // ── companyId parameters and /companies/{id} paths ──────────────────────

    @Test
    void aCompanyIdParameterOutsideTheirAccessIsRefusedEvenWithoutTheHeader() throws Exception {
        MockHttpServletResponse res = run(get("/v1/hrms/departments?companyId=" + other));
        assertFalse(chainRan);
        assertEquals(403, res.getStatus());
    }

    @Test
    void aCompanyIdParameterForTheHomeCompanyIsAsBefore() throws Exception {
        assertEquals(200, run(get("/v1/hrms/departments?companyId=" + home)).getStatus());
        assertSame(original, seenAuth.get());
        assertNull(seenCompany.get(), "only the header selects the current company");
    }

    @Test
    void permissionsFollowTheCompanyTheRequestIsAbout() throws Exception {
        MockHttpServletRequest req = get("/v1/hrms/departments?companyId=" + granted);
        req.addHeader("X-Company-Id", home.toString());
        assertEquals(200, run(req).getStatus());
        assertSame(grantedScope, seenScope.get());
        assertEquals(home, seenCompany.get());
    }

    @Test
    void everyCompanyIdValueIsChecked() throws Exception {
        assertEquals(403, run(get("/v1/x?companyId=" + home + "&companyId=" + other)).getStatus());
    }

    @Test
    void aCompanyPathOutsideTheirAccessIsRefused() throws Exception {
        assertEquals(403, run(get("/v1/hrms/companies/" + other + "/departments")).getStatus());
        assertEquals(403, run(get("/v1/employees/company/" + other)).getStatus());
        assertFalse(chainRan);
        assertEquals(200, run(get("/v1/hrms/companies/" + granted)).getStatus());
        assertSame(grantedScope, seenScope.get());
    }

    @Test
    void parameterParsingIgnoresJunkAndDecodesValues() {
        MockHttpServletRequest req = get("/v1/x?companyId=" + home + "&companyId=junk&companyId=%" + "&xcompanyId="
                + other + "&companyId=" + granted.toString().toUpperCase());
        assertEquals(Set.of(home, granted), CompanyAccessFilter.paramCompanies(req));
    }

    // ── people who reach every company ──────────────────────────────────────

    @Test
    void anOwnerMayNameAnyCompanyOfTheWorkspaceAndKeepsTheirPermissions() throws Exception {
        when(access.profile(user)).thenReturn(owner());
        when(access.companyExists(other)).thenReturn(true);
        MockHttpServletRequest req = get("/v1/hrms/departments?companyId=" + UUID.randomUUID());
        req.addHeader("X-Company-Id", other.toString());
        assertEquals(200, run(req).getStatus());
        assertSame(original, seenAuth.get());
        assertEquals(other, seenCompany.get());
        assertNull(seenScope.get());
    }

    @Test
    void anOwnersHeaderMustStillNameACompanyOfTheWorkspace() throws Exception {
        when(access.profile(user)).thenReturn(owner());
        when(access.companyExists(other)).thenReturn(false);
        MockHttpServletRequest req = get("/v1/hrms/departments");
        req.addHeader("X-Company-Id", other.toString());
        assertEquals(403, run(req).getStatus());
        assertFalse(chainRan);
    }

    // ── not a workspace session ─────────────────────────────────────────────

    @Test
    void unauthenticatedAndPlatformRequestsAreLeftAlone() throws Exception {
        SecurityContextHolder.clearContext();
        MockHttpServletRequest req = get("/v1/hrms/departments");
        req.addHeader("X-Company-Id", other.toString());
        assertEquals(200, run(req).getStatus());

        SecurityContextHolder.getContext().setAuthentication(original);
        TenantContext.setTenantId(UUID.fromString("00000000-0000-0000-0000-000000000000"));
        chainRan = false;
        assertEquals(200, run(req).getStatus());
        assertTrue(chainRan);
        verify(access, never()).profile(any());
    }
}
