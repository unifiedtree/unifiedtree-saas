package com.hrms.api.document;

import com.hrms.core.dto.PageResponse;
import com.hrms.document.dto.DocumentRequest;
import com.hrms.document.dto.DocumentResponse;
import com.hrms.document.service.DocumentService;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.repository.EmployeeRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Employee document vault: HR/admin upload of employee documents (contracts, ID
 * proofs, certificates, payslips, policies, tax) and employee self-service read.
 */
@RestController
@RequestMapping("/v1/document")
@Tag(name = "Document", description = "Employee document vault — upload, browse, and self-service access")
@SecurityRequirement(name = "bearerAuth")
public class DocumentController {

    private final DocumentService documentService;
    private final EmployeeRepository employeeRepository;
    private final com.unifiedtree.settings.branding.DocumentStorage storage;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.context.ApplicationEventPublisher events;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private DocumentTypeDefaults typeDefaults;

    public DocumentController(DocumentService documentService,
                              EmployeeRepository employeeRepository,
                              com.unifiedtree.settings.branding.DocumentStorage storage,
                              org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.documentService = documentService;
        this.employeeRepository = employeeRepository;
        this.storage = storage;
        this.jdbc = jdbc;
    }

    // ─── Admin / HR upload ───────────────────────────────────────────────────

    @Operation(summary = "Store a document in an employee's vault")
    @PostMapping("/documents")
    @PreAuthorize("hasAuthority('hrms.document.write')")
    public ResponseEntity<DocumentResponse> create(@Valid @RequestBody DocumentRequest request) {
        if (request.fileUrl() == null || !request.fileUrl().matches("(?i)^https?://[^\\s]+$")) {
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide an HTTP(S) document URL or use file upload");
        }
        Employee employee = employeeRepository.findById(request.employeeId())
                .orElseThrow(() -> new IllegalArgumentException("Employee not found: " + request.employeeId()));
        UUID companyId = request.companyId() != null ? request.companyId() : employee.getCompanyId();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(enrichOne(documentService.createDocument(request.employeeId(), companyId, request)));
    }

    // ─── Employee self-service ───────────────────────────────────────────────

