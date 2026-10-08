package com.unifiedtree.saas.marketing;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.exception.GlobalExceptionHandler;
import com.unifiedtree.rbac.company.CompanyAccess;
import com.unifiedtree.rbac.company.CompanyAccessService;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyAccessView;
import com.unifiedtree.rbac.company.CompanyAccessService.CompanyEntry;
import com.unifiedtree.saas.admin.support.PlatformAuditTrail;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService.Entitlement;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Every refusal of the Marketing internal and SSO API carries a stable {@code code} (what Node switches on), while
 * the status, errorCode and message stay exactly what they were. docs/redesign/MARKETING_SSO_CODES.md.
 */
class MarketingRefusalCodesTest {

    static final String TICKET = "tK3t-redeem-me-once-0123456789abcdefghijklm";
    static final UUID ACCOUNT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    static final UUID COMPANY = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    static final UUID AUTH_USER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    static final String ACCESS = "/v1/internal/marketing/access?accountId=" + ACCOUNT + "&tenantId=" + TENANT
            + "&companyId=" + COMPANY;

    /** Answers each query by a fragment of its SQL; anything else finds no rows */
    static final class FakeJdbc extends JdbcTemplate {
        final Map<String, List<?>> answers = new LinkedHashMap<>();
        final List<String> asked = new ArrayList<>();
        int updated = 1;

        FakeJdbc answer(String fragment, List<?> rows) {
            answers.put(fragment, rows);
            return this;
        }

        @SuppressWarnings("unchecked")
        private <T> List<T> find(String sql) {
            asked.add(sql);
            return answers.entrySet().stream().filter(e -> sql.contains(e.getKey())).findFirst()
                    .map(e -> (List<T>) e.getValue()).orElse(List.of());
        }

        @Override
        public List<Map<String, Object>> queryForList(String sql, Object... args) {
            return find(sql);
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            return find(sql);
        }

        @Override
        public int update(String sql, Object... args) {
            asked.add(sql);
            return updated;
        }
    }

