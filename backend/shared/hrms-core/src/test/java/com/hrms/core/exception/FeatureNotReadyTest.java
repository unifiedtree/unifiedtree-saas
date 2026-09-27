package com.hrms.core.exception;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.core.dto.ErrorResponse;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.InvalidDataAccessResourceUsageException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.BadSqlGrammarException;

import java.sql.BatchUpdateException;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A new feature whose migration is not applied yet answers 503 FEATURE_NOT_READY
 * ("This isn’t switched on yet."), and every other database error is left exactly
 * as it was (DECISIONS 18).
 */
class FeatureNotReadyTest {

    private static BadSqlGrammarException badSql(String state) {
        return new BadSqlGrammarException("query", "SELECT 1 FROM hrms.new_table",
                new SQLException("relation or column does not exist", state));
    }

    @Test void undefinedTableBecomesFeatureNotReady() {
        BadSqlGrammarException cause = badSql("42P01");
        RuntimeException out = FeatureNotReady.translate(cause);
        FeatureNotReady f = assertInstanceOf(FeatureNotReady.class, out);
        assertEquals(503, f.getStatus().value());
        assertEquals("FEATURE_NOT_READY", f.getErrorCode());
        assertEquals("This isn’t switched on yet.", f.getMessage());
        assertSame(cause, f.getCause(), "the database error stays as the cause, for the server log");
        assertInstanceOf(HrmsException.class, f, "it is an HrmsException, so the global handler renders it");
    }

    @Test void undefinedColumnBecomesFeatureNotReady() {
        assertInstanceOf(FeatureNotReady.class, FeatureNotReady.translate(badSql("42703")));
    }

    @Test void otherGrammarErrorsAreRethrownUnchanged() {
        BadSqlGrammarException syntax = badSql("42601");        // syntax error: a real bug, not a missing migration
        assertSame(syntax, FeatureNotReady.translate(syntax));
        BadSqlGrammarException noFunction = badSql("42883");    // undefined function
        assertSame(noFunction, FeatureNotReady.translate(noFunction));
    }

    @Test void otherDatabaseErrorsAreRethrownUnchanged() {
        DuplicateKeyException duplicate = new DuplicateKeyException("dup", new SQLException("duplicate key", "23505"));
        assertSame(duplicate, FeatureNotReady.translate(duplicate));
        DataRetrievalFailureException noSql = new DataRetrievalFailureException("no rows");
        assertSame(noSql, FeatureNotReady.translate(noSql));
        BadSqlGrammarException noState = badSql(null);
        assertSame(noState, FeatureNotReady.translate(noState));
    }

    @Test void findsTheStateOnABatchsNextException() {
        BatchUpdateException batch = new BatchUpdateException("batch failed", null, 0, new int[0], null);
        batch.setNextException(new SQLException("relation does not exist", "42P01"));
        BadSqlGrammarException e = new BadSqlGrammarException("batch", "INSERT …", batch);
        assertInstanceOf(FeatureNotReady.class, FeatureNotReady.translate(e));
    }

    @Test void findsTheStateDeeperInTheCauseChain() {
        // What JPA or a wrapping layer produces: the SQLException is not the direct cause.
        DataAccessException wrapped = new InvalidDataAccessResourceUsageException("could not prepare statement",
                new RuntimeException("hibernate", new SQLException("column does not exist", "42703")));
        assertTrue(FeatureNotReady.isMissingSchema(wrapped));
        assertInstanceOf(FeatureNotReady.class, FeatureNotReady.translate(wrapped));
    }

    @Test void isMissingSchemaSurvivesNullsAndOddChains() {
        assertFalse(FeatureNotReady.isMissingSchema(null));
        assertFalse(FeatureNotReady.isMissingSchema(new IllegalStateException("no sql here")));
        SQLException self = new SQLException("loop", "08000");
        self.setNextException(self);                            // a next-exception loop must not hang
        assertFalse(FeatureNotReady.isMissingSchema(self));
    }

