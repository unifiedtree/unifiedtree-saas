package com.hrms.api.payroll;

import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The new literal paths win over {@code /payslips/me/{runId}} (before, "schedule"
 * was read as a run id and answered 400), the old routes still reach their old
 * handlers, the person always comes from the token, and every new endpoint
 * carries the permission the plan names.
 */
class PayrollEndpointsRoutingTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID READER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER = UUID.randomUUID();

    private PayrollRunService runs;
    private MyPayService myPay;
    private PayslipQueryService queries;
    private PayrollRunInsightsService insights;
    private SalaryStructureListService structureList;
    private PayrollService payroll;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        runs = mock(PayrollRunService.class);
        myPay = mock(MyPayService.class);
        queries = mock(PayslipQueryService.class);
        insights = mock(PayrollRunInsightsService.class);
        structureList = mock(SalaryStructureListService.class);
        payroll = mock(PayrollService.class);
        mvc = MockMvcBuilders.standaloneSetup(
                        new PayrollRunController(runs), new MyPayController(myPay), new PayslipQueryController(queries),
                        new PayrollRunInsightsController(insights, runs), new SalaryStructureListController(structureList),
                        new EmployeeStructureController(payroll))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .build();
        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", USER.toString(), "employee_id", READER.toString()));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
        TenantContext.setTenantId(TENANT);
        TenantContext.setUserId(USER);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        TenantContext.clear();
    }

    @Test
    void theScheduleAndTheOtherMyPayPathsAreNotTakenForARunId() throws Exception {
        mvc.perform(get("/v1/payroll/payslips/me/schedule")).andExpect(status().isOk());
        verify(myPay).schedule(TENANT, READER);
        mvc.perform(get("/v1/payroll/payslips/me/ytd")).andExpect(status().isOk());
        verify(myPay).ytd(TENANT, READER);
        mvc.perform(get("/v1/payroll/payslips/me/upcoming")).andExpect(status().isOk());
        verify(myPay).upcoming(TENANT, READER);
        mvc.perform(get("/v1/payroll/payslips/me/queries")).andExpect(status().isOk());
        verify(queries).mine(TENANT, READER, null);
        verify(runs, never()).getMyPayslip(any(), any(), any());
    }

    @Test
    void theOldPayslipRoutesStillReachTheirHandlers() throws Exception {
        UUID run = UUID.randomUUID();
        mvc.perform(get("/v1/payroll/payslips/me")).andExpect(status().isOk());
        verify(runs).listMyPayslips(TENANT, READER);
        mvc.perform(get("/v1/payroll/payslips/me/" + run)).andExpect(status().isOk());
        verify(runs).getMyPayslip(TENANT, READER, run);
        mvc.perform(get("/v1/payroll/structures/me")).andExpect(status().isOk());
        verify(payroll).getCurrentStructure(TENANT, READER);
    }

    @Test
    void askingAndAnsweringTakeThePersonFromTheToken() throws Exception {
        UUID run = UUID.randomUUID(), query = UUID.randomUUID();
        mvc.perform(post("/v1/payroll/payslips/me/" + run + "/queries").contentType("application/json")
                .content("{\"message\":\"Why?\"}")).andExpect(status().isCreated());
        verify(queries).raise(TENANT, USER, READER, run, "Why?");
        mvc.perform(post("/v1/payroll/queries/" + query + "/answer").contentType("application/json")
                .content("{\"answer\":\"Because.\"}")).andExpect(status().isOk());
        verify(queries).answer(TENANT, USER, READER, query, "Because.");
        mvc.perform(post("/v1/payroll/payslips/me/" + run + "/queries").contentType("application/json")
                .content("{\"message\":\"\"}")).andExpect(status().isBadRequest());
        verify(queries, times(1)).raise(any(), any(), any(), any(), any());
    }

    @Test
    void theRunAndStructureReadsRoute() throws Exception {
        UUID run = UUID.randomUUID(), emp = UUID.randomUUID();
        mvc.perform(get("/v1/payroll/runs/" + run + "/checks")).andExpect(status().isOk());
        verify(insights).checks(TENANT, run);
        mvc.perform(get("/v1/payroll/runs/" + run + "/statutory")).andExpect(status().isOk());
        verify(insights).statutory(TENANT, run);
        mvc.perform(get("/v1/payroll/runs/" + run + "/bank-readiness")).andExpect(status().isOk());
        verify(insights).bankReadiness(TENANT, run);
        mvc.perform(get("/v1/payroll/employees/" + emp + "/payslips")).andExpect(status().isOk());
        verify(runs).listEmployeePayslips(TENANT, emp);
        mvc.perform(get("/v1/payroll/structures/summary")).andExpect(status().isOk());
        verify(structureList).summary(TENANT, null);
        mvc.perform(get("/v1/payroll/structures?noStructure=true&size=10&q=asha")).andExpect(status().isOk());
        verify(structureList).page(TENANT, null, "asha", true, 0, 10);
        mvc.perform(get("/v1/payroll/structures/me/history")).andExpect(status().isOk());
        verify(structureList).myHistory(eq(TENANT), eq(READER));
    }

    @Test
    void theOwnEmployeeIdComesOnlyFromTheEmployeeClaim() {
        Jwt withoutEmployee = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", USER.toString()));
        assertNull(MyPayController.ownEmployeeId(withoutEmployee), "never the account id instead");
        Jwt junk = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", USER.toString(), "employee_id", "not-a-uuid"));
        assertNull(MyPayController.ownEmployeeId(junk));
        assertNull(MyPayController.ownEmployeeId(null));
    }

    // ── permissions ───────────────────────────────────────────────────────────

    private static String guard(Class<?> controller, String method) {
        Method m = Arrays.stream(controller.getDeclaredMethods()).filter(x -> x.getName().equals(method))
                .findFirst().orElseThrow(() -> new AssertionError(controller.getSimpleName() + "." + method));
        PreAuthorize p = m.getAnnotation(PreAuthorize.class);
        assertNotNull(p, controller.getSimpleName() + "." + method + " has no @PreAuthorize");
        return p.value();
    }

    @Test
    void everyNewEndpointHasTheNamedPermission() {
        String self = "hasAuthority('payroll.payslip.read.self')";
        assertEquals(self, guard(MyPayController.class, "schedule"));
        assertEquals(self, guard(MyPayController.class, "ytd"));
        assertEquals(self, guard(MyPayController.class, "upcoming"));
        assertEquals(self, guard(PayslipQueryController.class, "mine"));
        assertEquals(self, guard(PayslipQueryController.class, "ask"));
        assertEquals("@perm.hasAny('payroll.runs.manage','payroll.queries.answer')", guard(PayslipQueryController.class, "list"));
        assertEquals("@perm.hasAny('payroll.runs.manage','payroll.queries.answer')", guard(PayslipQueryController.class, "answer"));
        assertEquals("hasAuthority('payroll.runs.read')", guard(PayrollRunInsightsController.class, "checks"));
        assertEquals("hasAuthority('payroll.runs.read')", guard(PayrollRunInsightsController.class, "statutory"));
        assertEquals("hasAuthority('hrms.disbursement.read')", guard(PayrollRunInsightsController.class, "bankReadiness"));
        assertEquals("hasAuthority('payroll.runs.read')", guard(PayrollRunInsightsController.class, "employeePayslips"));
        assertEquals("hasAuthority('payroll.structure.read')", guard(SalaryStructureListController.class, "page"));
        assertEquals("hasAuthority('payroll.structure.read')", guard(SalaryStructureListController.class, "summary"));
        assertEquals("hasAuthority('payroll.structure.read.self')", guard(SalaryStructureListController.class, "myHistory"));
    }
}