    /** A map that may hold nulls, for rows */
    static Map<String, Object> row(Object... keyValues) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) m.put((String) keyValues[i], keyValues[i + 1]);
        return m;
    }

    static final String CONSUME = "UPDATE platform.sso_handoff_tickets";
    static final String WHY = "consumed_at IS NOT NULL AS used";
    static final String MEMBERSHIP = "a.status::text AS acct_status";
    static final String CREDENTIALS = "FROM auth.user_credentials";
    static final String COMPANY_ROW = "FROM org.companies";

    private FakeJdbc jdbc;
    private CompanyAccessService companyAccess;
    private CompanyEntitlementService entitlements;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        jdbc = new FakeJdbc();
        PlatformTransactionManager tx = mock(PlatformTransactionManager.class);
        TenantScopedReader scoped = new TenantScopedReader(tx);
        companyAccess = mock(CompanyAccessService.class);
        entitlements = mock(CompanyEntitlementService.class);
        MarketingAccessService access = new MarketingAccessService(jdbc, scoped, companyAccess, entitlements,
                new ObjectMapper(), tx);
        MarketingInternalController internal = new MarketingInternalController(access,
                mock(MarketingUsageService.class), mock(PlatformAuditTrail.class), scoped);
        mvc = MockMvcBuilders.standaloneSetup(internal, new MarketingSsoController(access))
                .setControllerAdvice(new MarketingErrorAdvice(), new GlobalExceptionHandler())
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .build();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    /** A ticket that is consumed now, for the person in the workspace and company above */
    private void aGoodTicket() {
        jdbc.answer(CONSUME, List.of(row("account_id", ACCOUNT, "tenant_id", TENANT, "company_id", COMPANY)));
    }

    private void aMember(String accountStatus, String workspaceStatus) {
        jdbc.answer(MEMBERSHIP, List.of(row("auth_user_id", AUTH_USER, "role", "MEMBER", "email", "p@example.com",
                "display_name", "P", "acct_status", accountStatus, "subdomain", "demo", "ws_name", "Demo",
                "ws_status", workspaceStatus)));
    }

    private void workspaceUser(boolean active, Instant lockedUntil) {
        jdbc.answer(CREDENTIALS, List.of(row("is_active", active,
                "locked_until", lockedUntil == null ? null : Timestamp.from(lockedUntil))));
    }

    private void companies(List<CompanyEntry> visible) {
        CompanyAccess.Profile profile = new CompanyAccess.Profile(AUTH_USER, true, null, null, List.of(), List.of());
        when(companyAccess.profile(any())).thenReturn(profile);
        when(companyAccess.view(any(), anyBoolean())).thenReturn(new CompanyAccessView(AUTH_USER, null, true, visible));
    }

    private void entitled(boolean entitled) {
        jdbc.answer(COMPANY_ROW, List.of(true));
        when(entitlements.resolve(any(), any(), anyString())).thenReturn(new Entitlement("whatsapp", entitled,
                entitled ? "MANUAL" : "NONE", entitled ? "ACTIVE" : "NONE", null, null, null, null, null, null, null,
                null, 0));
    }

    private ResultActions redeem(String ticket) throws Exception {
        return mvc.perform(post("/v1/internal/marketing/sso/redeem").contentType(MediaType.APPLICATION_JSON)
                .content("{\"ticket\":\"" + ticket + "\"}"));
    }

    private static void expectNoTicketIn(ResultActions r) throws Exception {
        assertThat(r.andReturn().getResponse().getContentAsString()).doesNotContain(TICKET);
    }

    // ── Tickets: one message as before, the code says which ──

    @Test
    void anUnknownTicketIsTicketInvalid() throws Exception {
        ResultActions r = redeem(TICKET).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TICKET_INVALID"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.errorCode").value("401 UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").value("Handoff ticket is invalid, expired or already used"));
        expectNoTicketIn(r);
    }

    @Test
    void aMalformedTicketIsTicketInvalidWithoutTouchingTheDatabase() throws Exception {
        redeem("too-short").andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TICKET_INVALID"))
                .andExpect(jsonPath("$.message").value("Invalid handoff ticket"));
        assertThat(jdbc.asked).isEmpty();
    }

    @Test
    void aTicketAlreadyRedeemedIsTicketUsed() throws Exception {
        jdbc.answer(WHY, List.of(row("used", true, "expired", false)));
        ResultActions r = redeem(TICKET).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TICKET_USED"))
                .andExpect(jsonPath("$.message").value("Handoff ticket is invalid, expired or already used"));
        expectNoTicketIn(r);
    }

    @Test
    void aTicketRedeemedAndSincePastItsMinuteIsStillTicketUsed() throws Exception {
        jdbc.answer(WHY, List.of(row("used", true, "expired", true)));
        redeem(TICKET).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("TICKET_USED"));
    }

    @Test
    void aTicketPastItsMinuteIsTicketExpired() throws Exception {
        jdbc.answer(WHY, List.of(row("used", false, "expired", true)));
        ResultActions r = redeem(TICKET).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TICKET_EXPIRED"))
                .andExpect(jsonPath("$.message").value("Handoff ticket is invalid, expired or already used"));
        expectNoTicketIn(r);
    }

    @Test
    void aBlankTicketIsTheUsualValidationError() throws Exception {
        redeem("").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    // ── Access: the existing codes, now also in code ──

    @Test
    void aTicketForSomeoneNoLongerInTheWorkspaceIsNotAMember() throws Exception {
        aGoodTicket();
        redeem(TICKET).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_A_MEMBER"))
                .andExpect(jsonPath("$.errorCode").value("403 FORBIDDEN"))
                .andExpect(jsonPath("$.message").value("NOT_A_MEMBER: You are not a member of that workspace"));
    }

    @Test
    void aSwitchedOffAccountIsAccountInactive() throws Exception {
        aMember("SUSPENDED", "ACTIVE");
        mvc.perform(get(ACCESS)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_INACTIVE"))
                .andExpect(jsonPath("$.message").value("ACCOUNT_INACTIVE: This account is not active"));
    }

    @Test
    void anInactiveWorkspaceIsWorkspaceInactive() throws Exception {
        aMember("ACTIVE", "SUSPENDED");
        mvc.perform(get(ACCESS)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("WORKSPACE_INACTIVE"));
    }

    @Test
    void aWorkspaceUserSwitchedOffInHrmsIsAccountInactive() throws Exception {
        aMember("ACTIVE", "ACTIVE");
        workspaceUser(false, null);
        mvc.perform(get(ACCESS)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_INACTIVE"))
                .andExpect(jsonPath("$.message").value("ACCOUNT_INACTIVE: This user has been deactivated in the workspace"));
    }

    @Test
    void aLockedWorkspaceUserIsAccountLocked() throws Exception {
        aMember("ACTIVE", "ACTIVE");
        workspaceUser(true, Instant.now().plusSeconds(600));
        mvc.perform(get(ACCESS)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_LOCKED"))
                .andExpect(jsonPath("$.message").value("ACCOUNT_LOCKED: This user is temporarily locked"));
    }

    @Test
    void aCompanyThePersonCannotAccessIsCompanyAccessDenied() throws Exception {
        aMember("ACTIVE", "ACTIVE");
        workspaceUser(true, null);
        companies(List.of());
        mvc.perform(get(ACCESS)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COMPANY_ACCESS_DENIED"));
    }

    @Test
    void aCompanyWithoutMarketingIsMarketingNotEntitled() throws Exception {
        aMember("ACTIVE", "ACTIVE");
        workspaceUser(true, null);
        companies(List.of(new CompanyEntry(COMPANY, "Acme", null, true, true, "WORKSPACE", List.of())));
        entitled(false);
        mvc.perform(get(ACCESS)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MARKETING_NOT_ENTITLED"))
                .andExpect(jsonPath("$.message").value("MARKETING_NOT_ENTITLED: This company does not have Marketing Automation"));
    }

    @Test
    void aCompanyNotInTheWorkspaceIsCompanyNotFound() throws Exception {
        mvc.perform(get("/v1/internal/marketing/companies/" + COMPANY + "/entitlement?tenantId=" + TENANT))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMPANY_NOT_FOUND"))
                .andExpect(jsonPath("$.errorCode").value("404 NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("COMPANY_NOT_FOUND: That company is not in that workspace"));
    }

    @Test
    void anArchivedCompanyIsCompanyInactive() throws Exception {
        jdbc.answer(COMPANY_ROW, List.of(false));
        mvc.perform(get("/v1/internal/marketing/companies/" + COMPANY + "/entitlement?tenantId=" + TENANT))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("COMPANY_INACTIVE"));
    }

    @Test
    void theSsoHandoffRefusalsCarryTheSameCodes() throws Exception {
        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", ACCOUNT.toString(), "roles", List.of("ACCOUNT_USER")));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, List.of()));
        mvc.perform(post("/v1/sso/marketing/handoff").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + TENANT + "\",\"companyId\":\"" + COMPANY + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_A_MEMBER"))
                .andExpect(jsonPath("$.message").value("NOT_A_MEMBER: You are not a member of that workspace"));
    }

    // ── The rest of the internal API: a code on every refusal ──

    @Test
    void anOlderCodedRefusalGetsTheCodeItsMessageStartsWith() throws Exception {
        jdbc.updated = 0;
        jdbc.answer("SELECT status FROM platform.marketing_identity_map", List.of("QUARANTINED"));
        mvc.perform(put("/v1/internal/marketing/principals").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"COMPANY_OWNER\",\"legacyMarketingUserId\":\"0123456789abcdef01234567\","
                                + "\"tenantId\":\"" + TENANT + "\",\"companyId\":\"" + COMPANY + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PRINCIPAL_HELD"))
                .andExpect(jsonPath("$.message").value("PRINCIPAL_HELD: That Marketing user is quarantined by an operator"));
    }

    @Test
    void anUncodedRefusalGetsItsStatusName() throws Exception {
        mvc.perform(post("/v1/internal/marketing/audit").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + TENANT + "\",\"action\":\"LOGIN\",\"summary\":\"x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"))
                .andExpect(jsonPath("$.errorCode").value("400 BAD_REQUEST"))
                .andExpect(jsonPath("$.message").value("action must start with MARKETING_"));
    }

    @Test
    void aMissingParameterIsTheUsualInvalidParameter() throws Exception {
        mvc.perform(get("/v1/internal/marketing/access?accountId=" + ACCOUNT)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    }

    @Test
    void permissionRefusalsKeepTheirUsualBodyWithACode() {
        ResponseEntity<MarketingErrorAdvice.MarketingError> r =
                new MarketingErrorAdvice().handle(new AccessDeniedException("Access Denied"));
        assertThat(r.getStatusCode().value()).isEqualTo(403);
        assertThat(r.getBody().errorCode()).isEqualTo("ACCESS_DENIED");
        assertThat(r.getBody().code()).isEqualTo("ACCESS_DENIED");
        assertThat(r.getBody().message()).isEqualTo("You do not have permission to perform this action");
    }

    // ── Nothing else changes ──

    @RestController
    static class SomeOtherController {
        @GetMapping("/v1/hrms/elsewhere")
        String elsewhere() {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "COMPANY_NOT_FOUND: elsewhere");
        }
    }

    @Test
    void otherControllersKeepTheUsualBodyWithoutACode() throws Exception {
        MockMvc other = MockMvcBuilders.standaloneSetup(new SomeOtherController())
                .setControllerAdvice(new MarketingErrorAdvice(), new GlobalExceptionHandler()).build();
        other.perform(get("/v1/hrms/elsewhere")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("409 CONFLICT"))
                .andExpect(jsonPath("$.message").value("COMPANY_NOT_FOUND: elsewhere"))
                .andExpect(jsonPath("$.code").doesNotExist());
    }
}
