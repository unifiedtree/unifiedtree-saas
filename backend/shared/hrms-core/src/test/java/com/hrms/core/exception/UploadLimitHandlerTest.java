package com.hrms.core.exception;

import com.hrms.core.dto.ErrorResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;

import static org.junit.jupiter.api.Assertions.*;

/** An over-limit upload is a clear 400, not the catch-all 500. */
class UploadLimitHandlerTest {

    @Test void overTheLimitIsA400ThatSaysTheLimit() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        ResponseEntity<ErrorResponse> r = handler.handle(new MaxUploadSizeExceededException(10L * 1024 * 1024));
        assertEquals(400, r.getStatusCode().value());
        assertEquals("File is too large (max 10 MB)", r.getBody().message());
    }

    @Test void unknownLimitFallsBackToTheConfiguredOne() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        // Tomcat reports -1; the configured spring.servlet.multipart.max-file-size default (1MB) is used.
        ResponseEntity<ErrorResponse> r = handler.handle(new MaxUploadSizeExceededException(-1));
        assertEquals(400, r.getStatusCode().value());
        assertEquals("File is too large (max 1 MB)", r.getBody().message());
    }

    @Test void unreadableMultipartIsA400() {
        ResponseEntity<ErrorResponse> r = new GlobalExceptionHandler().handle(new MultipartException("Current request is not a multipart request"));
        assertEquals(400, r.getStatusCode().value());
    }

    @Test void megabytesReadNaturally() {
        assertEquals("10", GlobalExceptionHandler.megabytes(10L * 1024 * 1024));
        assertEquals("2.5", GlobalExceptionHandler.megabytes(5L * 512 * 1024));
    }
}
