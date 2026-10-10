package com.hrms.app.roster;

import com.hrms.api.roster.RosterContract.ImportValidation;
import com.hrms.api.roster.RosterContract.RosterDetail;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.UUID;

/**
 * The shift roster's Excel template, import and export (design §1.5, endpoints 20–23; §1.7). The import is
 * Import → Validate → Preview → Apply: validate writes nothing; apply saves a DRAFT (never a published roster), which
 * HR then checks and publishes in the planner.
 *
 * <ul>
 *   <li>{@code GET /v1/rosters/import/template?companyId=&startDate=&endDate=&departmentId=&branchId=} → XLSX</li>
 *   <li>{@code POST /v1/rosters/import/validate} (multipart {@code file}; {@code companyId, startDate, endDate,
 *       departmentId?, branchId?, rosterId?}) → {@code ImportValidation}</li>
 *   <li>{@code POST /v1/rosters/import/apply} (the same, plus {@code name?, rosterId?, lockVersion?}) → {@code RosterDetail}
 *       (201 for a new draft, 200 when the days of draft {@code rosterId} were replaced)</li>
 *   <li>{@code GET /v1/rosters/{id}/export?published=false} → XLSX of the working copy (or the published days)</li>
 * </ul>
 * The web sends {@code companyId} in the query string, where the company-access filter checks it; the service checks
 * it again for a multipart field. Every call answers 503 FEATURE_NOT_READY while shift planning's tables are missing.
 */
@RestController
@RequestMapping("/v1/rosters")
@Tag(name = "Shift planning: Excel import", description = "Roster template, import (validate, apply) and export")
@SecurityRequirement(name = "bearerAuth")
public class RosterImportController {

    static final MediaType XLSX = MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    private static final String PLAN = "hasAuthority('attendance.roster.plan')";
    private static final String PLAN_OR_PUBLISH = "hasAuthority('attendance.roster.plan') or hasAuthority('attendance.roster.publish')";

    private final RosterImportService imports;

    public RosterImportController(RosterImportService imports) {
        this.imports = imports;
    }

    @Operation(summary = "The roster sheet to fill in: the people in scope, one column per day, the codes on a second sheet")
    @GetMapping("/import/template")
    @PreAuthorize(PLAN)
    public ResponseEntity<byte[]> template(@AuthenticationPrincipal Jwt jwt,
                                           @RequestParam("companyId") UUID companyId,
                                           @RequestParam("startDate") LocalDate startDate,
                                           @RequestParam("endDate") LocalDate endDate,
                                           @RequestParam(value = "departmentId", required = false) UUID departmentId,
                                           @RequestParam(value = "branchId", required = false) UUID branchId) {
        return xlsx(imports.template(jwt, new RosterImportService.Scope(companyId, startDate, endDate, departmentId, branchId)));
    }

    @Operation(summary = "Check a roster file: people matched, problems by row and column, and the planner's preview (saves nothing)")
    @PostMapping(value = "/import/validate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize(PLAN)
    public ImportValidation validate(@AuthenticationPrincipal Jwt jwt,
                                     @RequestPart("file") MultipartFile file,
                                     @RequestParam("companyId") UUID companyId,
                                     @RequestParam("startDate") LocalDate startDate,
                                     @RequestParam("endDate") LocalDate endDate,
                                     @RequestParam(value = "departmentId", required = false) UUID departmentId,
                                     @RequestParam(value = "branchId", required = false) UUID branchId,
                                     @RequestParam(value = "rosterId", required = false) UUID rosterId) {
        return imports.validate(jwt, file, new RosterImportService.Scope(companyId, startDate, endDate, departmentId, branchId), rosterId);
    }

    @Operation(summary = "Create a draft roster from the file (or replace the days of a draft); refused while the file has errors")
    @PostMapping(value = "/import/apply", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize(PLAN)
    public ResponseEntity<RosterDetail> apply(@AuthenticationPrincipal Jwt jwt,
                                              @RequestPart("file") MultipartFile file,
                                              @RequestParam("companyId") UUID companyId,
                                              @RequestParam("startDate") LocalDate startDate,
                                              @RequestParam("endDate") LocalDate endDate,
                                              @RequestParam(value = "departmentId", required = false) UUID departmentId,
                                              @RequestParam(value = "branchId", required = false) UUID branchId,
                                              @RequestParam(value = "name", required = false) String name,
                                              @RequestParam(value = "rosterId", required = false) UUID rosterId,
                                              @RequestParam(value = "lockVersion", required = false) Integer lockVersion) {
        RosterImportService.Applied applied = imports.apply(jwt, file,
                new RosterImportService.Scope(companyId, startDate, endDate, departmentId, branchId), name, rosterId, lockVersion);
        return ResponseEntity.status(applied.created() ? HttpStatus.CREATED : HttpStatus.OK).body(applied.detail());
    }

    @Operation(summary = "The roster as an Excel sheet in the template's layout (the working copy, or the published days)")
    @GetMapping("/{id:[0-9a-fA-F-]{36}}/export")
    @PreAuthorize(PLAN_OR_PUBLISH)
    public ResponseEntity<byte[]> export(@AuthenticationPrincipal Jwt jwt,
                                         @PathVariable("id") UUID id,
                                         @RequestParam(value = "published", defaultValue = "false") boolean published) {
        return xlsx(imports.export(jwt, id, published));
    }

    private static ResponseEntity<byte[]> xlsx(RosterImportService.Download d) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(d.fileName()).build().toString())
                .contentType(XLSX)
                .body(d.bytes());
    }
}
