package com.hrms.app.config;

import com.hrms.api.saasguard.SubscriptionAccessGuard;
import com.hrms.api.saasguard.TenantModuleGuard;
import com.hrms.api.saasguard.TenantModuleGuardConfig;
import com.hrms.api.saasguard.TenantModuleLookup;
import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.saas.marketing.MarketingAccessService;
import com.unifiedtree.saas.marketing.MarketingAccessService.Handoff;
import com.unifiedtree.saas.marketing.MarketingAccessService.SsoCaller;
import com.unifiedtree.saas.marketing.MarketingServiceTokenFilter;
import com.unifiedtree.saas.marketing.MarketingSsoController;
import com.unifiedtree.security.web.TenantContextFilter;
import jakarta.servlet.Filter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.annotation.AnnotatedBeanDefinitionReader;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.GenericWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.startsWith;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The real production security chain ({@link CanonicalProdSecurityConfig}) in front of /v1/internal/marketing/**:
 * a refused service token answers JSON with code SERVICE_TOKEN_REJECTED and the same status and headers as before
 * (the body used to be empty). Every other path is refused exactly as before. And /v1/sso/marketing/**, which a
 * workspace token (direct sign-in on the business subdomain) now reaches, past method security and the paywall.
 */
class MarketingInternalSecurityChainTest {

    static final String TOKEN = "s3rv1ce-t0ken-for-tests-0123456789abcdef";
    static final String JWT_SECRET = "chain-test-jwt-secret-chain-test-jwt-secret";
    static final String INTERNAL = "/v1/internal/marketing/access";

    /** Turns on Spring MVC and Spring Security for the beans registered below (not scanned: no @Configuration) */
    @EnableWebMvc
    @EnableWebSecurity
    static class Web {}

    @RestController
    static class Endpoints {
        @GetMapping(INTERNAL)
        String internal() { return "internal"; }

        @GetMapping("/v1/hrms/elsewhere")
        String elsewhere() { return "elsewhere"; }
    }

    private GenericWebApplicationContext context;
    private JwtService jwt;

    private MockMvc chain(String configuredToken) {
        return chain(configuredToken, c -> {});
    }

    private MockMvc chain(String configuredToken, Consumer<GenericWebApplicationContext> more) {
        context = new GenericWebApplicationContext(new MockServletContext());
        context.getEnvironment().setActiveProfiles("canonical-prod");
        new AnnotatedBeanDefinitionReader(context).register(Web.class, CanonicalProdSecurityConfig.class,
                Endpoints.class);
        jwt = new JwtService(JWT_SECRET, "unifiedtree", 60, 1);
        MarketingServiceTokenFilter marketing = new MarketingServiceTokenFilter(configuredToken);
        context.registerBean(TenantContextFilter.class, () -> new TenantContextFilter(false));
        context.registerBean(JwtService.class, () -> jwt);
        context.registerBean(MarketingServiceTokenFilter.class, () -> marketing);
        more.accept(context);
        context.refresh();
        // As in the app: the security chain first, then MarketingServiceTokenFilter (a servlet filter after it)
        return MockMvcBuilders.webAppContextSetup(context)
                .addFilters(context.getBean("springSecurityFilterChain", Filter.class), marketing)
                .build();
    }

    @AfterEach
    void tearDown() {
        if (context != null) context.close();
    }

    private String userToken() {
        return jwt.issueAccessToken(UUID.randomUUID(), UUID.randomUUID(), "owner@example.com", List.of("OWNER"),
                List.of()).token();
    }

    private static void expectRejected(ResultActions r, int status) throws Exception {
        r.andExpect(status().is(status))
                .andExpect(header().string("WWW-Authenticate", startsWith("Bearer")))
                .andExpect(content().contentTypeCompatibleWith("application/json"))
                .andExpect(jsonPath("$.status").value(status))
                .andExpect(jsonPath("$.errorCode").value("INVALID_SERVICE_TOKEN"))
                .andExpect(jsonPath("$.message").value("A valid service token is required"))
                .andExpect(jsonPath("$.code").value("SERVICE_TOKEN_REJECTED"));
    }

    @Test
    void noServiceTokenIs401WithTheCode() throws Exception {
        expectRejected(chain(TOKEN).perform(get(INTERNAL)), 401);
    }

    @Test
    void aWrongServiceTokenIs401WithTheCodeAndIsNotEchoed() throws Exception {
        ResultActions r = chain(TOKEN).perform(get(INTERNAL)
                .header(MarketingServiceTokenFilter.HEADER, "wrong-service-token-0123456789abcdefghij"));
        expectRejected(r, 401);
        assertThat(r.andReturn().getResponse().getContentAsString()).doesNotContain("wrong-service-token");
    }

    @Test
    void noTokenConfiguredOnTheServerIs401WithTheCode() throws Exception {
        expectRejected(chain("").perform(get(INTERNAL).header(MarketingServiceTokenFilter.HEADER, TOKEN)), 401);
    }

    @Test
    void anEncodedPathIsRefusedTheSameWay() throws Exception {
        expectRejected(chain(TOKEN).perform(get(URI.create("/v1/inte%72nal/marketing/access"))), 401);
    }

    @Test
    void aUserTokenWithoutTheServiceTokenIsStill403NowWithTheCode() throws Exception {
        MockMvc mvc = chain(TOKEN);
        expectRejected(mvc.perform(get(INTERNAL).header("Authorization", "Bearer " + userToken())), 403);
    }

