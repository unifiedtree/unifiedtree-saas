package com.hrms.api.roster;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

import java.time.Instant;

/**
 * A publish refused by the schedule check (design §1.5): 409 {@code ROSTER_HAS_ERRORS} (an error
 * blocks publishing) or 409 {@code ROSTER_HAS_WARNINGS} (send again with
 * {@code acknowledgeWarnings: true}). The body is the usual error body plus the checks, so the
 * publish dialog can list them: {@code {timestamp, status, errorCode, message, checks}}.
 */
public class RosterChecksException extends HrmsException {

    public static final String HAS_ERRORS = "ROSTER_HAS_ERRORS";
    public static final String HAS_WARNINGS = "ROSTER_HAS_WARNINGS";

    /** The 409 body: {@link com.hrms.core.dto.ErrorResponse}'s fields and the checks. */
    public record Body(Instant timestamp, int status, String errorCode, String message, RosterContract.Checks checks) {}

    private final transient RosterContract.Checks checks;

    private RosterChecksException(String message, String code, RosterContract.Checks checks) {
        super(message, HttpStatus.CONFLICT, code);
        this.checks = checks;
    }

    static RosterChecksException errors(RosterContract.Checks checks) {
        int n = checks.errors().size();
        return new RosterChecksException(n == 1 ? "Fix 1 error before publishing." : "Fix " + n + " errors before publishing.",
                HAS_ERRORS, checks);
    }

    static RosterChecksException warnings(RosterContract.Checks checks) {
        int n = checks.warnings().size();
        return new RosterChecksException((n == 1 ? "1 warning" : n + " warnings")
                + " to look at. Tick \"Publish with warnings\" to publish anyway.", HAS_WARNINGS, checks);
    }

    public RosterContract.Checks checks() {
        return checks;
    }

    public Body body() {
        return new Body(Instant.now(), getStatus().value(), getErrorCode(), getMessage(), checks);
    }
}
