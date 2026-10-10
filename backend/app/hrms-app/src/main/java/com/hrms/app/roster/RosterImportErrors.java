package com.hrms.app.roster;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

/** The error answers of the roster import, template and export (design §1.5 "Error codes"). */
final class RosterImportErrors {

    private RosterImportErrors() {}

    /** 400 {@code IMPORT_FILE_INVALID}: the file can't be read, or (on apply) still has errors. */
    static HrmsException fileInvalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "IMPORT_FILE_INVALID");
    }

    /** 400 {@code ROSTER_RANGE_INVALID}. */
    static HrmsException rangeInvalid(String message) {
        return new HrmsException(message, HttpStatus.BAD_REQUEST, "ROSTER_RANGE_INVALID");
    }

    /** 409 {@code ROSTER_PUBLISHED}: an import only ever fills a draft. */
    static HrmsException published() {
        return new HrmsException("This roster is published. Import into a new draft, or change it in the planner.",
                HttpStatus.CONFLICT, "ROSTER_PUBLISHED");
    }

    /** 403 {@code ROSTER_SCOPE}. */
    static HrmsException scope(String message) {
        return new HrmsException(message, HttpStatus.FORBIDDEN, "ROSTER_SCOPE");
    }
}
