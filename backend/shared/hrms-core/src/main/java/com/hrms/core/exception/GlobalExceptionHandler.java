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

    /**
     * An upload over the multipart limit (spring.servlet.multipart.max-file-size,
     * 10 MB in production) used to fall through to the catch-all 500 "An
     * unexpected error occurred". It is the client's file, so say what to do.
     * Per-type caps (document types, receipts) are still checked by each endpoint.
     */
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> handle(org.springframework.web.multipart.MaxUploadSizeExceededException ex) {
        long limit = ex.getMaxUploadSize() > 0 ? ex.getMaxUploadSize() : configuredMaxFileSizeBytes();
        log.warn("Upload refused: over the multipart limit ({} bytes)", limit);
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "FILE_TOO_LARGE", fileTooLargeMessage(limit)));
    }

    /** A body that isn't readable multipart (not multipart at all, truncated upload): the client's request, not a 500. */
    @ExceptionHandler(org.springframework.web.multipart.MultipartException.class)
    public ResponseEntity<ErrorResponse> handle(org.springframework.web.multipart.MultipartException ex) {
        log.warn("Multipart request refused: {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(ErrorResponse.of(400, "INVALID_UPLOAD",
                        "The upload couldn't be read. Choose the file again and retry (max "
                                + megabytes(configuredMaxFileSizeBytes()) + " MB)."));
    }

    /** Spring Boot's own default is 1MB, so the fallback matches what the servlet enforces when unset. */
    @org.springframework.beans.factory.annotation.Value("${spring.servlet.multipart.max-file-size:1MB}")
    private String maxFileSize = "1MB";

    long configuredMaxFileSizeBytes() {
        try {
            return org.springframework.util.unit.DataSize.parse(maxFileSize.trim()).toBytes();
        } catch (RuntimeException unparsable) {
            return 10L * 1024 * 1024;
        }
    }

    static String fileTooLargeMessage(long limitBytes) {
        return "File is too large (max " + megabytes(limitBytes) + " MB)";
    }

    static String megabytes(long bytes) {
        double mb = bytes / (1024.0 * 1024.0);
        return mb == Math.rint(mb) ? String.valueOf((long) mb) : String.format(java.util.Locale.ROOT, "%.1f", mb);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handle(Exception ex) {
        log.error("Unhandled exception", ex);
        return ResponseEntity.internalServerError()
                .body(ErrorResponse.of(500, "INTERNAL_ERROR", "An unexpected error occurred"));
    }
}
