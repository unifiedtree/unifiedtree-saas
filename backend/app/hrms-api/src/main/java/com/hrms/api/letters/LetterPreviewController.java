package com.hrms.api.letters;

import com.hrms.core.exception.HrmsException;
import com.hrms.letters.dto.LetterTemplateDto;
import com.hrms.letters.service.LetterGenerationService;
import com.hrms.letters.service.LetterTemplateService;
import com.hrms.letters.service.OpenHtmlToPdfRenderer;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.jsoup.Jsoup;
import org.jsoup.safety.Safelist;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The letter preview before anything is saved (client request, 2 Oct: "a preview
 * option while uploading … everything about templates"). Given a template's
 * subject and body as they are being edited (or a saved template), an employee
 * and an issue date, it answers the letter exactly as it would be generated:
 * the workspace's letterhead on top, the merge fields filled, on the page the
 * PDF is printed on (A4). Nothing is stored.
 *
 * <ul>
 *   <li>The merge fields are filled from an employee the caller may see: their
 *       own record, or anyone's with {@code hrms.employee.read}. With no
 *       employee and no record of their own, the catalogue's example values are
 *       used, and the answer says so ({@code sample}).</li>
 *   <li>{@code POST …/preview/pdf} returns the same letter as the PDF file.</li>
 * </ul>
 */
@Tag(name = "Letters", description = "HR letter templates and generation")
@RestController
@RequestMapping("/v1/letters/templates/preview")
public class LetterPreviewController {

    static final String PREVIEW_PERMISSIONS =
            "hasAnyAuthority('hrms.letters.template.read','hrms.letters.template.create','hrms.letters.template.update','hrms.letters.generate')";

    /** What to preview. With {@code bodyHtml} the draft is used as it is; otherwise the saved template's. */
    public record PreviewDraftRequest(
            UUID templateId,
            UUID companyId,
            @Size(max = 500) String subject,
            @Size(max = 200_000) String bodyHtml,
            UUID employeeId,
            LocalDate issueDate) {}

    /** The page the letter is printed on. */
    public record Page(String size, double widthMm, double heightMm, double marginMm) {}

    /**
     * The rendered letter. {@code html} is the letterhead and the body, cleaned
     * for display; {@code unresolved} lists merge fields with no value.
     */
    public record LetterPreview(String subject, String html, UUID companyId, String companyName,
                                UUID employeeId, String employeeName, boolean sample, List<String> unresolved,
                                LocalDate issueDate, Page page) {}

    static final Page A4 = new Page(OpenHtmlToPdfRenderer.PAGE_SIZE, OpenHtmlToPdfRenderer.PAGE_WIDTH_MM,
            OpenHtmlToPdfRenderer.PAGE_HEIGHT_MM, OpenHtmlToPdfRenderer.PAGE_MARGIN_MM);

    private final LetterTemplateService templates;
    private final LetterGenerationService letters;

    public LetterPreviewController(LetterTemplateService templates, LetterGenerationService letters) {
        this.templates = templates;
        this.letters = letters;
    }

    @Operation(summary = "Preview a letter before saving: letterhead, merge fields filled, page size")
    @PostMapping
    @PreAuthorize(PREVIEW_PERMISSIONS)
    public LetterPreview preview(@Valid @RequestBody PreviewDraftRequest req, @AuthenticationPrincipal Jwt jwt) {
        LetterTemplateService.RenderedDraft d = render(req, jwt);
        return new LetterPreview(d.subject(), letters.withLetterhead(clean(d.bodyHtml()), d.companyName()),
                d.companyId(), d.companyName(), d.employeeId(), d.employeeName(), d.sample(), d.unresolved(),
                req.issueDate(), A4);
    }

    @Operation(summary = "The same preview as the PDF file it would become")
    @PostMapping(value = "/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize(PREVIEW_PERMISSIONS)
    public ResponseEntity<byte[]> pdf(@Valid @RequestBody PreviewDraftRequest req, @AuthenticationPrincipal Jwt jwt) {
        LetterTemplateService.RenderedDraft d = render(req, jwt);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"letter-preview.pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(letters.renderPdf(d.bodyHtml(), d.companyName()));
    }

    private LetterTemplateService.RenderedDraft render(PreviewDraftRequest req, Jwt jwt) {
        String subject = req.subject();
        String body = req.bodyHtml();
        UUID companyId = req.companyId();
        if (req.templateId() != null) {
            LetterTemplateDto t = templates.getTemplate(req.templateId());
            if (body == null) { body = t.bodyHtml(); if (subject == null) subject = t.subject(); }
            if (companyId == null) companyId = t.companyId();
        }
        if (body == null)
            throw new HrmsException("Write the letter, or pick a template, to preview it.", HttpStatus.UNPROCESSABLE_ENTITY, "PREVIEW_EMPTY");
        UUID employee = req.employeeId() != null ? req.employeeId() : ownEmployeeId(jwt);
        requireMayPreview(employee, jwt);
        return templates.renderDraft(subject, body, companyId, employee, req.issueDate());
    }

    /**
     * A preview prints an employee's details (pay included), so it is only for
     * the caller's own record, or anyone's with {@code hrms.employee.read}.
     */
    static void requireMayPreview(UUID employeeId, Jwt jwt) {
        if (employeeId == null) return;
        List<String> perms = jwt == null ? null : jwt.getClaimAsStringList("permissions");
        if (perms != null && perms.contains("hrms.employee.read")) return;
        if (employeeId.equals(ownEmployeeId(jwt))) return;
        throw new HrmsException("You can preview with your own record, or with people you can see in the directory.",
                HttpStatus.FORBIDDEN, "PREVIEW_EMPLOYEE_FORBIDDEN");
    }

    static UUID ownEmployeeId(Jwt jwt) {
        String claim = jwt == null ? null : jwt.getClaimAsString("employee_id");
        if (claim == null || claim.isBlank()) return null;
        try {
            return UUID.fromString(claim);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** The letter body as it may be shown in the app: formatting kept, anything active removed. */
    static String clean(String html) {
        Safelist safe = Safelist.relaxed()
                .addTags("hr", "span", "div", "font")
                .addAttributes(":all", "style", "class", "align")
                .addProtocols("img", "src", "http", "https", "data");
        return Jsoup.clean(html == null ? "" : html, safe);
    }
}
