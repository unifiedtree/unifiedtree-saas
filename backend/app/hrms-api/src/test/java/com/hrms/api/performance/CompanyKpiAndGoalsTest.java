package com.hrms.api.performance;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.audit.AuditService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** BW-83 company KPI roll-up and link rules; BW-82 goal tiles in the caller's scope. */
class CompanyKpiAndGoalsTest {

    private final UUID tenant = UUID.randomUUID();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final CompanyKpiService kpis = new CompanyKpiService(jdbc, mock(AuditService.class));

    @AfterEach void clear() { SecurityContextHolder.clearContext(); }

    private void tablesExist(boolean exist) {
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(exist);
    }

    @Test void rollUpIsTheWeightedAverageOfLinkedGoalsCappedAt100() {
        assertNull(CompanyKpiService.rollUp(List.of()), "no linked goal: no progress yet");
        assertEquals(75, CompanyKpiService.rollUp(List.of(new int[] { 100, 1 }, new int[] { 50, 1 })));
        assertEquals(88, CompanyKpiService.rollUp(List.of(new int[] { 100, 3 }, new int[] { 50, 1 })));
        assertEquals(100, CompanyKpiService.rollUp(List.of(new int[] { 180, 1 })), "a goal over 100% counts as 100");
        assertEquals(30, CompanyKpiService.rollUp(List.of(new int[] { 40, 0 }, new int[] { 20, 0 })), "all weights 0: equal");
    }

    @Test void titlesAndTargetsAreChecked() {
        assertEquals("CSAT above 4.5", CompanyKpiService.title("  CSAT above 4.5 "));
        assertEquals("TITLE_REQUIRED", assertThrows(BusinessRuleException.class, () -> CompanyKpiService.title(" ")).getErrorCode());
        assertEquals("INVALID_TARGET", assertThrows(BusinessRuleException.class, () -> CompanyKpiService.validate(
                new CompanyKpiService.CompanyKpiRequest(null, "x", null, BigDecimal.ZERO, null, null, null))).getErrorCode());
    }

    @Test void companyKpisAreNotReadyBeforeTheMigration() {
        tablesExist(false);
        assertThrows(FeatureNotReady.class, () -> kpis.list(tenant, null, false));
        assertThrows(FeatureNotReady.class, () -> kpis.requireLinkable(tenant, UUID.randomUUID(), UUID.randomUUID()));
        assertEquals(java.util.Map.of(), kpis.linksOf(tenant, UUID.randomUUID()), "goals simply carry no link");
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void aGoalLinksOnlyToAnOpenKpiOfItsOwnersCompany() throws Exception {
        tablesExist(true);
        UUID employee = UUID.randomUUID(), kpi = UUID.randomUUID();
        ResultSet rs = mock(ResultSet.class);
        when(rs.next()).thenReturn(true);
        when(rs.getBoolean("ok")).thenReturn(false);
        when(jdbc.query(contains("FROM performance_mgmt.company_kpis k"),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), any(Object[].class)))
                .thenAnswer(inv -> ((ResultSetExtractor<?>) inv.getArgument(1)).extractData(rs));
        assertEquals("COMPANY_KPI_NOT_LINKABLE", assertThrows(BusinessRuleException.class,
                () -> kpis.requireLinkable(tenant, employee, kpi)).getErrorCode());
        verify(jdbc).query(argThat((String sql) -> sql.contains("e.tenant_id = k.tenant_id") && sql.contains("WHERE k.tenant_id = ? AND k.id = ?")),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), eq(employee), eq(tenant), eq(kpi));
    }

    // ── BW-82 tiles ──────────────────────────────────────────────────────────

    @Test void tilesShowTheShareReachedAndAverage() {
        KpiService.KpiSummaryDto s = KpiService.summaryOf(8, 2, 1, 61);
        assertEquals(25, s.reachedPct());
        assertEquals(61, s.averageProgress());
        assertEquals(0, KpiService.summaryOf(0, 0, 0, 0).reachedPct());
    }

    @Test void anEmployeesTilesCountOnlyTheirOwnGoals() {
        UUID me = UUID.randomUUID();
        var jwt = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("employee_id", me.toString()).build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt,
                List.of(new SimpleGrantedAuthority("hrms.performance.read"))));
        new KpiService(jdbc, mock(PerformanceTeamScope.class)).summary(tenant);
        verify(jdbc).query(argThat((String sql) -> sql.contains("g.tenant_id = ? AND g.status <> 'DROPPED'")
                        && sql.contains("AND g.employee_id = ?")),
                org.mockito.ArgumentMatchers.<ResultSetExtractor<Object>>any(), eq(tenant), eq(me));
    }
}
