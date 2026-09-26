package com.hrms.api.workforce;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.employee.entity.Employee;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Who gets the admin dashboard's history view (a past ?date=): notices archived
 * since are the company view's only (org.company.read), and a manager's top
 * performers on a past day use the team as it was then.
 */
class DashboardPastDateAccessTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final UUID tenant = UUID.randomUUID();
    private final UUID company = UUID.randomUUID();
    private final LocalDate past = LocalDate.now(DashboardAsOf.IST).minusYears(1);

    @BeforeEach void tenant() {
        TenantContext.setTenantId(tenant);
        // Notices count: today's list has 2 arguments, a past day's has 5.
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq(tenant), eq(company))).thenReturn(0L);
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq(tenant), eq(company), any(), any(), any())).thenReturn(0L);
    }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Authentication holding(String... permissions) {
        return new TestingAuthenticationToken("user", "n/a", permissions);
    }

    @Test void aPastDayListsThatDaysNoticesForTheCompanyView() {
        new CompanyNoticeController(jdbc).list(company, 0, past, holding("org.company.read"));
        verify(jdbc).queryForList(contains("updated_at>=?"), eq(tenant), eq(company), any(), eq(past), any(), eq(0));
        verify(jdbc, never()).queryForList(contains("CURRENT_DATE"), eq(tenant), eq(company), eq(0));
    }

    @Test void withoutCompanyReadAPastDayGetsTodaysNotices() {
        new CompanyNoticeController(jdbc).list(company, 0, past, holding("hrms.ess.read"));
        verify(jdbc).queryForList(contains("CURRENT_DATE"), eq(tenant), eq(company), eq(0));
        verify(jdbc, never()).queryForList(contains("updated_at>=?"), eq(tenant), eq(company), any(), eq(past), any(), eq(0));
    }

    @Test void todayOrNoDateIsTodaysListForEveryone() {
        CompanyNoticeController notices = new CompanyNoticeController(jdbc);
        notices.list(company, 0, null, holding("org.company.read"));
        notices.list(company, 0, LocalDate.now(DashboardAsOf.IST), holding("org.company.read"));
        verify(jdbc, times(2)).queryForList(contains("CURRENT_DATE"), eq(tenant), eq(company), eq(0));
    }

    @Test @SuppressWarnings("unchecked") void aManagersPastPerformersUseTheTeamAsItWas() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        DashboardHistory history = mock(DashboardHistory.class);
        Employee leaver = mock(Employee.class);
        UUID leaverId = UUID.randomUUID();
        when(leaver.getId()).thenReturn(leaverId);
        when(scope.resolve(any(), isNull(), any(Function.class))).thenReturn(List.of(leaver));
        Jwt jwt = mock(Jwt.class);

        new AdminDashboardController(jdbc, scope, history).performers(company, past, jwt, holding("hrms.performance.read"));

        ArgumentCaptor<Function<UUID, List<Employee>>> former = ArgumentCaptor.forClass(Function.class);
        verify(scope).resolve(eq(jwt), isNull(), former.capture());
        verify(scope, never()).resolve(any(), any());
        former.getValue().apply(company);
        verify(history).formerStaff(tenant, company, past);
        // The query keeps the reviews submitted by that day, for the team then (the leaver included).
        Object[] call = mockingDetails(jdbc).getInvocations().stream()
                .filter(i -> i.getMethod().getName().equals("queryForList")).findFirst().orElseThrow().getRawArguments();
        assertTrue(((String) call[0]).contains("r.submitted_at < ?"));
        assertTrue(Arrays.asList((Object[]) call[1]).contains(leaverId));
    }

    @Test void aManagersPerformersTodayUseTodaysTeam() {
        TeamEmployeeScope scope = mock(TeamEmployeeScope.class);
        when(scope.resolve(any(), isNull())).thenReturn(List.of());
        new AdminDashboardController(jdbc, scope, mock(DashboardHistory.class)).performers(company, null, mock(Jwt.class), holding("hrms.performance.read"));
        verify(scope).resolve(any(), isNull());
        verify(scope, never()).resolve(any(), any(), any());
    }
}
