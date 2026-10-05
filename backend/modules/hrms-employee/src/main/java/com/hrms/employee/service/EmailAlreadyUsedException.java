package com.hrms.employee.service;

import com.hrms.core.exception.HrmsException;
import org.springframework.http.HttpStatus;

/**
 * 409 EMAIL_ALREADY_USED: the email is already another employee's work or
 * personal email (or another employee's login) in this workspace. The message
 * names that person only when the caller may see them
 * ({@link EmployeeContactGuard#callerMaySeeOwners()}).
 */
public class EmailAlreadyUsedException extends HrmsException {

    public EmailAlreadyUsedException(String message) {
        super(message, HttpStatus.CONFLICT, EmployeeContactGuard.EMAIL_ALREADY_USED);
    }
}
