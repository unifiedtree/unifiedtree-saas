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

    public DocumentController(DocumentService documentService,
                              EmployeeRepository employeeRepository) {
        this.documentService = documentService;
        this.employeeRepository = employeeRepository;
    }

    // ─── Admin / HR upload ───────────────────────────────────────────────────

    @Operation(summary = "Store a document in an employee's vault")
    @PostMapping("/documents")
    @PreAuthorize("hasAuthority('hrms.document.write')")
    public ResponseEntity<DocumentResponse> create(@Valid @RequestBody DocumentRequest request) {
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
        return ResponseEntity.ok(documentService.getEmployeeDocuments(extractEmployeeId(jwt), pageable));
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
    @PreAuthorize("hasAuthority('hrms.document.write')")
    public void delete(@PathVariable UUID id) {
        documentService.deleteDocument(id);
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
                ? (employee.getFirstName() + " " + employee.getLastName()).trim()
                : null;
        String employeeCode = employee != null ? employee.getEmployeeCode() : null;
        return new DocumentResponse(
                r.id(), r.employeeId(), employeeName, employeeCode, r.companyId(),
                r.title(), r.category(), r.fileUrl(),
                r.issuedDate(), r.expiryDate(), r.notes(), r.createdAt());
    }

    private UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        return empId != null ? UUID.fromString(empId) : UUID.fromString(jwt.getSubject());
    }
}
