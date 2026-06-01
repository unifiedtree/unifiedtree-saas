package com.hrms.app.bulk;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
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
