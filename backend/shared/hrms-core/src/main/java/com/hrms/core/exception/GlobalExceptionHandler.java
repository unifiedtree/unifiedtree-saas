package com.hrms.core.exception;

import com.hrms.core.dto.ErrorResponse;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(HrmsException.class)
    public ResponseEntity<ErrorResponse> handle(HrmsException ex) {
        log.warn("Business exception [{}]: {}", ex.getErrorCode(), ex.getMessage());
        return ResponseEntity.status(ex.getStatus())
                .body(ErrorResponse.of(ex.getStatus().value(), ex.getErrorCode(), ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handle(MethodArgumentNotValidException ex) {
        List<String> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .toList();
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "VALIDATION_FAILED", String.join("; ", errors)));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorResponse> handle(ConstraintViolationException ex) {
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "CONSTRAINT_VIOLATION", ex.getMessage()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handle(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of(403, "ACCESS_DENIED", "You do not have permission to perform this action"));
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ErrorResponse> handle(AuthenticationException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ErrorResponse.of(401, "UNAUTHORIZED", "Authentication required"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ErrorResponse> handle(ResponseStatusException ex) {
        int status = ex.getStatusCode().value();
        String reason = ex.getReason() != null ? ex.getReason() : "Request failed";
        return ResponseEntity.status(ex.getStatusCode())
                .body(ErrorResponse.of(status, ex.getStatusCode().toString(), reason));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handle(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of(404, "NOT_FOUND", "The requested resource was not found"));
    }

    /**
     * Malformed request body — invalid JSON, an unknown enum value, a wrong field
     * type, etc. This is a CLIENT error (400), not a server error: mapping it here
     * keeps it out of 500 error-rate alerting/dashboards (otherwise the catch-all
     * below would log it as an "Unhandled exception" and return 500).
     *
     * <p>The response message is sanitized — the previous version echoed the raw
     * Jackson diagnostic to callers, which leaked implementation classes such as
     * {@code org.springframework.util.StreamUtils$NonClosingInputStream} and the
     * full Jackson class chain. The full detail is kept server-side in the log.
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handle(HttpMessageNotReadableException ex) {
        Throwable cause = ex.getMostSpecificCause();
        String detail = cause != null ? cause.getMessage() : ex.getMessage();
        log.warn("Malformed request body: {}", detail);
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "INVALID_REQUEST",
                        "Request body is malformed or missing a required value"));
    }

    /**
     * A date/time string in a request body or query param failed to parse
     * (e.g. "2026-13-40" for a LocalDate). Same reasoning as {@link
     * #handle(HttpMessageNotReadableException)}: CLIENT error, sanitized
     * message. Without this, the parse exception bubbles up and is reported as
     * a 500, poisoning error-rate dashboards and leaking Jackson class chains.
     */
    @ExceptionHandler(DateTimeParseException.class)
    public ResponseEntity<ErrorResponse> handle(DateTimeParseException ex) {
        log.warn("Invalid date/time value in request: {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "INVALID_DATE_FORMAT",
                        "A date/time value in the request is not in a recognised format"));
    }

    /**
     * JPA optimistic-lock miss — two writers loaded the same row and both tried
     * to write it back. The correct HTTP status is 409 Conflict, not 500: the
     * client can (and usually should) reload and retry. Without this mapping the
     * catch-all below logged it as an unexpected server error and returned 500.
     */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handle(ObjectOptimisticLockingFailureException ex) {
        log.warn("Optimistic lock conflict on {} id={}", ex.getPersistentClassName(), ex.getIdentifier());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of(409, "CONCURRENT_UPDATE",
                        "This record was modified by someone else. Reload and try again."));
    }

    /**
     * A required query/form parameter is absent, or a parameter can't be converted to
     * its target type (e.g. a malformed UUID). Both are CLIENT errors (400) — without
     * these handlers they fall through to the catch-all below and surface as 500s,
     * polluting server-error alerting. (This gap previously turned a missing/required
     * `companyId` on GET /v1/onboarding/templates into a 500.)
     */
    @ExceptionHandler({MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ErrorResponse> handleBadRequestParam(Exception ex) {
        log.warn("Bad request parameter: {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "INVALID_PARAMETER",
                        ex.getMessage() != null ? ex.getMessage() : "A request parameter is missing or invalid"));
    }

    /**
     * Wrong HTTP method for an existing path (e.g. POST to a GET-only endpoint). This is a
     * CLIENT error (405), not a server error — without this it falls through to the catch-all
     * below and surfaces as a 500, polluting error-rate alerting. (This gap turned a POST to
     * the GET-only /v1/rbac/roles into a 500.)
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handle(HttpRequestMethodNotSupportedException ex) {
        log.warn("Method not allowed: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ErrorResponse.of(405, "METHOD_NOT_ALLOWED",
                        ex.getMessage() != null ? ex.getMessage() : "HTTP method not supported for this endpoint"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handle(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.internalServerError()
                .body(ErrorResponse.of(500, "INTERNAL_ERROR", "An unexpected error occurred"));
    }
}