    @Operation(summary = "List my documents")
    @GetMapping("/my")
    @PreAuthorize("hasAuthority('hrms.document.read.self')")
    public ResponseEntity<PageResponse<DocumentResponse>> myDocuments(
            @AuthenticationPrincipal Jwt jwt,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(documentService.getEmployeeDocuments(extractEmployeeId(jwt), pageable)));
    }

    // ─── HR / manager browse by employee ─────────────────────────────────────

    @Operation(summary = "List an employee's documents")
    @GetMapping("/employee/{employeeId}")
    @PreAuthorize("hasAuthority('hrms.document.read')")
    public ResponseEntity<PageResponse<DocumentResponse>> employeeDocuments(
            @PathVariable UUID employeeId,
            @PageableDefault(size = 20) Pageable pageable) {
        return ResponseEntity.ok(enrichPage(documentService.getEmployeeDocuments(employeeId, pageable)));
    }

    @Operation(summary = "Get a single document")
    @GetMapping("/documents/{id}")
    @PreAuthorize("hasAnyAuthority('hrms.document.read','hrms.document.read.self')")
    public ResponseEntity<DocumentResponse> getDocument(@PathVariable UUID id,
                                                        @AuthenticationPrincipal Jwt jwt) {
        DocumentResponse doc = enrichOne(documentService.getDocument(id));
        // Object-level authz (prevent intra-tenant IDOR): self-permission callers may
        // read ONLY their own document; the admin read permission may read any.
        if (!callerHasPermission(jwt, "hrms.document.read")
                && !java.util.Objects.equals(doc.employeeId(), extractEmployeeId(jwt))) {
            throw new org.springframework.security.access.AccessDeniedException("Not permitted to view this document");
        }
        return ResponseEntity.ok(doc);
    }

    private boolean callerHasPermission(Jwt jwt, String permission) {
        java.util.List<String> perms = jwt.getClaimAsStringList("permissions");
        return perms != null && perms.contains(permission);
    }

    @Operation(summary = "Delete a document")
    @DeleteMapping("/documents/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAnyAuthority('hrms.document.write','hrms.document.write.self')")
    public void delete(@PathVariable UUID id,
                       @AuthenticationPrincipal Jwt jwt) {
        DocumentResponse existing = documentService.getDocument(id);
        // Object-level authz: a self-only caller may only delete THEIR document.
        if (!callerHasPermission(jwt, "hrms.document.write")
                && !java.util.Objects.equals(existing.employeeId(), extractEmployeeId(jwt))) {
            throw new org.springframework.security.access.AccessDeniedException("Not permitted to delete this document");
        }
        String file = existing.fileUrl();
        documentService.deleteDocument(id);
        if (isOwnedStorageUrl(file)) storage.deleteQuietly(file.substring(5));
    }

    // ─── V143.7: HR verification workflow ────────────────────────────────────

    public record RejectionRequest(@jakarta.validation.constraints.NotBlank
                                   @jakarta.validation.constraints.Size(min = 3, max = 500) String reason) {}

    @Operation(summary = "Verify a pending employee document (HR / admin)")
    @PostMapping("/documents/{id}/verify")
    @PreAuthorize("hasAuthority('hrms.document.verify')")
    public ResponseEntity<DocumentResponse> verify(@PathVariable UUID id,
                                                   @AuthenticationPrincipal Jwt jwt) {
        UUID verifier = extractEmployeeId(jwt);
        DocumentResponse doc = documentService.verifyDocument(id, verifier);
        if (events != null) {
            try {
                events.publishEvent(new com.unifiedtree.notifications.events.DocumentVerifiedEvent(
                        doc.id(), doc.employeeId(), com.hrms.core.tenant.TenantContext.getTenantId(),
                        doc.documentTypeName(), doc.title()));
            } catch (Exception ignore) { /* best-effort */ }
        }
        return ResponseEntity.ok(enrichOne(doc));
    }

    @Operation(summary = "Reject a pending employee document (HR / admin)")
    @PostMapping("/documents/{id}/reject")
    @PreAuthorize("hasAuthority('hrms.document.verify')")
    public ResponseEntity<DocumentResponse> reject(@PathVariable UUID id,
                                                   @jakarta.validation.Valid @RequestBody RejectionRequest body,
                                                   @AuthenticationPrincipal Jwt jwt) {
        UUID verifier = extractEmployeeId(jwt);
        DocumentResponse doc = documentService.rejectDocument(id, verifier, body.reason());
        if (events != null) {
            try {
                events.publishEvent(new com.unifiedtree.notifications.events.DocumentRejectedEvent(
                        doc.id(), doc.employeeId(), com.hrms.core.tenant.TenantContext.getTenantId(),
                        doc.documentTypeName(), doc.title(), body.reason()));
            } catch (Exception ignore) { /* best-effort */ }
        }
        return ResponseEntity.ok(enrichOne(doc));
    }

    @Operation(summary = "List pending documents across the tenant (HR queue)")
    @GetMapping("/pending")
    @PreAuthorize("hasAuthority('hrms.document.verify')")
    public java.util.List<java.util.Map<String, Object>> pending() {
        return jdbc.query("""
                SELECT d.id, d.employee_id, d.title, d.category, d.document_type_id, d.created_at,
                       d.original_filename, d.file_size_bytes,
                       t.code AS type_code, t.display_name AS type_name,
                       e.first_name, e.last_name, e.employee_code
                  FROM document_mgmt.employee_documents d
                  LEFT JOIN document_mgmt.document_types t ON t.id = d.document_type_id
                  LEFT JOIN hrms.employees e ON e.id = d.employee_id
                 WHERE d.verification_status = 'PENDING'
                 ORDER BY d.created_at DESC
                 LIMIT 200
                """,
                (rs, i) -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("id", rs.getObject("id", UUID.class));
                    row.put("employeeId", rs.getObject("employee_id", UUID.class));
                    row.put("employeeName", concat(rs.getString("first_name"), rs.getString("last_name")));
                    row.put("employeeCode", rs.getString("employee_code"));
                    row.put("title", rs.getString("title"));
                    row.put("documentTypeId", rs.getObject("document_type_id", UUID.class));
                    row.put("documentTypeCode", rs.getString("type_code"));
                    row.put("documentTypeName", rs.getString("type_name"));
                    row.put("originalFilename", rs.getString("original_filename"));
                    row.put("fileSizeBytes", rs.getObject("file_size_bytes"));
                    row.put("createdAt", rs.getTimestamp("created_at"));
                    return row;
                });
    }

    @Operation(summary = "Which required document types has the caller not uploaded yet?")
    @GetMapping("/my/missing")
    @PreAuthorize("hasAuthority('hrms.document.type.read')")
    public java.util.List<java.util.Map<String, Object>> myMissing(@AuthenticationPrincipal Jwt jwt) {
        UUID employeeId = extractEmployeeId(jwt);
        // Same lazy seed as GET /types: a new workspace's required types must show here too.
        if (typeDefaults != null) typeDefaults.ensureDefaults();
        return jdbc.query("""
                SELECT t.id, t.code, t.display_name, t.allowed_formats, t.max_size_mb, t.expiry_tracked
                  FROM document_mgmt.document_types t
                 WHERE t.active = TRUE AND t.required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM document_mgmt.employee_documents d
                      WHERE d.employee_id = ?
                        AND d.document_type_id = t.id
                        AND d.verification_status IN ('PENDING','VERIFIED')
                   )
                 ORDER BY t.sort_order
                """, (rs, i) -> {
                    java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                    row.put("id", rs.getObject("id", UUID.class));
                    row.put("code", rs.getString("code"));
                    row.put("displayName", rs.getString("display_name"));
                    row.put("allowedFormats", rs.getString("allowed_formats"));
                    row.put("maxSizeMb", rs.getInt("max_size_mb"));
                    row.put("expiryTracked", rs.getBoolean("expiry_tracked"));
                    return row;
                }, employeeId);
    }

    private static String concat(String a, String b) {
        String s = ((a == null ? "" : a) + " " + (b == null ? "" : b)).trim();
        return s.isEmpty() ? null : s;
    }

    // ─── Owner identity enrichment ───────────────────────────────────────────
    // The document module has no dependency on hrms-employee, so the owning
    // employee's name / code are resolved here (the API layer) and folded into the
    // response so admin lists can show WHOSE document it is.

    private PageResponse<DocumentResponse> enrichPage(PageResponse<DocumentResponse> page) {
        List<UUID> employeeIds = page.content().stream()
                .map(DocumentResponse::employeeId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, Employee> employeeMap = employeeIds.isEmpty()
                ? Map.of()
                : employeeRepository.findAllById(employeeIds).stream()
                        .collect(Collectors.toMap(Employee::getId, e -> e, (a, b) -> a));
        List<DocumentResponse> enriched = page.content().stream()
                .map(r -> enrich(r, employeeMap.get(r.employeeId())))
                .toList();
        return new PageResponse<>(enriched, page.page(), page.size(),
                page.totalElements(), page.totalPages(), page.last());
    }

    private DocumentResponse enrichOne(DocumentResponse r) {
        Employee employee = r.employeeId() == null
                ? null
                : employeeRepository.findById(r.employeeId()).orElse(null);
        return enrich(r, employee);
    }

    private DocumentResponse enrich(DocumentResponse r, Employee employee) {
        String employeeName = employee != null
                ? (employee.getFirstName() + " " + (employee.getLastName() == null ? "" : employee.getLastName())).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        String typeCode = null, typeName = null;
        if (r.documentTypeId() != null) {
            try {
                java.util.Map<String, Object> row = jdbc.queryForMap(
                        "SELECT code, display_name FROM document_mgmt.document_types WHERE id = ?",
                        r.documentTypeId());
                typeCode = (String) row.get("code");
                typeName = (String) row.get("display_name");
            } catch (org.springframework.dao.EmptyResultDataAccessException ignore) { /* type was deleted */ }
        }
        return new DocumentResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.title(), r.category(), resolveFileUrl(r.fileUrl()),
                r.issuedDate(), r.expiryDate(), r.notes(), r.createdAt(),
                r.documentTypeId(), typeCode, typeName,
                r.verificationStatus(), r.verifiedBy(), r.verifiedAt(),
                r.rejectionReason(), r.originalFilename(), r.fileSizeBytes(), r.contentType());
    }

    private boolean isOwnedStorageUrl(String url) {
        return url != null && url.startsWith("r2://employee-documents/" + com.hrms.core.tenant.TenantContext.getTenantId() + "/")
                && !url.contains("..") && !url.contains("\\");
    }

    private String resolveFileUrl(String url) {
        if (url == null || !url.startsWith("r2://")) return url;
        if (!isOwnedStorageUrl(url)) throw new org.springframework.security.access.AccessDeniedException("Document storage belongs to another workspace");
        if (!storage.isConfigured()) return null; // dev / preview: R2 not wired, so no signed URL
        return storage.urlFor(url.substring(5));
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