    @Test void guardReturnsTheValueAndTranslatesOnlyMissingSchema() {
        assertEquals("ok", FeatureNotReady.guard(() -> "ok"));
        assertThrows(FeatureNotReady.class, () -> FeatureNotReady.guard(() -> { throw badSql("42P01"); }));

        DuplicateKeyException duplicate = new DuplicateKeyException("dup");
        DuplicateKeyException thrown = assertThrows(DuplicateKeyException.class,
                () -> FeatureNotReady.guard(() -> { throw duplicate; }));
        assertSame(duplicate, thrown);

        IllegalStateException notDatabase = new IllegalStateException("not a database error");
        assertSame(notDatabase, assertThrows(IllegalStateException.class,
                () -> FeatureNotReady.guard(() -> { throw notDatabase; })));
    }

    @Test void runWorksLikeGuard() {
        AtomicBoolean ran = new AtomicBoolean();
        FeatureNotReady.run(() -> ran.set(true));
        assertTrue(ran.get());
        assertThrows(FeatureNotReady.class, () -> FeatureNotReady.run(() -> { throw badSql("42703"); }));
        BadSqlGrammarException syntax = badSql("42601");
        assertSame(syntax, assertThrows(BadSqlGrammarException.class, () -> FeatureNotReady.run(() -> { throw syntax; })));
    }

    @Test void aServiceCanThrowItDirectly() {
        FeatureNotReady f = new FeatureNotReady();
        assertEquals(503, f.getStatus().value());
        assertEquals("FEATURE_NOT_READY", f.getErrorCode());
        assertNull(f.getCause());
    }

    /**
     * A column typo is also 42703, so every answer is logged as a WARN with the
     * database's own message; a real bug can't hide as "not ready".
     */
    @Test void everyAnswerIsLoggedWithTheDatabaseMessage() {
        Logger logger = (Logger) LoggerFactory.getLogger(FeatureNotReady.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            FeatureNotReady.translate(new BadSqlGrammarException("query", "SELECT x FROM hrms.team_messages",
                    new SQLException("ERROR: column \"sender_emp_id\" does not exist", "42703")));
            assertEquals(1, appender.list.size());
            ILoggingEvent mapped = appender.list.get(0);
            assertEquals(Level.WARN, mapped.getLevel());
            assertTrue(mapped.getFormattedMessage().contains("42703"), mapped.getFormattedMessage());
            assertTrue(mapped.getFormattedMessage().contains("column \"sender_emp_id\" does not exist"), mapped.getFormattedMessage());
            assertTrue(mapped.getFormattedMessage().contains("SELECT x FROM hrms.team_messages"), "names the statement: " + mapped.getFormattedMessage());

            appender.list.clear();
            FeatureNotReady.translate(badSql("42601"));          // not mapped: nothing logged here
            assertTrue(appender.list.isEmpty());

            new FeatureNotReady();                               // a service's own check
            assertEquals(1, appender.list.size());
            assertEquals(Level.WARN, appender.list.get(0).getLevel());
            assertTrue(appender.list.get(0).getFormattedMessage().contains(FeatureNotReadyTest.class.getName()),
                    "names the caller: " + appender.list.get(0).getFormattedMessage());
        } finally {
            logger.detachAppender(appender);
        }
    }

    /** The global handler answers 503 with {timestamp, status, errorCode, message}, and the SQL never leaks. */
    @Test void theGlobalHandlerAnswers503WithTheErrorCodeInTheJsonBody() throws Exception {
        RuntimeException thrown = FeatureNotReady.translate(badSql("42P01"));
        ResponseEntity<ErrorResponse> r = new GlobalExceptionHandler().handle((HrmsException) thrown);
        assertEquals(503, r.getStatusCode().value());
        ErrorResponse body = r.getBody();
        assertNotNull(body);
        assertEquals(503, body.status());
        assertEquals("FEATURE_NOT_READY", body.errorCode());
        assertEquals("This isn’t switched on yet.", body.message());

        JsonNode json = new ObjectMapper().findAndRegisterModules().valueToTree(body);
        assertEquals("FEATURE_NOT_READY", json.path("errorCode").asText());
        assertEquals(503, json.path("status").asInt());
        assertEquals("This isn’t switched on yet.", json.path("message").asText());
        assertTrue(json.has("timestamp"));
        assertFalse(json.toString().contains("new_table"), "the SQL must not reach the caller");
    }
}
