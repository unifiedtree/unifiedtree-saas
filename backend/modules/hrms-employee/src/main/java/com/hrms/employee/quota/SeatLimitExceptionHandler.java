package com.hrms.employee.quota;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * Turns {@link SeatLimitExceededException} into an HTTP 402 with the
 * frontend-friendly JSON body the UI needs to render its "upgrade to add
 * more seats" state.
 *
 * <p>Kept as a dedicated advice so it runs before {@link
 * com.hrms.core.exception.GlobalExceptionHandler}'s generic HrmsException
 * handler swallows it (Spring picks the most specific match first). Emits
 * the actual exception {@code errorCode} so the {@code QUOTA_LOOKUP_FAILED}
 * fail-closed variant is distinguishable on the wire from the normal
 * {@code SEAT_LIMIT_EXCEEDED} reject.
 */
@RestControllerAdvice
public class SeatLimitExceptionHandler {

    @ExceptionHandler(SeatLimitExceededException.class)
    public ResponseEntity<Map<String, Object>> handle(SeatLimitExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(Map.of(
                "code",        ex.getErrorCode(),
                "message",     ex.getMessage(),
                "purchased",   ex.getPurchased(),
                "current",     ex.getCurrent(),
                "upgrade_url", ex.getUpgradeUrl()
        ));
    }
}
