package com.unifiedtree.saas.admin;

import com.unifiedtree.saas.admin.billing.InvoiceService;
import com.unifiedtree.saas.admin.billing.PlatformBillingController;
import com.unifiedtree.saas.admin.billing.PlatformBillingService;
import com.unifiedtree.saas.admin.catalog.PlatformCatalogController;
import com.unifiedtree.saas.admin.catalog.PlatformCatalogService;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryController;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService;
import com.unifiedtree.saas.admin.insight.PlatformInsightController;
import com.unifiedtree.saas.admin.insight.PlatformInsightService;
import com.unifiedtree.saas.admin.support.PlatformAuditTrail;
import com.unifiedtree.saas.entitlement.CompanyEntitlementService;
import com.unifiedtree.saas.marketing.MarketingAccessService;
import com.unifiedtree.saas.marketing.MarketingUsageService;
import com.unifiedtree.saas.marketing.PlatformMarketingAdminController;
import com.unifiedtree.saas.security.PlatformAdminAccess;
import com.unifiedtree.saas.service.SaasService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Every {@code /v1/platform/admin/**} endpoint, through the controllers' real
 * {@code @PreAuthorize} and Spring's method security: a business OWNER / SUPER_ADMIN token is
 * refused (403) even when it carries every platform.* permission, and nothing behind the
 * controllers is touched. Only the operator door's token (token_type=platform, the platform tenant, PLATFORM_SUPER_ADMIN)
 * gets in.
 */
class PlatformAdminAccessMockMvcTest {

    static final String PLATFORM_TENANT = SaasService.PLATFORM_TENANT_ID.toString();
    static final String WORKSPACE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    static final String ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    static final String CO = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    static final List<String> ALL_PLATFORM_PERMS = List.of("platform.admin", "platform.tenant.read",
            "platform.company.read", "platform.account.read", "platform.catalog.read", "platform.catalog.manage",
            "platform.subscription.read", "platform.billing.read", "platform.billing.manage",
            "platform.entitlement.manage", "platform.marketing.read", "platform.marketing.manage",
            "platform.audit.read");

    static final List<Class<?>> CONTROLLERS = List.of(PlatformBillingController.class, PlatformCatalogController.class,
            PlatformDirectoryController.class, PlatformInsightController.class, PlatformMarketingAdminController.class);

    /** method, path, JSON body (null = none): every endpoint of the controllers above. */
    static final List<String[]> ENDPOINTS = List.of(
            new String[] {"GET", "/v1/platform/admin/me", null},
            new String[] {"GET", "/v1/platform/admin/workspaces", null},
            new String[] {"GET", "/v1/platform/admin/workspaces/" + ID, null},
            new String[] {"GET", "/v1/platform/admin/companies", null},
            new String[] {"GET", "/v1/platform/admin/workspaces/" + ID + "/companies/" + CO, null},
            new String[] {"GET", "/v1/platform/admin/accounts", null},
            new String[] {"GET", "/v1/platform/admin/accounts/" + ID, null},
            new String[] {"GET", "/v1/platform/admin/dashboard", null},
            new String[] {"GET", "/v1/platform/admin/audit", null},
            new String[] {"GET", "/v1/platform/admin/catalog/modules", null},
            new String[] {"GET", "/v1/platform/admin/catalog/plans", null},
            new String[] {"GET", "/v1/platform/admin/catalog/plans/hr-employees", null},
            new String[] {"GET", "/v1/platform/admin/catalog/plans/hr-employees/prices", null},
            new String[] {"POST", "/v1/platform/admin/catalog/plans/hr-employees/prices",
                    "{\"unitPrice\":1,\"reason\":\"owner token test\"}"},
            new String[] {"GET", "/v1/platform/admin/workspaces/" + ID + "/companies/" + CO + "/entitlements", null},
            new String[] {"PUT", "/v1/platform/admin/workspaces/" + ID + "/companies/" + CO + "/entitlements/whatsapp",
                    "{\"status\":\"ACTIVE\",\"reason\":\"owner token test\"}"},
            new String[] {"DELETE", "/v1/platform/admin/workspaces/" + ID + "/companies/" + CO
                    + "/entitlements/whatsapp?reason=owner%20token%20test", null},
            new String[] {"GET", "/v1/platform/admin/subscriptions", null},
            new String[] {"GET", "/v1/platform/admin/payments", null},
            new String[] {"GET", "/v1/platform/admin/invoices", null},
            new String[] {"GET", "/v1/platform/admin/invoices/" + ID, null},
            new String[] {"POST", "/v1/platform/admin/invoices", "{\"tenantId\":\"" + ID + "\",\"lines\":[]}"},
            new String[] {"POST", "/v1/platform/admin/payments/" + ID + "/invoice", null},
            new String[] {"POST", "/v1/platform/admin/invoices/" + ID + "/issue", null},
            new String[] {"POST", "/v1/platform/admin/invoices/" + ID + "/void", "{\"reason\":\"owner token test\"}"},
            new String[] {"GET", "/v1/platform/admin/workspaces/" + ID + "/companies/" + CO + "/billing-profile", null},
            new String[] {"PUT", "/v1/platform/admin/workspaces/" + ID + "/companies/" + CO + "/billing-profile", "{}"},
            new String[] {"GET", "/v1/platform/admin/settings/billing", null},
            new String[] {"PUT", "/v1/platform/admin/settings/billing", "{}"},
            new String[] {"GET", "/v1/platform/admin/marketing/companies", null},
            new String[] {"GET", "/v1/platform/admin/marketing/identity-map", null},
            new String[] {"POST", "/v1/platform/admin/marketing/identity-map/" + ID + "/retire",
                    "{\"reason\":\"owner token test\"}"},
            new String[] {"GET", "/v1/platform/admin/marketing/channels", null},
            new String[] {"PUT", "/v1/platform/admin/marketing/channels/" + ID + "/billing-mode",
                    "{\"billingMode\":\"DIRECT_CUSTOMER\"}"},
            new String[] {"GET", "/v1/platform/admin/marketing/usage", null},
            new String[] {"GET", "/v1/platform/admin/marketing/billing-status", null});

    @EnableMethodSecurity
    static class MethodSecurityOn {}

    @RestControllerAdvice
    static class Refusals {
        @ExceptionHandler(AccessDeniedException.class)
        ResponseEntity<Void> refused() { return ResponseEntity.status(HttpStatus.FORBIDDEN).build(); }
    }

    private AnnotationConfigApplicationContext context;
    private MockMvc mvc;
    private final List<Object> backends = new ArrayList<>();

    private <T> T backend(Class<T> type) {
        T m = mock(type);
        backends.add(m);
        return m;
    }

    @BeforeEach
    void setUp() {
        PlatformBillingService billing = backend(PlatformBillingService.class);
        InvoiceService invoices = backend(InvoiceService.class);
        PlatformAuditTrail audit = backend(PlatformAuditTrail.class);
        PlatformCatalogService catalog = backend(PlatformCatalogService.class);
        CompanyEntitlementService entitlements = backend(CompanyEntitlementService.class);
        PlatformDirectoryService directory = backend(PlatformDirectoryService.class);
        PlatformInsightService insight = backend(PlatformInsightService.class);
        MarketingUsageService usage = backend(MarketingUsageService.class);
        JdbcTemplate jdbc = backend(JdbcTemplate.class);
        MarketingAccessService access = backend(MarketingAccessService.class);

        context = new AnnotationConfigApplicationContext();
        context.register(MethodSecurityOn.class);
        context.registerBean("platformAdmin", PlatformAdminAccess.class, PlatformAdminAccess::new);
        context.registerBean(PlatformBillingController.class, () -> new PlatformBillingController(billing, invoices, audit));
        context.registerBean(PlatformCatalogController.class,
                () -> new PlatformCatalogController(catalog, entitlements, directory, audit));
        context.registerBean(PlatformDirectoryController.class, () -> new PlatformDirectoryController(directory));
        context.registerBean(PlatformInsightController.class, () -> new PlatformInsightController(insight));
        context.registerBean(PlatformMarketingAdminController.class,
                () -> new PlatformMarketingAdminController(directory, usage, jdbc, audit, access));
        context.refresh();
        mvc = MockMvcBuilders.standaloneSetup(CONTROLLERS.stream().map(context::getBean).toArray())
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new Refusals())
                .build();
    }

    @AfterEach
    void tearDown() {
        context.close();
        SecurityContextHolder.clearContext();
    }

    private static void signIn(String tenantId, List<String> roles, List<String> permissions) {
        signIn(null, tenantId, roles, permissions);
    }

    /** {@code tokenType} null = a workspace token (canonical sign-in mints no token_type). */
    private static void signIn(String tokenType, String tenantId, List<String> roles, List<String> permissions) {
        Map<String, Object> claims = new java.util.HashMap<>(Map.of("sub", UUID.randomUUID().toString(),
                "tenant_id", tenantId, "email", "x@example.com", "roles", roles, "permissions", permissions));
        if (tokenType != null) claims.put("token_type", tokenType);
        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"), claims);
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
        permissions.forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, authorities));
    }

    private void expectEveryEndpointRefused() throws Exception {
        for (String[] e : ENDPOINTS) {
            var req = request(HttpMethod.valueOf(e[0]), e[1]);
            if (e[2] != null) req = req.contentType(MediaType.APPLICATION_JSON).content(e[2]);
            mvc.perform(req).andExpect(result -> assertThat(result.getResponse().getStatus())
                    .as(e[0] + " " + e[1]).isEqualTo(403));
        }
        backends.forEach(b -> verifyNoInteractions(b));
    }

    @Test
    void aBusinessOwnerTokenIsRefusedEverywhereEvenWithEveryPlatformPermission() throws Exception {
        signIn(WORKSPACE, List.of("OWNER", "SUPER_ADMIN"), ALL_PLATFORM_PERMS);
        expectEveryEndpointRefused();
    }

    @Test
    void aBusinessSuperAdminTokenIsRefusedEverywhere() throws Exception {
        signIn(WORKSPACE, List.of("SUPER_ADMIN"), List.of("rbac.role.write", "workspace.users.read"));
        expectEveryEndpointRefused();
    }

    @Test
    void aWorkspaceTokenNamingThePlatformRoleIsRefusedEverywhere() throws Exception {
        signIn(WORKSPACE, List.of("PLATFORM_SUPER_ADMIN"), ALL_PLATFORM_PERMS);
        expectEveryEndpointRefused();
    }

    @Test
    void aWorkspaceSessionInThePlatformTenantIsRefusedEverywhere() throws Exception {
        // F1: what the business sign-in (/v1/canonical-auth/login, refresh) minted for an operator before
        // 9 Oct 2026: the platform tenant and PLATFORM_SUPER_ADMIN, but no token_type=platform.
        signIn(PLATFORM_TENANT, List.of("PLATFORM_SUPER_ADMIN"), ALL_PLATFORM_PERMS);
        expectEveryEndpointRefused();
    }

    @Test
    void anotherTokenTypeInThePlatformTenantIsRefusedEverywhere() throws Exception {
        signIn("station", PLATFORM_TENANT, List.of("PLATFORM_SUPER_ADMIN"), ALL_PLATFORM_PERMS);
        expectEveryEndpointRefused();
    }

    @Test
    void aPlatformTokenTypeForABusinessIsRefusedEverywhere() throws Exception {
        signIn("platform", WORKSPACE, List.of("PLATFORM_SUPER_ADMIN"), ALL_PLATFORM_PERMS);
        expectEveryEndpointRefused();
    }

    @Test
    void thePlatformOperatorGetsIn() throws Exception {
        signIn("platform", PLATFORM_TENANT, List.of("PLATFORM_SUPER_ADMIN"), ALL_PLATFORM_PERMS);
        mvc.perform(request(HttpMethod.GET, "/v1/platform/admin/settings/billing")).andExpect(status().isOk());
        mvc.perform(request(HttpMethod.GET, "/v1/platform/admin/marketing/channels")).andExpect(status().isOk());
    }

    @Test
    void theListAboveIsEveryEndpointAndEachIsGuardedByThePlatformAdminCheck() {
        int handlers = 0;
        for (Class<?> c : CONTROLLERS) {
            for (Method m : c.getDeclaredMethods()) {
                boolean handler = m.isAnnotationPresent(GetMapping.class) || m.isAnnotationPresent(PostMapping.class)
                        || m.isAnnotationPresent(PutMapping.class) || m.isAnnotationPresent(DeleteMapping.class);
                if (!handler) continue;
                handlers++;
                PreAuthorize pre = m.getAnnotation(PreAuthorize.class);
                assertThat(pre).as(c.getSimpleName() + "." + m.getName()).isNotNull();
                assertThat(pre.value()).as(c.getSimpleName() + "." + m.getName())
                        .startsWith("@platformAdmin.check(authentication)");
            }
        }
        assertThat(ENDPOINTS).as("one request per handler").hasSize(handlers);
    }
}