    @Test
    void aBadBearerTokenWithoutTheServiceTokenIs401WithTheCode() throws Exception {
        expectRejected(chain(TOKEN).perform(get(INTERNAL).header("Authorization", "Bearer not-a-jwt")), 401);
    }

    @Test
    void theRightServiceTokenGetsThrough() throws Exception {
        chain(TOKEN).perform(get(INTERNAL).header(MarketingServiceTokenFilter.HEADER, TOKEN))
                .andExpect(status().isOk())
                .andExpect(content().string("internal"));
    }

    @Test
    void everyOtherPathIsRefusedExactlyAsBefore() throws Exception {
        MockMvc mvc = chain(TOKEN);
        mvc.perform(get("/v1/hrms/elsewhere"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(content().string(""));
        mvc.perform(get("/v1/hrms/elsewhere").header("Authorization", "Bearer not-a-jwt"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", startsWith("Bearer error=\"invalid_token\"")))
                .andExpect(content().string(""));
        mvc.perform(get("/v1/hrms/elsewhere").header("Authorization", "Bearer " + userToken()))
                .andExpect(status().isOk())
                .andExpect(content().string("elsewhere"));
        mvc.perform(get("/v1/platform/admin/workspaces").header("Authorization", "Bearer " + userToken()))
                .andExpect(status().isForbidden())
                .andExpect(content().string(""));
    }

    // ── The Marketing launcher, signed in directly on the business subdomain (a workspace token) ──

    static final String SSO = "/v1/sso/marketing/companies";
    static final UUID ACCOUNT = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private final MarketingAccessService access = mock(MarketingAccessService.class);
    /** No workspace has a subscription row, and none is grandfathered: the paywall refuses them wherever it applies */
    private final JdbcTemplate noSubscriptions = mock(JdbcTemplate.class);

    /** Plus the real SSO controller with method security on, and the real paywall interceptors, as in the app */
    private MockMvc ssoChain() {
        return chain(TOKEN, c -> {
            new AnnotatedBeanDefinitionReader(c).register(MethodSecurityConfig.class, MarketingSsoController.class,
                    TenantModuleGuardConfig.class);
            c.registerBean(MarketingAccessService.class, () -> access);
            c.registerBean(TenantModuleGuard.class, () -> new TenantModuleGuard(new TenantModuleLookup(noSubscriptions)));
            c.registerBean(SubscriptionAccessGuard.class,
                    () -> new SubscriptionAccessGuard(noSubscriptions, null, null, ""));
        });
    }

    private String workspaceToken(UUID user, UUID tenant) {
        return jwt.issueAccessToken(user, tenant, "owner@example.com", List.of("OWNER"), List.of(), null,
                UUID.randomUUID()).token();
    }

    @Test
    void aWorkspaceTokenPassesTheChainToTheMarketingLauncher() throws Exception {
        UUID user = UUID.randomUUID();
        UUID tenant = UUID.randomUUID();
        UUID company = UUID.randomUUID();
        when(access.ssoCaller(any())).thenReturn(new SsoCaller(ACCOUNT, tenant));
        when(access.choices(ACCOUNT, tenant)).thenReturn(List.of());
        when(access.mint(eq(ACCOUNT), eq(tenant), eq(company), any(), any()))
                .thenReturn(new Handoff("ticket-0123456789abcdefghij", Instant.now().plusSeconds(60)));
        MockMvc mvc = ssoChain();
        String bearer = "Bearer " + workspaceToken(user, tenant);

        mvc.perform(get(SSO).header("Authorization", bearer)).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(post("/v1/sso/marketing/handoff").header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenantId\":\"" + tenant + "\",\"companyId\":\"" + company + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ticket").value("ticket-0123456789abcdefghij"));
        ArgumentCaptor<Jwt> seen = ArgumentCaptor.forClass(Jwt.class);
        verify(access, times(2)).ssoCaller(seen.capture());
        assertThat(seen.getValue().getSubject()).isEqualTo(user.toString());
        assertThat(seen.getValue().getClaimAsString("tenant_id")).isEqualTo(tenant.toString());
    }

    @Test
    void theMarketingLauncherStillNeedsASignedInCaller() throws Exception {
        MockMvc mvc = ssoChain();
        mvc.perform(get(SSO)).andExpect(status().isUnauthorized());
        mvc.perform(get(SSO).header("Authorization", "Bearer not-a-jwt")).andExpect(status().isUnauthorized());
        verifyNoInteractions(access);
    }

    @Test
    void aWorkspaceWithoutASubscriptionStillReachesTheMarketingLauncher() throws Exception {
        UUID tenant = UUID.randomUUID();
        when(access.ssoCaller(any())).thenReturn(new SsoCaller(ACCOUNT, tenant));
        when(access.choices(ACCOUNT, tenant)).thenReturn(List.of());
        MockMvc mvc = ssoChain();
        String bearer = "Bearer " + workspaceToken(UUID.randomUUID(), tenant);

        mvc.perform(get("/v1/hrms/elsewhere").header("Authorization", bearer)).andExpect(status().isPaymentRequired());
        mvc.perform(get(SSO).header("Authorization", bearer)).andExpect(status().isOk());
    }
}
