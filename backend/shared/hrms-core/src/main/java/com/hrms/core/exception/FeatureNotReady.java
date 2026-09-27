package com.hrms.core.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;

import java.sql.SQLException;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * "This isn’t switched on yet": the answer a new feature gives while its
 * database migration is not applied (redesign DECISIONS 18).
 *
 * <p>New features read and write their new tables and columns with JDBC only,
 * and production applies each migration by hand, later. Until then PostgreSQL
 * answers SQL state {@code 42P01} (undefined table) or {@code 42703} (undefined
 * column), which Spring's JDBC exception translation turns into a
 * {@link org.springframework.jdbc.BadSqlGrammarException}. On its own that is a
 * 500. Through this helper the service answers {@code 503} with
 * {@code errorCode FEATURE_NOT_READY} and the message above (the global handler
 * renders every {@link HrmsException} as {@code {timestamp, status, errorCode,
 * message}}). The web app then shows that block's "not available yet" or empty
 * state, hides its actions and does not retry.
 *
 * <pre>
 * // wrap the JDBC work
 * return FeatureNotReady.guard(() -> jdbc.query(...));
 *
 * // or translate in a catch block
 * } catch (BadSqlGrammarException e) {
 *     throw FeatureNotReady.translate(e);
 * }
 *
 * // a service that checked to_regclass(...) itself
 * throw new FeatureNotReady();
 * </pre>
 *
 * <p>Only those two SQL states are translated. Every other database error is
 * rethrown unchanged, so real faults still surface as they do today. A typo in
 * a column name is also 42703, so every answer is logged as a WARN with the
 * database's own message: once a feature's migration is applied, any of these
 * lines in the log is a bug to fix, not "not ready".
 *
 * <p><b>Transactions.</b> PostgreSQL aborts the whole transaction on any error,
 * so use this when the missing table should fail the request. A service that
 * must carry on without the new table inside the same transaction (for example
 * to leave an optional field null) checks {@code to_regclass('schema.table')}
 * first instead of catching the error.
 */
public final class FeatureNotReady extends HrmsException {

    private static final Logger log = LoggerFactory.getLogger(FeatureNotReady.class);

    public static final String CODE = "FEATURE_NOT_READY";
    public static final String MESSAGE = "This isn’t switched on yet.";

    /** PostgreSQL {@code undefined_table}. */
    public static final String UNDEFINED_TABLE = "42P01";
    /** PostgreSQL {@code undefined_column}. */
    public static final String UNDEFINED_COLUMN = "42703";

    /** How far down a cause chain (and a {@link SQLException#getNextException()} chain) to look. */
    private static final int MAX_DEPTH = 16;

    /** For a service's own check (for example {@code to_regclass(...)} returned null). Logged like a mapped error. */
    public FeatureNotReady() {
        this(null);
    }

    /** @param cause the database error, kept and logged for the server; never shown to the caller */
    public FeatureNotReady(Throwable cause) {
        super(MESSAGE, HttpStatus.SERVICE_UNAVAILABLE, CODE);
        if (cause != null) initCause(cause);
        logAnswer(cause);
    }

    /**
     * True when {@code error}, or anything it was caused by, is a
     * {@link SQLException} whose SQL state says a table or column does not
     * exist yet.
     */
    public static boolean isMissingSchema(Throwable error) {
        return missingSchemaError(error) != null;
    }

    /**
     * The exception to throw for a database error: a {@code FeatureNotReady}
     * when the table or column is missing, otherwise {@code error} itself,
     * unchanged. Use as {@code throw FeatureNotReady.translate(e);}.
     */
    public static RuntimeException translate(DataAccessException error) {
        return isMissingSchema(error) ? new FeatureNotReady(error) : error;
    }

    /** Runs {@code work}; a missing table or column becomes {@code FeatureNotReady}, anything else is rethrown as it is. */
    public static <T> T guard(Supplier<T> work) {
        try {
            return work.get();
        } catch (DataAccessException e) {
            throw translate(e);
        }
    }

    /** {@link #guard(Supplier)} for work that returns nothing. */
    public static void run(Runnable work) {
        try {
            work.run();
        } catch (DataAccessException e) {
            throw translate(e);
        }
    }

    /**
     * One WARN per answer: the database's own message (which table or column is
     * missing) and the failing statement, or where a service's own check raised
     * it. Statements carry no values: JDBC binds them as parameters.
     */
    private void logAnswer(Throwable cause) {
        if (cause != null) {
            SQLException sql = missingSchemaError(cause);
            log.warn("FEATURE_NOT_READY (SQL state {}): {} [{}]. If this feature's migration is applied, this is a bug.",
                    sql == null ? "none" : sql.getSQLState(),
                    sql == null ? "no database message" : sql.getMessage(),
                    cause.getMessage());
        } else {
            StackTraceElement[] where = getStackTrace();
            log.warn("FEATURE_NOT_READY raised by {} without a database error. If this feature's migration is applied, that check is wrong.",
                    where.length > 0 ? where[0] : "an unknown caller");
        }
    }

    /**
     * The {@link SQLException} whose state is 42P01 or 42703, looking through
     * the error, what it was caused by, and a batch's chain of "next"
     * exceptions; null when there is none.
     */
    private static SQLException missingSchemaError(Throwable error) {
        Map<Throwable, Boolean> seen = new IdentityHashMap<>();
        Throwable t = error;
        for (int depth = 0; t != null && depth < MAX_DEPTH && seen.put(t, Boolean.TRUE) == null; depth++) {
            SQLException s = t instanceof SQLException sql ? sql : null;
            for (int i = 0; s != null && i < MAX_DEPTH; i++) {
                String state = s.getSQLState();
                if (UNDEFINED_TABLE.equals(state) || UNDEFINED_COLUMN.equals(state)) return s;
                SQLException next = s.getNextException();
                s = next == s ? null : next;
            }
            t = t.getCause();
        }
        return null;
    }
}
