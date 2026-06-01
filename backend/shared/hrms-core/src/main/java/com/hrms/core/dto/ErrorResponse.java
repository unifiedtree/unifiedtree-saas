package com.hrms.core.dto;

import java.time.Instant;

public record ErrorResponse(
        Instant timestamp,
        int status,
        String errorCode,
        String message
) {
    public static ErrorResponse of(int status, String errorCode, String message) {
        return new ErrorResponse(Instant.now(), status, errorCode, message);
    }
}
