package com.hrms.api.roster;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

/**
 * The error answers of the roster, pattern and schedule endpoints (design §1.5 "Error codes"). The
 * global handler renders each as {@code {timestamp, status, errorCode, message}}; the two that carry
 * the checks are {@link RosterChecksException}.
 */
final class RosterErrors {

    private RosterErrors() {}

    static HrmsException scope(String message) {
        return new HrmsException(message, HttpStatus.FORBIDDEN, "ROSTER_SCOPE");
    }

    static HrmsException rangeInvalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "ROSTER_RANGE_INVALID");
    }

    /** The shape of a roster body is wrong (a name, a member, a staffing line, a day). */
    static HrmsException invalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "ROSTER_INVALID");
    }

    static HrmsException templateInvalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "TEMPLATE_INVALID");
    }

    static HrmsException templateNameTaken() {
        return new HrmsException("A pattern with this name already exists. Choose another name.",
                HttpStatus.CONFLICT, "TEMPLATE_NAME_TAKEN");
    }

    static HrmsException changed() {
        return new HrmsException("Someone else saved this roster. Reload to see their changes.",
                HttpStatus.CONFLICT, "ROSTER_CHANGED");
    }

    static HrmsException published() {
        return new HrmsException("This roster has been published, so it is kept. Change its days and publish again instead.",
                HttpStatus.CONFLICT, "ROSTER_PUBLISHED");
    }

    static HrmsException notPublished() {
        return new HrmsException("This roster hasn't been published yet, so there are no published days to go back to.",
                HttpStatus.CONFLICT, "ROSTER_NOT_PUBLISHED");
    }

    static HrmsException periodLocked() {
        return new HrmsException("The dates, department and building of a published roster can't change. Plan a new roster instead.",
                HttpStatus.CONFLICT, "ROSTER_PERIOD_LOCKED");
    }

    static HrmsException pastDays(String message) {
        return new HrmsException(message, HttpStatus.CONFLICT, "ROSTER_PAST_DAYS");
    }

    static HrmsException settingsInvalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "ROSTER_SETTINGS_INVALID");
    }

    static HrmsException companyRequired() {
        return new HrmsException("Choose the company first.", HttpStatus.BAD_REQUEST, "COMPANY_REQUIRED");
    }
}
