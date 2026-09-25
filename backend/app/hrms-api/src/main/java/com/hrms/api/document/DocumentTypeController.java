package com.hrms.api.document;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Admin-configurable document types (Aadhaar, PAN, Passport, …).
 * Employees see the active list to know what to upload; HR / admin manages the
 * catalog: display name, allowed formats, max size, required-on-onboarding
 * flag, expiry tracking, active/inactive.
 */
@RestController
@RequestMapping("/v1/document/types")
@Tag(name = "Document Types", description = "Admin-configurable document type catalog")
@SecurityRequirement(name = "bearerAuth")
public class DocumentTypeController {

    private final JdbcTemplate jdbc;
    private final DocumentTypeDefaults defaults;

    public DocumentTypeController(JdbcTemplate jdbc, DocumentTypeDefaults defaults) {
        this.jdbc = jdbc;
        this.defaults = defaults;
    }

    public record DocumentTypeDto(UUID id, String code, String displayName, String description,
                                  String allowedFormats, int maxSizeMb, boolean required,
                                  boolean expiryTracked, boolean active, int sortOrder) {}

    public record UpsertRequest(
            @NotBlank @Pattern(regexp = "^[A-Z0-9_]{2,50}$",
                    message = "Code must be 2-50 uppercase letters, digits or underscores") String code,
            @NotBlank @Size(max = 120) String displayName,
            String description,
            @NotBlank @Pattern(regexp = "^([a-z]{2,10})(,[a-z]{2,10}){0,10}$",
                    message = "Formats must be a comma-separated list, e.g. 'pdf,jpg,png'") String allowedFormats,
            @Min(1) @Max(50) int maxSizeMb,
            boolean required,
            boolean expiryTracked,
            Boolean active,
            Integer sortOrder
    ) {}

    @Operation(summary = "List document types (active first). Any authenticated user with type.read.")
    @GetMapping
    @PreAuthorize("hasAuthority('hrms.document.type.read')")
    @Transactional(readOnly = true)
    public List<DocumentTypeDto> list(@RequestParam(defaultValue = "false") boolean includeInactive) {
        // A workspace created after V143.7 has no types at all; give it the defaults on first read.
        // Only the first read of an empty workspace takes the seeding transaction (a second connection).
        if (defaults.missing()) defaults.ensureDefaults();
        String sql = includeInactive
                ? "SELECT id, code, display_name, description, allowed_formats, max_size_mb, required, expiry_tracked, active, sort_order FROM document_mgmt.document_types ORDER BY sort_order, display_name"
                : "SELECT id, code, display_name, description, allowed_formats, max_size_mb, required, expiry_tracked, active, sort_order FROM document_mgmt.document_types WHERE active = TRUE ORDER BY sort_order, display_name";
        return jdbc.query(sql, (rs, i) -> new DocumentTypeDto(
                rs.getObject("id", UUID.class), rs.getString("code"), rs.getString("display_name"),
                rs.getString("description"), rs.getString("allowed_formats"), rs.getInt("max_size_mb"),
                rs.getBoolean("required"), rs.getBoolean("expiry_tracked"), rs.getBoolean("active"),
                rs.getInt("sort_order")));
    }

    @Operation(summary = "Create a new document type")
    @PostMapping
    @PreAuthorize("hasAuthority('hrms.document.type.write')")
    @Transactional
    public ResponseEntity<Map<String, String>> create(@Valid @RequestBody UpsertRequest body) {
        UUID tenant = TenantContext.getTenantId();
        Integer exists = jdbc.queryForObject(
                "SELECT count(*) FROM document_mgmt.document_types WHERE tenant_id = ? AND code = ?",
                Integer.class, tenant, body.code());
        if (exists != null && exists > 0) {
            throw new BusinessRuleException("A document type with that code already exists.", "DOC_TYPE_DUPLICATE");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO document_mgmt.document_types
                    (id, tenant_id, code, display_name, description, allowed_formats,
                     max_size_mb, required, expiry_tracked, active, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, tenant, body.code(), body.displayName(), body.description(),
                body.allowedFormats().toLowerCase(), body.maxSizeMb(), body.required(),
                body.expiryTracked(), body.active() == null ? true : body.active(),
                body.sortOrder() == null ? 100 : body.sortOrder());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id.toString()));
    }

    @Operation(summary = "Update a document type")
    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.document.type.write')")
    @Transactional
    public void update(@PathVariable UUID id, @Valid @RequestBody UpsertRequest body) {
        int n = jdbc.update("""
                UPDATE document_mgmt.document_types
                   SET display_name = ?, description = ?, allowed_formats = ?, max_size_mb = ?,
                       required = ?, expiry_tracked = ?, active = COALESCE(?, active),
                       sort_order = COALESCE(?, sort_order), updated_at = now()
                 WHERE id = ?
                """, body.displayName(), body.description(), body.allowedFormats().toLowerCase(),
                body.maxSizeMb(), body.required(), body.expiryTracked(),
                body.active(), body.sortOrder(), id);
        if (n == 0) throw new BusinessRuleException("Document type not found.", "DOC_TYPE_NOT_FOUND");
    }

    @Operation(summary = "Deactivate a document type (soft delete). Existing uploads keep their type reference.")
    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('hrms.document.type.write')")
    @Transactional
    public void deactivate(@PathVariable UUID id) {
        int n = jdbc.update("UPDATE document_mgmt.document_types SET active = FALSE, updated_at = now() WHERE id = ?", id);
        if (n == 0) throw new BusinessRuleException("Document type not found.", "DOC_TYPE_NOT_FOUND");
    }
}
