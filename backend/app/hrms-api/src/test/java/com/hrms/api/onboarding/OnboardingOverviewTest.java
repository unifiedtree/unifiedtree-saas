package com.hrms.api.onboarding;

import com.hrms.api.hiring.FakeJdbc;
import com.hrms.employee.service.OnboardingService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/** BW-69: the New hires overview (rows, counts, scope) and "Used by N hires". */
class OnboardingOverviewTest {

    private final UUID tenant = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 27);

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Map<String, Object> row(String status, LocalDate joining, long total, long done, long overdue) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", UUID.randomUUID());
        m.put("employee_id", UUID.randomUUID());
        m.put("employee_name", "Asha Rao");
        m.put("employee_code", "E-1");
        m.put("company_id", UUID.randomUUID());
        m.put("department_id", UUID.randomUUID());
        m.put("department_name", "Design");
        m.put("date_of_joining", joining);
        m.put("template_id", UUID.randomUUID());
        m.put("template_name", "Engineering");
        m.put("status", status);
        m.put("started_at", null);
        m.put("completed_at", null);
        m.put("tasks_total", total);
        m.put("tasks_done", done);
        m.put("tasks_overdue", overdue);
        m.put("next_due_on", null);
        return m;
    }

    private FakeJdbc db() {
        return new FakeJdbc().on("FROM hrms.onboarding_instances i", List.of(
                row("IN_PROGRESS", LocalDate.of(2026, 9, 28), 5, 2, 1),
                row("IN_PROGRESS", LocalDate.of(2026, 8, 1), 3, 1, 2),
                row("ON_HOLD", LocalDate.of(2026, 9, 1), 4, 0, 3),
                row("COMPLETED", LocalDate.of(2026, 7, 1), 3, 3, 0)));
    }

    @Test void rowsCarryNameDepartmentJoiningChecklistAndCounts() {
        var o = new OnboardingOverviewService(db().jdbc).overview(null, null, null, TODAY);
        var first = o.rows().get(0);
        assertEquals("Asha Rao", first.employeeName());
        assertEquals("Design", first.departmentName());
        assertEquals("Engineering", first.templateName());
        assertEquals(LocalDate.of(2026, 9, 28), first.dateOfJoining());
        assertEquals(5, first.tasksTotal());
        assertEquals(2, first.tasksDone());
        assertEquals(1, first.tasksOverdue());
    }

    @Test void countsCoverEveryOnboardingInScopeWhateverTheStatusFilter() {
        var o = new OnboardingOverviewService(db().jdbc).overview(null, "COMPLETED", null, TODAY);
        assertEquals(1, o.rows().size(), "the filter narrows the rows");
        assertEquals(new OnboardingOverviewService.Counts(4, 2, 1, 1, 2, 3), o.counts(),
                "all 4; in progress 2; on hold 1; done 1; joining in September 2; overdue tasks only on runs in progress (1+2)");
    }

    @Test void theWorkspaceViewIsTenantScopedAndTheOwnViewIsTheCallersOnly() {
        FakeJdbc all = db();
        new OnboardingOverviewService(all.jdbc).overview(null, null, null, TODAY);
        var q = all.calls.get(0);
        assertEquals(List.of(TODAY, tenant), q.args());
        assertFalse(q.sql().contains("i.employee_id = ?"));

        UUID me = UUID.randomUUID(), company = UUID.randomUUID();
        FakeJdbc mine = db();
        new OnboardingOverviewService(mine.jdbc).overview(me, null, company, TODAY);
        var m = mine.calls.get(0);
        assertTrue(m.sql().contains("i.employee_id = ?") && m.sql().contains("e.company_id = ?"));
        assertEquals(List.of(TODAY, tenant, me, company), m.args());
    }

    private static Jwt jwt(String employeeId, String... permissions) {
        var b = Jwt.withTokenValue("t").header("alg", "none").claim("permissions", List.of(permissions));
        if (employeeId != null) b.claim("employee_id", employeeId);
        return b.build();
    }

    @Test void theControllerGivesManagersOfOnboardingEveryoneAndOthersTheirOwn() {
        OnboardingOverviewService overview = mock(OnboardingOverviewService.class);
        OnboardingController c = new OnboardingController(mock(OnboardingService.class), null, overview, mock(AssetCareService.class));
        UUID me = UUID.randomUUID();

        c.instancesOverview(null, null, jwt(me.toString(), "hrms.onboarding.instance.read", "hrms.onboarding.instance.write"));
        verify(overview).overview(isNull(), isNull(), isNull(), any());

        c.instancesOverview("IN_PROGRESS", null, jwt(me.toString(), "hrms.onboarding.instance.read"));
        verify(overview).overview(eq(me), eq("IN_PROGRESS"), isNull(), any());

        var none = c.instancesOverview(null, null, jwt(null, "hrms.onboarding.instance.read"));
        assertTrue(none.rows().isEmpty());
        assertEquals(0, none.counts().all());
        verifyNoMoreInteractions(overview);
    }

    @Test void usedByCountsOnboardingsPerTemplate() {
        UUID t1 = UUID.randomUUID();
        Map<String, Object> r = new HashMap<>();
        r.put("template_id", t1);
        r.put("n", 4L);
        FakeJdbc db = new FakeJdbc().on("GROUP BY template_id", List.of(r));
        assertEquals(Map.of(t1, 4L), new OnboardingOverviewService(db.jdbc).usageByTemplate());
        assertEquals(tenant, db.calls.get(0).args().get(0));
    }
}
