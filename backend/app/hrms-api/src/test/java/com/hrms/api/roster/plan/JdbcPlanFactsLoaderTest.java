package com.hrms.api.roster.plan;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.roster.BaselineSchedule;
import com.hrms.api.roster.RosterContract.OverlayType;
import com.hrms.core.exception.FeatureNotReady;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

/** The loader's own rules that need no database (the SQL itself: {@link JdbcPlanFactsLoaderSqlTest}). */
class JdbcPlanFactsLoaderTest {

    private static final LocalDate SEP30 = LocalDate.of(2026, 9, 30), OCT31 = LocalDate.of(2026, 10, 31);

    @Test
    void severalLeavesOnOneDay() {
        PlanFacts.Leave fullL = new PlanFacts.Leave(OverlayType.L, "Casual leave", false);
        PlanFacts.Leave halfL = new PlanFacts.Leave(OverlayType.L, "Sick leave", true);
        PlanFacts.Leave halfCoff = new PlanFacts.Leave(OverlayType.COFF, "Comp off", true);
        assertEquals(fullL, JdbcPlanFactsLoader.merge(List.of(halfL, fullL)), "a full day wins");
        assertEquals(halfL, JdbcPlanFactsLoader.merge(List.of(halfL)));
        assertEquals(new PlanFacts.Leave(OverlayType.L, "Sick leave", false), JdbcPlanFactsLoader.merge(List.of(halfL, halfCoff)),
                "two half days are the whole day off");
    }

    @Test
    void aBaselineThatIsNotBuiltYetIsNotReadyRatherThanAGuess() {
        BaselineSchedule notYet = (tenant, ids, from, to) -> {
            throw new UnsupportedOperationException("waits for the resolver");
        };
        JdbcPlanFactsLoader loader = new JdbcPlanFactsLoader(mock(JdbcTemplate.class), notYet, new ObjectMapper());
        assertThrows(FeatureNotReady.class, () -> loader.load(UUID.randomUUID(), UUID.randomUUID(), null,
                List.of(UUID.randomUUID()), SEP30, OCT31));
    }

    @Test
    void aMissingShiftPlanningTableIsNotReady() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        BadSqlGrammarException missing = new BadSqlGrammarException("select", "SELECT … attendance.schedule_days",
                new SQLException("relation \"attendance.schedule_days\" does not exist", "42P01"));
        doThrow(missing).when(jdbc).query(any(PreparedStatementCreator.class), any(RowCallbackHandler.class));
        JdbcPlanFactsLoader loader = new JdbcPlanFactsLoader(jdbc, (t, ids, f, to) -> java.util.Map.of(), new ObjectMapper());
        assertThrows(FeatureNotReady.class, () -> loader.load(UUID.randomUUID(), UUID.randomUUID(), null,
                List.of(UUID.randomUUID()), SEP30, OCT31));
    }

    @Test
    void anyOtherDatabaseErrorIsNotHidden() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        BadSqlGrammarException syntax = new BadSqlGrammarException("select", "SELECT",
                new SQLException("syntax error", "42601"));
        doThrow(syntax).when(jdbc).query(any(PreparedStatementCreator.class), any(RowCallbackHandler.class));
        JdbcPlanFactsLoader loader = new JdbcPlanFactsLoader(jdbc, (t, ids, f, to) -> java.util.Map.of(), new ObjectMapper());
        assertThrows(BadSqlGrammarException.class, () -> loader.load(UUID.randomUUID(), UUID.randomUUID(), null,
                List.of(UUID.randomUUID()), SEP30, OCT31));
    }
}
