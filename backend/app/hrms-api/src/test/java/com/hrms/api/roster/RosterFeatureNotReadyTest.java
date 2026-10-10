package com.hrms.api.roster;

import com.hrms.core.exception.FeatureNotReady;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * While V143.106 is not applied (production applies migrations by hand, later), every shift-planning
 * call answers 503 FEATURE_NOT_READY before touching anything (guarantee G7); once the tables are
 * there the answer is kept.
 */
class RosterFeatureNotReadyTest {

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(UUID.randomUUID());
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    /** The catalog says "missing" until {@code applied} is set. */
    static final class Catalog extends JdbcTemplate {
        boolean applied;
        final AtomicInteger asked = new AtomicInteger();

        @Override
        @SuppressWarnings("unchecked")
        public <T> T queryForObject(String sql, Class<T> type) {
            asked.incrementAndGet();
            assertTrue(sql.contains("to_regclass('attendance.schedule_days')"), sql);
            return (T) Boolean.valueOf(applied);
        }
    }

    @Test
    void everyCallIsFeatureNotReadyWhileTheTablesAreMissing() {
        Catalog catalog = new Catalog();
        RosterTables tables = new RosterTables(catalog);
        assertFalse(tables.ready());
        FeatureNotReady e = assertThrows(FeatureNotReady.class, tables::require);
        assertEquals(503, e.getStatus().value());
        assertEquals("FEATURE_NOT_READY", e.getErrorCode());

        PlannerScope scope = new PlannerScope() {
            @Override public Actor actor(Jwt jwt, UUID companyId) { throw new AssertionError("asked before the tables"); }
            @Override public void check(Actor a, UUID departmentId, java.util.Collection<UUID> employeeIds) { throw new AssertionError(); }
        };
        RosterService rosters = new RosterService(new RosterFakes.Store(), tables, scope, new RosterFakes.Shifts(), new RosterFakes.Planning());
        RosterPublisher publisher = new RosterPublisher(rosters, new RosterFakes.Store(), tables, scope, new RosterFakes.Shifts(), new RosterFakes.Planning());
        RotationTemplateService templates = new RotationTemplateService(catalog, tables, scope, new RosterFakes.Shifts());
        RosterSettingsService settings = new RosterSettingsService(catalog, tables);
        Jwt jwt = RosterFakes.jwt(UUID.randomUUID(), UUID.randomUUID(), RosterAuth.PLAN, RosterAuth.PUBLISH, RosterAuth.WORKFORCE_ADMIN);
        UUID id = UUID.randomUUID();
        List<org.junit.jupiter.api.function.Executable> calls = List.of(
                () -> rosters.list(jwt, null, null, null),
                () -> rosters.get(jwt, id),
                () -> rosters.create(jwt, null, null),
                () -> rosters.replace(jwt, id, null),
                () -> rosters.delete(jwt, id),
                () -> rosters.check(jwt, id),
                () -> rosters.history(jwt, id, null),
                () -> publisher.publish(jwt, id, new RosterContract.PublishBody(0, true, null)),
                () -> publisher.discard(jwt, id, new RosterContract.LockVersionBody(0)),
                () -> templates.list(jwt, null),
                () -> templates.create(jwt, null, null),
                () -> templates.replace(jwt, id, null),
                () -> templates.delete(jwt, id),
                () -> settings.get(jwt, null),
                () -> settings.update(jwt, null, new RosterContract.RosterSettingsBody(480)),
                () -> ScheduleController.range(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)));
        for (int i = 0; i < calls.size() - 1; i++) {
            assertThrows(FeatureNotReady.class, calls.get(i), "call " + i);
        }
        assertDoesNotThrow(calls.get(calls.size() - 1), "a range check needs no table");

        catalog.applied = true;
        assertTrue(tables.ready());
        int asked = catalog.asked.get();
        assertTrue(tables.ready());
        assertEquals(asked, catalog.asked.get(), "once there, the tables aren't asked about again");
    }
}
