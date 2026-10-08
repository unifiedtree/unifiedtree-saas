package com.hrms.app.config;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.saas.marketing.MarketingServiceTokenFilter;
import com.unifiedtree.security.web.TenantContextFilter;
import jakarta.servlet.Filter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotatedBeanDefinitionReader;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.GenericWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The real production security chain ({@link CanonicalProdSecurityConfig}) in front of /v1/internal/marketing/**:
 * a refused service token answers JSON with code SERVICE_TOKEN_REJECTED and the same status and headers as before
 * (the body used to be empty). Every other path is refused exactly as before.
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
        context = new GenericWebApplicationContext(new MockServletContext());
        context.getEnvironment().setActiveProfiles("canonical-prod");
        new AnnotatedBeanDefinitionReader(context).register(Web.class, CanonicalProdSecurityConfig.class,
                Endpoints.class);
        jwt = new JwtService(JWT_SECRET, "unifiedtree", 60, 1);
        MarketingServiceTokenFilter marketing = new MarketingServiceTokenFilter(configuredToken);
        context.registerBean(TenantContextFilter.class, () -> new TenantContextFilter(false));
        context.registerBean(JwtService.class, () -> jwt);
        context.registerBean(MarketingServiceTokenFilter.class, () -> marketing);
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
}
