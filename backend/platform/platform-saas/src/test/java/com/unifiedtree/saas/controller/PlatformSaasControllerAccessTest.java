package com.unifiedtree.saas.controller;

import com.unifiedtree.saas.security.PlatformAdminAccess;
import com.unifiedtree.saas.service.SaasService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The sign-up approval endpoints, through Spring's own method security (the
 * controller's real @PreAuthorize). Only a platform admin token, the one
 * {@code POST /v1/platform/auth/login} issues, gets in. A business owner's token
 * is refused even when it still carries platform.tenant.* (SUPER_ADMIN held them
 * until V143_92), so no owner can list other businesses' contact details or
 * approve / reject their sign-ups.
 */
class PlatformSaasControllerAccessTest {

    private static final String PLATFORM_TENANT = SaasService.PLATFORM_TENANT_ID.toString();
    private static final String WORKSPACE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    private static final UUID OTHER_BUSINESS = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final List<String> PLATFORM_PERMS = List.of(
            "platform.admin", "platform.tenant.read", "platform.tenant.approve", "platform.tenant.reject");
    private static final String APPROVE_BODY = "{\"approvedModules\":[\"hrms\"]}";
    private static final String REJECT_BODY = "{\"reason\":\"QA\"}";

    /** Turns on @PreAuthorize for the beans registered below (not a @Configuration, so no scan picks it up). */
    @EnableMethodSecurity
    static class MethodSecurityOn {}

    /** A refused call answers 403, as the real app's exception handler does. */
    @RestControllerAdvice
    static class Refusals {
        @ExceptionHandler(AccessDeniedException.class)
        ResponseEntity<Void> refused() { return ResponseEntity.status(HttpStatus.FORBIDDEN).build(); }
    }

    private AnnotationConfigApplicationContext context;
    private SaasService saas;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        saas = mock(SaasService.class);
        when(saas.listTenantRequests(any())).thenReturn(List.of());
        context = new AnnotationConfigApplicationContext();
        context.register(MethodSecurityOn.class);
        context.registerBean("platformAdmin", PlatformAdminAccess.class, PlatformAdminAccess::new);
        context.registerBean(PlatformSaasController.class, () -> new PlatformSaasController(saas));
        context.refresh();
        mvc = MockMvcBuilders.standaloneSetup(context.getBean(PlatformSaasController.class))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new Refusals())
                .build();
    }

    @AfterEach
    void tearDown() {
        context.close();
        SecurityContextHolder.clearContext();
    }

    /** Signs in with the authorities CanonicalProdSecurityConfig builds: ROLE_<role> plus each permission. */
    private static void signIn(String tenantId, List<String> roles, List<String> permissions) {
        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", UUID.randomUUID().toString(), "tenant_id", tenantId,
                        "roles", roles, "permissions", permissions));
        List<GrantedAuthority> authorities = new ArrayList<>();
        roles.forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
        permissions.forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, authorities));
    }

    private void expectAll(ResultMatcher expected) throws Exception {
        mvc.perform(get("/v1/platform/tenant-requests")).andExpect(expected);
        mvc.perform(post("/v1/platform/tenant-requests/" + OTHER_BUSINESS + "/approve")
                .contentType(MediaType.APPLICATION_JSON).content(APPROVE_BODY)).andExpect(expected);
        mvc.perform(post("/v1/platform/tenant-requests/" + OTHER_BUSINESS + "/reject")
                .contentType(MediaType.APPLICATION_JSON).content(REJECT_BODY)).andExpect(expected);
    }

    private void expectNothingRead() {
        verify(saas, never()).listTenantRequests(any());
        verify(saas, never()).approveTenant(any(), any(), any());
        verify(saas, never()).rejectTenant(any(), any(), any());
    }

    @Test
    void aBusinessOwnerTokenWithTheOldPlatformGrantsIsRefused() throws Exception {
        // What every sign-up owner's token carried before V143_92: OWNER + SUPER_ADMIN, platform.* included.
        signIn(WORKSPACE, List.of("SUPER_ADMIN", "OWNER"), PLATFORM_PERMS);
        expectAll(status().isForbidden());
        expectNothingRead();
    }

    @Test
    void aBusinessOwnerTokenAfterTheFixIsRefused() throws Exception {
        signIn(WORKSPACE, List.of("SUPER_ADMIN", "OWNER"), List.of("rbac.role.write", "workspace.users.read"));
        expectAll(status().isForbidden());
        expectNothingRead();
    }

    @Test
    void aWorkspaceTokenNamingThePlatformRoleIsStillRefused() throws Exception {
        // Even if someone in a workspace held PLATFORM_SUPER_ADMIN, their token is for their workspace.
        signIn(WORKSPACE, List.of("PLATFORM_SUPER_ADMIN"), PLATFORM_PERMS);
        expectAll(status().isForbidden());
        expectNothingRead();
    }

    @Test
    void aPlatformTenantTokenWithoutThePlatformRoleIsRefused() throws Exception {
        signIn(PLATFORM_TENANT, List.of("SUPER_ADMIN"), PLATFORM_PERMS);
        expectAll(status().isForbidden());
        expectNothingRead();
    }

    @Test
    void aPlatformAdminWithoutTheCodeIsRefused() throws Exception {
        signIn(PLATFORM_TENANT, List.of("PLATFORM_SUPER_ADMIN"), List.of("platform.admin"));
        expectAll(status().isForbidden());
        expectNothingRead();
    }

    @Test
    void thePlatformAdminListsApprovesAndRejects() throws Exception {
        signIn(PLATFORM_TENANT, List.of("PLATFORM_SUPER_ADMIN"), PLATFORM_PERMS);
        expectAll(status().isOk());
        verify(saas).listTenantRequests(null);
        verify(saas).approveTenant(any(), any(), any());
        verify(saas).rejectTenant(any(), any(), any());
    }

    @Test
    void noSignInIsRefused() {
        SecurityContextHolder.clearContext();
        org.junit.jupiter.api.Assertions.assertFalse(new PlatformAdminAccess().check(null));
    }
}
