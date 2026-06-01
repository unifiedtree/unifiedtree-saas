package com.hrms.core.exception;

import org.springframework.http.HttpStatus;

public class TenantAccessException extends HrmsException {

    public TenantAccessException() {
        super("Access denied — resource belongs to a different tenant",
              HttpStatus.FORBIDDEN, "TENANT_ACCESS_DENIED");
    }
}
