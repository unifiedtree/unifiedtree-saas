package com.hrms.api.payroll;

import com.hrms.core.exception.GlobalExceptionHandler;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * "Remove" on the Ask payroll queue: {@code DELETE /v1/payroll/queries/{id}},
 * through Spring's own method security (the controller's real @PreAuthorize).
 * The payroll team or HR (either queue code) take an answered question off the
 * queue (204); anyone else is refused (403) before anything is read; another
 * workspace's question is "not found" (404), because only the caller's
 * workspace, taken from the sign-in and never from the request, is looked in.
 */
class PayslipQueryRemoveEndpointTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID OTHER_TENANT = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static final UUID USER = UUID.randomUUID();
    private static final UUID QUERY = UUID.randomUUID();

    /** Turns on @PreAuthorize for the beans registered below (not a @Configuration, so no scan picks it up). */
    @EnableMethodSecurity
    static class MethodSecurityOn {}

    /** Stands in for PermissionChecker ({@code @perm}), which reads the same codes from the database. */
    public static final class HeldCodes {
        private Set<String> held = Set.of();
        public boolean hasAny(String... codes) { return Arrays.stream(codes).anyMatch(held::contains); }
    }

    private AnnotationConfigApplicationContext context;
    private PayslipQueryStore store;
    private HeldCodes perm;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        store = mock(PayslipQueryStore.class);
        perm = new HeldCodes();
        PayslipQueryService service = new PayslipQueryService(mock(JdbcTemplate.class), store,
                mock(PayslipQueryNotifier.class), mock(AuditService.class));
        context = new AnnotationConfigApplicationContext();
        context.register(MethodSecurityOn.class);
        context.registerBean("perm", HeldCodes.class, () -> perm);
        context.registerBean(PayslipQueryController.class, () -> new PayslipQueryController(service));
        context.refresh();
        mvc = MockMvcBuilders.standaloneSetup(context.getBean(PayslipQueryController.class))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", USER.toString()));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
        TenantContext.setTenantId(TENANT);
        TenantContext.setUserId(USER);
    }

    @AfterEach
    void tearDown() {
        context.close();
        SecurityContextHolder.clearContext();
        TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }

    private static PayslipQueryStore.QueryRow row(String status) {
        return new PayslipQueryStore.QueryRow(QUERY, UUID.randomUUID(), "Sep 2026", 9, 2026, UUID.randomUUID(),
                "Reader User", "EMP002", null, null, "Why is my September net lower?", status,
                "OPEN".equals(status) ? null : "Your advance recovery started.", "Finance Lead",
                null, "2026-09-27T09:00:00Z", UUID.randomUUID());
    }

    @Test
    void hrWithOnlyTheAnsweringCodeRemovesAnAnsweredQuestion() throws Exception {
        perm.held = Set.of("payroll.runs.read", "payroll.queries.answer");
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("ANSWERED")));
        when(store.close(TENANT, QUERY)).thenReturn(true);

        mvc.perform(delete("/v1/payroll/queries/" + QUERY)).andExpect(status().isNoContent());

        verify(store).close(TENANT, QUERY);
    }

    @Test
    void thePayrollTeamRemovesOneToo() throws Exception {
        perm.held = Set.of("payroll.runs.manage");
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("ANSWERED")));
        when(store.close(TENANT, QUERY)).thenReturn(true);

        mvc.perform(delete("/v1/payroll/queries/" + QUERY)).andExpect(status().isNoContent());

        verify(store).close(TENANT, QUERY);
    }

    @Test
    void anyoneElseIsRefusedBeforeAnythingIsRead() throws Exception {
        // An employee (own payslip only) and a manager who can read runs: neither may touch the queue.
        perm.held = Set.of("payroll.payslip.read.self", "payroll.runs.read");

        mvc.perform(delete("/v1/payroll/queries/" + QUERY)).andExpect(status().isForbidden());

        verifyNoInteractions(store);
    }

    @Test
    void anotherWorkspacesQuestionIsNotFound() throws Exception {
        perm.held = Set.of("payroll.queries.answer");
        // The question exists, but in another workspace: the caller's workspace has no such id.
        when(store.find(OTHER_TENANT, QUERY)).thenReturn(Optional.of(row("ANSWERED")));
        when(store.find(TENANT, QUERY)).thenReturn(Optional.empty());

        mvc.perform(delete("/v1/payroll/queries/" + QUERY))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.errorCode").value("QUERY_NOT_FOUND"));

        verify(store).find(TENANT, QUERY);
        verify(store, never()).find(OTHER_TENANT, QUERY);
        verify(store, never()).close(any(), any());
    }

    @Test
    void anOpenQuestionIsAnsweredFirst() throws Exception {
        perm.held = Set.of("payroll.queries.answer");
        when(store.find(TENANT, QUERY)).thenReturn(Optional.of(row("OPEN")));

        mvc.perform(delete("/v1/payroll/queries/" + QUERY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.errorCode").value("QUERY_NOT_ANSWERED"));

        verify(store, never()).close(any(), any());
    }
}
