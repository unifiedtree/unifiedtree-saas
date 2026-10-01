package com.hrms.api.letters;

import com.hrms.core.exception.HrmsException;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.hrms.letters.service.LetterGenerationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.UUID;

/**
 * The employee's own letters: read one, and sign it (redesign BW-75, BW-76).
 * Always the caller's own letter (the employee id comes from the token), and
 * only a letter that was sent to them.
 */
@Tag(name = "Letters", description = "HR letter templates and generation")
@RestController
@RequestMapping("/v1/letters/my")
public class MyLettersController {

    /** The letter to read in the app: the letterhead and the body, cleaned for display. */
    public record ReadableLetter(UUID id, String subject, String html, String status, Boolean signatureRequested,
                                 Instant signedAt, String signedName, LetterPreviewController.Page page) {}

    /** Click to accept: the typed name, and the tick that they read it. */
    public record SignRequest(@Size(max = 200) String typedName, Boolean accept) {}

    private final LetterGenerationService letters;
    private final LetterSigningService signing;
    private final LetterExtras extras;

    public MyLettersController(LetterGenerationService letters, LetterSigningService signing, LetterExtras extras) {
        this.letters = letters;
        this.signing = signing;
        this.extras = extras;
    }

    @Operation(summary = "Employee: read one of my letters (opening it marks it viewed)")
    @GetMapping("/{id}/html")
    @PreAuthorize("hasAuthority('hrms.letters.read.self')")
    public ReadableLetter read(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        LetterGenerationService.ReadableLetter letter = letters.readable(id);
        UUID me = LetterPreviewController.ownEmployeeId(jwt);
        if (me == null || !me.equals(letter.employeeId()) || !letters.isSentToEmployee(id))
            throw new HrmsException("Letter not found", HttpStatus.NOT_FOUND, "LETTER_NOT_FOUND");
        letters.markViewedByOwner(id);
        GeneratedLetterDto dto = extras.one(letters.getGenerated(id));
        return new ReadableLetter(id, letter.subject(),
                letters.withLetterhead(LetterPreviewController.clean(letter.bodyHtml()), letter.companyName()),
                dto.status(), dto.signatureRequested(), dto.signedAt(), dto.signedName(), LetterPreviewController.A4);
    }

    @Operation(summary = "Employee: sign one of my letters (click to accept, with my typed name)")
    @PostMapping("/{id}/sign")
    @PreAuthorize("hasAuthority('hrms.letters.read.self')")
    public GeneratedLetterDto sign(@PathVariable UUID id, @Valid @RequestBody SignRequest req,
                                   @AuthenticationPrincipal Jwt jwt, HttpServletRequest http) {
        if (!Boolean.TRUE.equals(req.accept()))
            throw new HrmsException("Tick that you have read the letter to sign it.", HttpStatus.UNPROCESSABLE_ENTITY, "SIGNATURE_NOT_ACCEPTED");
        GeneratedLetterDto signed = signing.sign(id, LetterPreviewController.ownEmployeeId(jwt), req.typedName(),
                clientIp(http), http == null ? null : http.getHeader("User-Agent"));
        return extras.one(signed);
    }

    /** The caller's address: the first hop of X-Forwarded-For behind the load balancer, else the socket's. */
    static String clientIp(HttpServletRequest http) {
        if (http == null) return null;
        String fwd = http.getHeader("X-Forwarded-For");
        if (fwd != null && !fwd.isBlank()) return fwd.split(",")[0].trim();
        return http.getRemoteAddr();
    }
}
