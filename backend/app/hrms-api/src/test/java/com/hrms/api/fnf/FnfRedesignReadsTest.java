package com.hrms.api.fnf;

import com.hrms.api.advance.PayFinancialYear;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.fnf.dto.FnfSettlementResponse;
import com.hrms.fnf.entity.FnfSettlement;
import com.hrms.fnf.enums.FnfStatus;
import com.hrms.fnf.repository.FnfComponentRepository;
import com.hrms.fnf.repository.FnfSettlementRepository;
import com.hrms.fnf.service.FnfService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * BW-64: the settlements list's filters, the ledger's totals and the status
 * of each leaver's most recent settlement, whose literal path must win over
 * {@code /settlements/{id}} (before, "status" was read as an id: 400).
 */
class FnfRedesignReadsTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CALLER = UUID.randomUUID();

    private final FnfService fnf = mock(FnfService.class);
    private final FnfReadService reads = mock(FnfReadService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        FnfController controller = new FnfController(fnf, mock(EmployeeRepository.class), reads,
                mock(WorkforceDepartmentRepository.class), jdbc);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver(),
                        new org.springframework.data.web.PageableHandlerMethodArgumentResolver()).build();
        Jwt jwt = new Jwt("t", Instant.now(), Instant.now().plusSeconds(60), Map.of("alg", "none"),
                Map.of("sub", UUID.randomUUID().toString(), "employee_id", CALLER.toString()));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        TenantContext.clear();
    }

    // ── routing and permissions ──────────────────────────────────────────────

    @Test
    void theStatusPathIsNotTakenForASettlementId() throws Exception {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        when(reads.statusFor(eq(TENANT), anyList())).thenReturn(List.of());
        mvc.perform(get("/v1/fnf/settlements/status").param("employeeIds", b + "," + a))
                .andExpect(status().isOk());
        verify(reads).statusFor(TENANT, List.of(b, a));
        verify(fnf, never()).getSettlement(any());
        // A real id still reaches the single settlement.
        UUID id = UUID.randomUUID();
        when(fnf.getSettlement(id)).thenReturn(settlement(id, UUID.randomUUID()));
        mvc.perform(get("/v1/fnf/settlements/" + id)).andExpect(status().isOk());
        verify(fnf).getSettlement(id);
    }

    @Test
    void theSummaryUsesTheCallersFinancialYear() throws Exception {
        mvc.perform(get("/v1/fnf/summary")).andExpect(status().isOk());
        verify(reads).summary(eq(TENANT), any(PayFinancialYear.class));
    }

    @Test
    void theListPassesItsOptionalFiltersAndWithoutThemIsTodaysCall() throws Exception {
        PageResponse<FnfSettlementResponse> empty = new PageResponse<>(List.of(), 0, 20, 0, 0, true);
        when(fnf.getSettlements(any(), any(), any(Pageable.class))).thenReturn(empty);
        UUID employee = UUID.randomUUID();
        mvc.perform(get("/v1/fnf/settlements").param("status", "PROCESSED,APPROVED").param("employeeId", employee.toString()))
                .andExpect(status().isOk());
        verify(fnf).getSettlements(eq(List.of(FnfStatus.PROCESSED, FnfStatus.APPROVED)), eq(employee), any(Pageable.class));
        mvc.perform(get("/v1/fnf/settlements")).andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
        verify(fnf).getSettlements(isNull(), isNull(), any(Pageable.class));
    }

    @Test
    void everyNewReadNeedsFnfRead() throws Exception {
        for (String name : List.of("statusFor", "summary", "list")) {
            Method m = java.util.Arrays.stream(FnfController.class.getDeclaredMethods())
                    .filter(x -> x.getName().equals(name)).findFirst().orElseThrow();
            assertEquals("hasAuthority('hrms.fnf.read')", m.getAnnotation(PreAuthorize.class).value(), name);
        }
    }

    // ── the service's filters ────────────────────────────────────────────────

    @Test
    void theServicePicksTheQueryForEachFilterAndKeepsTodaysWithNone() {
        FnfSettlementRepository repo = mock(FnfSettlementRepository.class);
        FnfService service = new FnfService(repo, mock(FnfComponentRepository.class), mock(JdbcTemplate.class));
        Pageable page = PageRequest.of(0, 20);
        Page<FnfSettlement> none = new PageImpl<>(List.of(), page, 0);
        UUID employee = UUID.randomUUID();
        List<FnfStatus> statuses = List.of(FnfStatus.PAID);
        when(repo.findAllByOrderByCreatedAtDesc(page)).thenReturn(none);
        when(repo.findByStatusInOrderByCreatedAtDesc(statuses, page)).thenReturn(none);
        when(repo.findByEmployeeIdOrderByCreatedAtDesc(employee, page)).thenReturn(none);
        when(repo.findByEmployeeIdAndStatusInOrderByCreatedAtDesc(employee, statuses, page)).thenReturn(none);

        service.getSettlements(null, null, page);
        service.getSettlements(List.of(), null, page);
        verify(repo, times(2)).findAllByOrderByCreatedAtDesc(page);
        service.getSettlements(statuses, null, page);
        verify(repo).findByStatusInOrderByCreatedAtDesc(statuses, page);
        service.getSettlements(null, employee, page);
        verify(repo).findByEmployeeIdOrderByCreatedAtDesc(employee, page);
        service.getSettlements(statuses, employee, page);
        verify(repo).findByEmployeeIdAndStatusInOrderByCreatedAtDesc(employee, statuses, page);
    }

    // ── the status read ──────────────────────────────────────────────────────

    @Test
    void idsAreReadInOrderOnceEachAndBadOnesGetTheirOwnCode() {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        assertEquals(List.of(b, a), FnfReadService.parseIds(" " + b + ",," + a + "," + b + " "));
        assertEquals(List.of(), FnfReadService.parseIds(null));
        assertEquals(List.of(), FnfReadService.parseIds(" "));
        HrmsException bad = assertThrows(HrmsException.class, () -> FnfReadService.parseIds(a + ",status"));
        // Never INVALID_PARAMETER: the web reads that one as "not built yet".
        assertEquals("INVALID_EMPLOYEE_ID", bad.getErrorCode());
        assertEquals(400, bad.getStatus().value());
        String many = String.join(",", Collections.nCopies(FnfReadService.MAX_IDS + 1, "")
                .stream().map(x -> UUID.randomUUID().toString()).toList());
        assertEquals("TOO_MANY_EMPLOYEES", assertThrows(HrmsException.class, () -> FnfReadService.parseIds(many)).getErrorCode());
    }

    @Test
    void eachPersonGetsTheirLatestSettlementOrNullsInTheOrderAsked() throws Exception {
        UUID withOne = UUID.randomUUID(), without = UUID.randomUUID(), settlementId = UUID.randomUUID();
        Instant paid = Instant.parse("2026-09-20T06:00:00Z");
        doAnswer(inv -> {
            String sql = inv.getArgument(0);
            assertTrue(sql.contains("DISTINCT ON (employee_id)") && sql.contains("ORDER BY employee_id, created_at DESC"), sql);
            assertTrue(sql.contains("tenant_id = ?"), sql);
            Object[] args = (Object[]) inv.getRawArguments()[2];
            assertEquals(TENANT, args[0]);
            ResultSet rs = mock(ResultSet.class);
            when(rs.getObject("employee_id", UUID.class)).thenReturn(withOne);
            when(rs.getObject("id", UUID.class)).thenReturn(settlementId);
            when(rs.getString("status")).thenReturn("PAID");
            when(rs.getDate("last_working_day")).thenReturn(java.sql.Date.valueOf(LocalDate.of(2026, 9, 15)));
            when(rs.getBigDecimal("net_settlement")).thenReturn(new BigDecimal("48210.00"));
            when(rs.getTimestamp("paid_at")).thenReturn(Timestamp.from(paid));
            ((RowCallbackHandler) inv.getArgument(1)).processRow(rs);
            return null;
        }).when(jdbc).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));

        List<FnfReadService.FnfStatusRow> rows = new FnfReadService(jdbc).statusFor(TENANT, List.of(without, withOne));
        assertEquals(2, rows.size());
        assertEquals(new FnfReadService.FnfStatusRow(without, null, null, null, null, null), rows.get(0));
        assertEquals(new FnfReadService.FnfStatusRow(withOne, settlementId, FnfStatus.PAID, LocalDate.of(2026, 9, 15),
                new BigDecimal("48210.00"), paid), rows.get(1));
        assertEquals(List.of(), new FnfReadService(jdbc).statusFor(TENANT, new ArrayList<>()));
    }

    @Test
    void theTotalsReadTheTenantsLedgerForTheYear() {
        PayFinancialYear year = PayFinancialYear.of(Month.APRIL, LocalDate.of(2026, 9, 27));
        assertEquals(LocalDate.of(2026, 4, 1), year.start());
        assertEquals(LocalDate.of(2027, 3, 31), year.end());
        when(jdbc.query(anyString(), any(org.springframework.jdbc.core.ResultSetExtractor.class), any(Object[].class)))
                .thenAnswer(inv -> {
                    String sql = inv.getArgument(0);
                    assertTrue(sql.contains("status = 'PROCESSED'") && sql.contains("status = 'APPROVED'")
                            && sql.contains("status = 'PAID' AND paid_at >= ? AND paid_at < ?"), sql);
                    Object[] args = (Object[]) inv.getRawArguments()[2];
                    assertEquals(year.startsAt(), args[0]);
                    assertEquals(year.endsBefore(), args[1]);
                    assertEquals(TENANT, args[4]);
                    return null;
                });
        new FnfReadService(jdbc).summary(TENANT, year);
        verify(jdbc).query(anyString(), any(org.springframework.jdbc.core.ResultSetExtractor.class), any(Object[].class));
    }

    private static FnfSettlementResponse settlement(UUID id, UUID employee) {
        return new FnfSettlementResponse(id, employee, null, null, UUID.randomUUID(), LocalDate.of(2026, 9, 15),
                FnfStatus.PROCESSED, BigDecimal.TEN, BigDecimal.ZERO, BigDecimal.TEN, null, null, null, null, null,
                Instant.now(), List.of());
    }
}
