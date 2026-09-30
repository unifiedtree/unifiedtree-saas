package com.hrms.api.pli;

import com.hrms.api.advance.PayFinancialYear;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.pli.dto.PliAwardResponse;
import com.hrms.pli.entity.PliAward;
import com.hrms.pli.enums.PliStatus;
import com.hrms.pli.repository.PliAwardRepository;
import com.hrms.pli.repository.PliTargetRepository;
import com.hrms.pli.service.PliService;
import com.hrms.employee.workforce.entity.Department;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** BW-63: the awards' status filter, department, and the company and personal totals. */
class PliRedesignReadsTest {

    private static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static final UUID CALLER = UUID.randomUUID();

    private final PliService pli = mock(PliService.class);
    private final PliReadService reads = mock(PliReadService.class);
    private final EmployeeRepository employees = mock(EmployeeRepository.class);
    private final WorkforceDepartmentRepository departments = mock(WorkforceDepartmentRepository.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        mvc = MockMvcBuilders.standaloneSetup(new PliController(pli, employees, jdbc, reads, departments))
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

    @Test
    void theAwardsListFiltersByStatusAndNamesTheDepartment() throws Exception {
        UUID person = UUID.randomUUID(), dept = UUID.randomUUID(), award = UUID.randomUUID();
        when(pli.getAllAwards(anyList(), any(Pageable.class))).thenReturn(new PageResponse<>(List.of(
                new PliAwardResponse(award, person, null, null, UUID.randomUUID(), "Q3 bonus", "2026-09",
                        new BigDecimal("12000"), new BigDecimal("4.5"), PliStatus.PROPOSED, null, Instant.now(),
                        null, null, null, null)), 0, 20, 1, 1, true));
        Employee e = new Employee();
        e.setId(person);
        e.setFirstName("Asha");
        e.setLastName("Rao");
        e.setEmployeeCode("E7");
        e.setDepartmentId(dept);
        when(employees.findAllById(List.of(person))).thenReturn(List.of(e));
        Department d = mock(Department.class);
        when(d.getId()).thenReturn(dept);
        when(d.getName()).thenReturn("Operations");
        when(departments.findAllById(List.of(dept))).thenReturn(List.of(d));

        mvc.perform(get("/v1/pli/awards").param("status", "PROPOSED,APPROVED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].employeeName").value("Asha Rao"))
                .andExpect(jsonPath("$.content[0].departmentId").value(dept.toString()))
                .andExpect(jsonPath("$.content[0].departmentName").value("Operations"))
                // The rating basis stays a number (AUDIT §5.9).
                .andExpect(jsonPath("$.content[0].ratingBasis").value(4.5));
        verify(pli).getAllAwards(eq(List.of(PliStatus.PROPOSED, PliStatus.APPROVED)), any(Pageable.class));
    }

    @Test
    void withoutAStatusTheServiceRunsTodaysQuery() {
        PliAwardRepository repo = mock(PliAwardRepository.class);
        PliService service = new PliService(repo, mock(PliTargetRepository.class));
        Pageable page = PageRequest.of(0, 20);
        when(repo.findAllByOrderByCreatedAtDesc(page)).thenReturn(new PageImpl<PliAward>(List.of(), page, 0));
        when(repo.findByStatusInOrderByCreatedAtDesc(List.of(PliStatus.PAID), page)).thenReturn(new PageImpl<PliAward>(List.of(), page, 0));
        service.getAllAwards(null, page);
        service.getAllAwards(List.of(), page);
        verify(repo, times(2)).findAllByOrderByCreatedAtDesc(page);
        service.getAllAwards(List.of(PliStatus.PAID), page);
        verify(repo).findByStatusInOrderByCreatedAtDesc(List.of(PliStatus.PAID), page);
    }

    @Test
    void myTotalsAreForThePersonInTheToken() throws Exception {
        mvc.perform(get("/v1/pli/my/summary")).andExpect(status().isOk());
        verify(reads).mySummary(TENANT, CALLER);
        mvc.perform(get("/v1/pli/awards/summary")).andExpect(status().isOk());
        verify(reads).summary(eq(TENANT), any(PayFinancialYear.class));
    }

    @Test
    void theTotalsNeedTheSamePermissionsAsTheLists() {
        assertEquals("hasAuthority('hrms.pli.read')", pre("awardsSummary"));
        assertEquals("hasAuthority('hrms.pli.read')", pre("listAwards"));
        assertEquals("hasAuthority('hrms.pli.read.self')", pre("mySummary"));
    }

    @Test
    void theTotalsQueryTheTenantAndMyTotalsOnlyMyAwards() {
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            Object[] args = (Object[]) inv.getRawArguments()[2];
            if (sql.contains("employee_id = ?")) {
                assertArrayEquals(new Object[]{TENANT, CALLER}, args);
                assertTrue(sql.contains("status <> 'REJECTED'"), sql);
            } else {
                assertEquals(TENANT, args[4]);
                assertTrue(sql.contains("status = 'PAID' AND paid_at >= ? AND paid_at < ?"), sql);
            }
            return null;
        });
        PliReadService service = new PliReadService(jdbc);
        service.mySummary(TENANT, CALLER);
        service.summary(TENANT, PayFinancialYear.of(java.time.Month.APRIL, java.time.LocalDate.of(2026, 9, 27)));
        verify(jdbc, times(2)).query(anyString(), any(ResultSetExtractor.class), any(Object[].class));
    }

    private static String pre(String method) {
        Method m = java.util.Arrays.stream(PliController.class.getDeclaredMethods())
                .filter(x -> x.getName().equals(method)).findFirst().orElseThrow();
        return m.getAnnotation(PreAuthorize.class).value();
    }
}
