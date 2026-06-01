package com.hrms.api.letters;

import com.hrms.core.dto.PageResponse;
import com.hrms.letters.dto.*;
import com.hrms.letters.service.LetterGenerationService;
import com.hrms.letters.service.LetterTemplateService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@Tag(name = "Letters", description = "HR letter templates and generation")
@RestController
@RequestMapping("/v1/letters")
public class LetterController {

    private final LetterTemplateService  templateService;
    private final LetterGenerationService generationService;

    public LetterController(LetterTemplateService templateService,
                            LetterGenerationService generationService) {
        this.templateService   = templateService;
        this.generationService = generationService;
    }

    // ── Template CRUD ────────────────────────────────────────────────────────

    @Operation(summary = "List all letter templates")
    @GetMapping("/templates")
    @PreAuthorize("hasAuthority('hrms.letters.template.read')")
    public ResponseEntity<PageResponse<LetterTemplateDto>> listTemplates(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(templateService.listTemplates(pageable));
    }

    @Operation(summary = "Get a single letter template")
    @GetMapping("/templates/{id}")
    @PreAuthorize("hasAuthority('hrms.letters.template.read')")
    public ResponseEntity<LetterTemplateDto> getTemplate(@PathVariable UUID id) {
        return ResponseEntity.ok(templateService.getTemplate(id));
    }

    @Operation(summary = "Create a letter template")
    @PostMapping("/templates")
    @PreAuthorize("hasAuthority('hrms.letters.template.create')")
    public ResponseEntity<LetterTemplateDto> createTemplate(
            @Valid @RequestBody CreateTemplateRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(templateService.createTemplate(req, extractUserId(jwt)));
    }

    @Operation(summary = "Update a letter template")
    @PutMapping("/templates/{id}")
    @PreAuthorize("hasAuthority('hrms.letters.template.update')")
    public ResponseEntity<LetterTemplateDto> updateTemplate(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateTemplateRequest req) {
        return ResponseEntity.ok(templateService.updateTemplate(id, req));
    }

    @Operation(summary = "Soft-delete a letter template")
    @DeleteMapping("/templates/{id}")
    @PreAuthorize("hasAuthority('hrms.letters.template.delete')")
    public ResponseEntity<Void> deleteTemplate(@PathVariable UUID id) {
        templateService.deleteTemplate(id);
        return ResponseEntity.noContent().build();
    }

    // ── Merge fields ─────────────────────────────────────────────────────────

    @Operation(summary = "List all supported merge fields")
    @GetMapping("/merge-fields")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<List<MergeFieldEntry>> mergeFields() {
        return ResponseEntity.ok(templateService.mergeFieldCatalogue());
    }

    @Operation(summary = "Preview a template rendered for a specific employee (returns HTML)")
    @PostMapping("/templates/{id}/preview")
    @PreAuthorize("hasAuthority('hrms.letters.template.read')")
    public ResponseEntity<String> previewTemplate(
            @PathVariable UUID id,
            @Valid @RequestBody PreviewTemplateRequest req) {
        String html = templateService.previewTemplate(id, req);
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .body(html);
    }

    // ── Generation ───────────────────────────────────────────────────────────

    @Operation(summary = "Generate a letter for an employee")
    @PostMapping("/generate")
    @PreAuthorize("hasAuthority('hrms.letters.generate')")
    public ResponseEntity<GeneratedLetterDto> generateLetter(
            @Valid @RequestBody GenerateLetterRequest req,
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(generationService.generate(req, extractUserId(jwt)));
    }

    @Operation(summary = "List generated letters (admin)")
    @GetMapping("/generated")
    @PreAuthorize("hasAuthority('hrms.letters.read')")
    public ResponseEntity<PageResponse<GeneratedLetterDto>> listGenerated(
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(generationService.listGenerated(pageable));
    }

    @Operation(summary = "Get a generated letter by ID")
    @GetMapping("/generated/{id}")
    @PreAuthorize("hasAuthority('hrms.letters.read') or hasAuthority('hrms.letters.read.self')")
    public ResponseEntity<GeneratedLetterDto> getGenerated(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        GeneratedLetterDto dto = generationService.getGenerated(id);
        enforceOwnerOrAdmin(dto, jwt);
        return ResponseEntity.ok(dto);
    }

    @Operation(summary = "Stream PDF for a generated letter")
    @GetMapping("/generated/{id}/pdf")
    @PreAuthorize("hasAuthority('hrms.letters.read') or hasAuthority('hrms.letters.read.self')")
    public ResponseEntity<byte[]> getPdf(
            @PathVariable UUID id,
            @AuthenticationPrincipal Jwt jwt) {
        GeneratedLetterDto dto = generationService.getGenerated(id);
        enforceOwnerOrAdmin(dto, jwt);
        byte[] pdfBytes = generationService.getPdf(id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"letter-" + id + ".pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes);
    }

    @Operation(summary = "Email a generated letter to the employee")
    @PostMapping("/generated/{id}/send")
    @PreAuthorize("hasAuthority('hrms.letters.send')")
    public ResponseEntity<GeneratedLetterDto> sendLetter(
            @PathVariable UUID id,
            @RequestBody(required = false) SendLetterRequest req) {
        return ResponseEntity.ok(generationService.sendLetter(id, req != null ? req : new SendLetterRequest(null, null)));
    }

    @Operation(summary = "Void a generated letter")
    @PostMapping("/generated/{id}/void")
    @PreAuthorize("hasAuthority('hrms.letters.void')")
    public ResponseEntity<GeneratedLetterDto> voidLetter(
            @PathVariable UUID id,
            @Valid @RequestBody VoidLetterRequest req) {
        return ResponseEntity.ok(generationService.voidLetter(id, req));
    }

    // ── Employee self-service ────────────────────────────────────────────────

    @Operation(summary = "Employee: list own letters")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('hrms.letters.read.self')")
    public ResponseEntity<PageResponse<GeneratedLetterDto>> myLetters(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        UUID employeeId = extractEmployeeId(jwt);
        return ResponseEntity.ok(generationService.getMyLetters(employeeId, pageable));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private UUID extractUserId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return UUID.fromString(empId != null ? empId : jwt.getSubject());
    }

    private void enforceOwnerOrAdmin(GeneratedLetterDto dto, Jwt jwt) {
        boolean hasFullRead = jwt.getClaimAsStringList("permissions") != null
                && jwt.getClaimAsStringList("permissions").contains("hrms.letters.read");
        if (!hasFullRead) {
            UUID callerEmployeeId = extractEmployeeId(jwt);
            if (!dto.employeeId().equals(callerEmployeeId)) {
                throw new org.springframework.security.access.AccessDeniedException(
                        "Access denied: not your letter");
            }
        }
    }
}
