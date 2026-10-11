package com.hrms.api.roster;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.api.roster.RosterContract.DraftBody;
import com.hrms.api.roster.RosterContract.LockVersionBody;
import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.PeriodType;
import com.hrms.api.roster.RosterContract.PlanRequest;
import com.hrms.api.roster.RosterContract.PublishBody;
import com.hrms.api.roster.RosterContract.RosterConfig;
import com.hrms.api.roster.RosterContract.RosterSettingsBody;
import com.hrms.api.roster.RosterContract.StaggerMode;
import com.hrms.api.roster.RosterContract.TemplateBody;
import com.hrms.api.roster.RosterContract.WeeklyOffMode;
import com.hrms.api.roster.plan.PlanFactsLoader;
import com.hrms.api.roster.plan.PlannerPeople;
import com.hrms.api.roster.plan.RosterPlanningController;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Shift planning's pilot on every endpoint family (owner, 11 Oct 2026). For a business that is not on the list,
 * rotation patterns, roster settings, rosters (list, read, save, delete, check, publish, discard, history, and the
 * drafts the Excel import saves through), schedule me/team and the planner's people and preview all answer 403
 * FEATURE_NOT_ENABLED before they read or write anything (not one database call), even for a request that would be
 * refused anyway (a period too long). A business on the list gets past the pilot to the next check: here the fake
 * database has no tables (FEATURE_NOT_READY) and knows no company (the planner's scope); what a listed business does
 * after that is what the rest of this package's tests cover, with the pilot on. The import's own calls (template,
 * validate, apply, export) are covered in hrms-app, RosterImportServiceTest.
 */
class RosterPilotEndpointsTest {

    private static final LocalDate OCT1 = LocalDate.of(2026, 10, 1);
    /** A period the endpoints refuse anyway (more than 62 days): the pilot answers first. */
    private static final LocalDate TOO_LATE = OCT1.plusDays(90);

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), id = UUID.randomUUID();
    private final Jwt jwt = RosterFakes.jwt(UUID.randomUUID(), UUID.randomUUID(), RosterAuth.PLAN, RosterAuth.PUBLISH,
            RosterAuth.WORKFORCE_ADMIN, RosterAuth.POLICY_MANAGE, "attendance.checkin.self", "attendance.team.read");

    private JdbcTemplate jdbc;
    private RosterStore store;
    private ShiftCatalog shifts;
    private RosterPlanning planning;
    private EffectiveSchedule schedule;
    private TeamEmployeeScope team;
    private PlanFactsLoader facts;
    private PlannerPeople people;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenant);
        jdbc = mock(JdbcTemplate.class);
        store = mock(RosterStore.class);
        shifts = mock(ShiftCatalog.class);
        planning = mock(RosterPlanning.class);
        schedule = mock(EffectiveSchedule.class);
        team = mock(TeamEmployeeScope.class);
        facts = mock(PlanFactsLoader.class);
        people = mock(PlannerPeople.class);
    }

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    /** Every shift-planning call of hrms-api, by name, wired to the same pilot. */
    private Map<String, Executable> everyCall(RosterPilot pilot) {
        RosterTables tables = new RosterTables(jdbc, pilot);
        PlannerScopeService scope = new PlannerScopeService(jdbc, pilot);
        RosterService rosters = new RosterService(store, tables, scope, shifts, planning);
        RosterPublisher publisher = new RosterPublisher(rosters, store, tables, scope, shifts, planning);
        RotationTemplateService templates = new RotationTemplateService(jdbc, tables, scope, shifts);
        RosterSettingsService settings = new RosterSettingsService(jdbc, tables);
        ScheduleController days = new ScheduleController(schedule, tables, team);
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("plannerScope", scope);
        RosterPlanningController planner = new RosterPlanningController(beans.getBeanProvider(PlannerScope.class), facts, people);

        RosterConfig config = new RosterConfig(null, List.of(), true, WeeklyOffMode.ROTATIONAL, StaggerMode.SPREAD, null,
                List.of(), List.of());
        DraftBody draft = new DraftBody("October", PeriodType.MONTH, OCT1, OCT1.plusDays(30), null, null, config,
                List.of(), List.of(), List.of(), 0);
        TemplateBody pattern = new TemplateBody("Off", null, true, List.of(new PatternDay(null, true)));
        Actor hr = new Actor(UUID.randomUUID(), UUID.randomUUID(), "HR", company, true, Set.of(), true);
        PlanRequest tooLong = new PlanRequest(OCT1, TOO_LATE, null, null, null, config, List.of(), List.of(), List.of(), true, true);

        Map<String, Executable> calls = new LinkedHashMap<>();
        calls.put("patterns.list", () -> templates.list(jwt, company));
        calls.put("patterns.create", () -> templates.create(jwt, company, pattern));
        calls.put("patterns.replace", () -> templates.replace(jwt, id, pattern));
        calls.put("patterns.delete", () -> templates.delete(jwt, id));
        calls.put("settings.get", () -> settings.get(jwt, company));
        calls.put("settings.update", () -> settings.update(jwt, company, new RosterSettingsBody(480)));
        calls.put("rosters.list", () -> rosters.list(jwt, company, null, null));
        calls.put("rosters.create", () -> rosters.create(jwt, company, draft));
        calls.put("rosters.get", () -> rosters.get(jwt, id));
        calls.put("rosters.replace", () -> rosters.replace(jwt, id, draft));
        calls.put("rosters.delete", () -> rosters.delete(jwt, id));
        calls.put("rosters.check", () -> rosters.check(jwt, id));
        calls.put("rosters.publish", () -> publisher.publish(jwt, id, new PublishBody(0, true, null)));
        calls.put("rosters.discard", () -> publisher.discard(jwt, id, new LockVersionBody(0)));
        calls.put("rosters.history", () -> rosters.history(jwt, id, null));
        calls.put("drafts.create (import)", () -> rosters.create(company, draft, hr, RosterDrafts.SOURCE_IMPORT));
        calls.put("drafts.replace (import)", () -> rosters.replace(id, draft, hr));
        calls.put("schedule.me", () -> days.me(jwt, OCT1, TOO_LATE));
        calls.put("schedule.team", () -> days.team(jwt, OCT1, TOO_LATE, null));
        calls.put("planner.people", () -> planner.people(jwt, company, null, null, OCT1, TOO_LATE));
        calls.put("planner.preview", () -> planner.preview(jwt, company, tooLong));
        return calls;
    }

    @Test
    void aBusinessOutsideThePilotIsRefusedOnEveryEndpointAndNothingIsReadOrWritten() {
        Map<String, Executable> calls = everyCall(new RosterFakes.Pilot(false));
        assertEquals(21, calls.size());
        calls.forEach((name, call) -> {
            HrmsException e = assertThrows(HrmsException.class, call, name);
            assertEquals(403, e.getStatus().value(), name);
            assertEquals("FEATURE_NOT_ENABLED", e.getErrorCode(), name);
        });
        verifyNoInteractions(jdbc, store, shifts, planning, schedule, team, facts, people);
    }

    @Test
    void aBusinessInThePilotGetsPastItToTheNextCheck() {
        everyCall(new RosterFakes.Pilot(true)).forEach((name, call) -> {
            if (name.startsWith("planner.")) {
                // the planner's people and preview ask the scope next, which finds no such company here
                assertThrows(ResourceNotFoundException.class, call, name);
            } else {
                // every other call asks for the tables next, and this database has none
                assertThrows(FeatureNotReady.class, call, name);
            }
        });
    }

    @Test
    void theWebCanAlwaysAskWhetherShiftPlanningIsOn() {
        assertFalse(new RosterController(null, null, null, new RosterFakes.Pilot(false)).availability().enabled());
        assertTrue(new RosterController(null, null, null, new RosterFakes.Pilot(true)).availability().enabled());
    }
}
