package com.hrms.app.bulk;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.UUID;

@RestController
@RequestMapping("/v1/bulk-import")
@Tag(name = "Bulk Import", description = "Two-phase CSV/XLSX employee bulk import")
@SecurityRequirement(name = "bearerAuth")
public class BulkImportController {

    private final EmployeeBulkImportService bulkImportService;

    public BulkImportController(EmployeeBulkImportService bulkImportService) {
        this.bulkImportService = bulkImportService;
    }

    @GetMapping("/employees/template")
    @Operation(summary = "Download a blank XLSX template with all required and optional columns")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public ResponseEntity<byte[]> downloadTemplate() throws IOException {
        byte[] xlsx = bulkImportService.buildTemplate();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"employee_import_template.xlsx\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(xlsx);
    }

    @PostMapping(value = "/employees/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Phase 1 — Validate a CSV/XLSX file and return all errors without writing")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public BulkImportResult validate(
            @RequestPart("file") MultipartFile file,
            @RequestParam UUID companyId) throws IOException {
        return bulkImportService.validateOnly(file, companyId);
    }

    @PostMapping(value = "/employees/commit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Phase 2 — Validate and commit: creates employees only if zero validation errors")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public BulkImportResult commit(
            @RequestPart("file") MultipartFile file,
            @RequestParam UUID companyId) throws IOException {
        return bulkImportService.validateAndCommit(file, companyId);
    }
}
