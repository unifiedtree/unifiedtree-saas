package com.unifiedtree.saas.marketing;

import com.hrms.core.dto.ErrorResponse;
import com.hrms.core.exception.GlobalExceptionHandler;
import com.hrms.core.exception.HrmsException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Error bodies of the Marketing internal and SSO API: the app's usual body (same status, errorCode and message as
 * {@link GlobalExceptionHandler} gives, so nothing that reads them today changes) plus {@code code}, a stable
 * machine-readable reason Marketing (Node) switches on. Only these two controllers; every other API is untouched.
 * The codes: docs/redesign/MARKETING_SSO_CODES.md.
 */
@RestControllerAdvice(assignableTypes = {MarketingInternalController.class, MarketingSsoController.class})
@Order(Ordered.HIGHEST_PRECEDENCE)
public class MarketingErrorAdvice {

    public record MarketingError(Instant timestamp, int status, String errorCode, String message, String code) {}

    /** "CODE: message", as the older refusals spell their code */
    private static final Pattern CODED = Pattern.compile("^([A-Z][A-Z0-9_]+): ");

    /** Builds the usual body, so only {@code code} is new */
    private final GlobalExceptionHandler usual = new GlobalExceptionHandler();

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<MarketingError> handle(ResponseStatusException ex) {
        return withCode(usual.handle(ex), codeOf(ex));
    }

    // Request-shape, permission and business errors already carry a stable errorCode; it is also their code.

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<MarketingError> handle(MethodArgumentNotValidException ex) {
        return withCode(usual.handle(ex), null);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<MarketingError> handle(HttpMessageNotReadableException ex) {
        return withCode(usual.handle(ex), null);
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<MarketingError> handleBadParameter(Exception ex) {
        return withCode(usual.handleBadRequestParam(ex), null);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<MarketingError> handle(AccessDeniedException ex) {
        return withCode(usual.handle(ex), null);
    }

    @ExceptionHandler(HrmsException.class)
    public ResponseEntity<MarketingError> handle(HrmsException ex) {
        return withCode(usual.handle(ex), null);
    }

    /** The refusal's own code; else the "CODE: " its message starts with; else the status name (BAD_REQUEST, ...) */
    static String codeOf(ResponseStatusException ex) {
        if (ex instanceof MarketingRefusal refusal) return refusal.code();
        Matcher m = CODED.matcher(ex.getReason() == null ? "" : ex.getReason());
        if (m.find()) return m.group(1);
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        return status != null ? status.name() : "HTTP_" + ex.getStatusCode().value();
    }

    private static ResponseEntity<MarketingError> withCode(ResponseEntity<ErrorResponse> usual, String code) {
        ErrorResponse b = usual.getBody();
        return ResponseEntity.status(usual.getStatusCode()).body(new MarketingError(b.timestamp(), b.status(),
                b.errorCode(), b.message(), code != null ? code : b.errorCode()));
    }
}
