package com.hrms.app.bulk;

import com.hrms.api.workforce.NewHireOnboarding;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceEmployeeResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/v1/bulk-import")
@Tag(name = "Bulk Import", description = "Two-phase CSV/XLSX employee bulk import")
@SecurityRequirement(name = "bearerAuth")
public class BulkImportController {

    private final EmployeeBulkImportService bulkImportService;
    @Autowired(required = false)
    private NewHireOnboarding newHireOnboarding;

    public BulkImportController(EmployeeBulkImportService bulkImportService) {
        this.bulkImportService = bulkImportService;
    }

    @GetMapping("/employees/template")
    @Operation(summary = "Download a blank XLSX (or, with format=csv, CSV) template with all required and optional columns")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public ResponseEntity<byte[]> downloadTemplate(@RequestParam(defaultValue = "xlsx") String format) throws IOException {
        if ("csv".equalsIgnoreCase(format)) {
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"employee_import_template.csv\"")
                    .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
                    .body(bulkImportService.buildCsvTemplate());
        }
        byte[] xlsx = bulkImportService.buildTemplate();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"employee_import_template.xlsx\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(xlsx);
    }

    @GetMapping("/employees/columns")
    @Operation(summary = "The template's required and optional columns (for the import page)")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public EmployeeBulkImportService.Columns columns() {
        return bulkImportService.columns();
    }

    @PostMapping(value = "/employees/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Phase 1 — Validate a CSV/XLSX file and return all errors without writing")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public BulkImportResult validate(
            @RequestPart("file") MultipartFile file,
            @RequestParam UUID companyId) throws IOException {
        return bulkImportService.validateOnly(file, companyId);
    }

    /**
     * Creates everyone in the file, or no one. Redesign BW-94: with
     * {@code startOnboarding=true} (off by default) each new person's fitting
     * onboarding checklist is started after the import has been saved, in its
     * own transaction, so an onboarding that can't start never undoes the import.
     */
    @PostMapping(value = "/employees/commit", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Phase 2 — Validate and commit: creates employees only if zero validation errors")
    @PreAuthorize("@perm.check('hrms.employee.import')")
    public BulkImportResult commit(
            @RequestPart("file") MultipartFile file,
            @RequestParam UUID companyId,
            @RequestParam(defaultValue = "false") boolean startOnboarding) throws IOException {
        EmployeeBulkImportService.Commit commit = bulkImportService.validateAndCommit(file, companyId);
        BulkImportResult result = commit.result();
        if (!startOnboarding || !result.committed() || newHireOnboarding == null || commit.employees().isEmpty()) {
            return result;
        }
        boolean allowed = newHireOnboarding.allowed();
        List<BulkImportResult.CreatedRow> rows = new ArrayList<>(result.created().size());
        for (int i = 0; i < result.created().size(); i++) {
            WorkforceEmployeeResponse employee = commit.employees().get(i);
            NewHireOnboarding.Outcome outcome = newHireOnboarding.start(employee, allowed);
            BulkImportResult.Onboarding started = outcome.onboarding() == null ? null
                    : new BulkImportResult.Onboarding(outcome.onboarding().instanceId(), outcome.onboarding().templateName());
            rows.add(result.created().get(i).withOnboarding(started, outcome.status().name()));
        }
        return result.withCreated(rows);
    }
}
