package com.hrms.api.document;

import com.hrms.core.tenant.TenantContext;
import com.hrms.document.dto.DocumentRequest;
import com.hrms.document.dto.DocumentResponse;
import com.hrms.document.enums.DocumentCategory;
import com.hrms.document.service.DocumentService;
import com.hrms.employee.repository.EmployeeRepository;
import com.unifiedtree.settings.branding.DocumentStorage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Uploads use a private document bucket; persistent records store object keys. */
@RestController
@RequestMapping("/v1/document")
public class DocumentUploadController {
    private final DocumentStorage storage;
    private final EmployeeRepository employees;
    private final DocumentService documents;
    private final JdbcTemplate jdbc;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private ApplicationEventPublisher events;

    public DocumentUploadController(DocumentStorage storage, EmployeeRepository employees,
                                    DocumentService documents, JdbcTemplate jdbc) {
        this.storage = storage; this.employees = employees; this.documents = documents; this.jdbc = jdbc;
    }

    /** HR / admin upload for an arbitrary employee. */
    public record Metadata(@NotNull UUID employeeId, @NotBlank String title,
                           @NotNull DocumentCategory category, LocalDate issuedDate,
                           LocalDate expiryDate, String notes,
                           /** V143.7: typed upload; null falls back to legacy free-form. */
                           UUID documentTypeId) {}

    /** Employee self-service upload: employeeId comes from the JWT. */
    public record SelfMetadata(@NotBlank String title, LocalDate issuedDate, LocalDate expiryDate,
                               String notes, @NotNull UUID documentTypeId) {}

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.document.write')")
    public DocumentResponse upload(@RequestPart("file") MultipartFile file,
                                   @Valid @RequestPart("metadata") Metadata metadata,
                                   @AuthenticationPrincipal Jwt jwt) throws IOException {
        var employee = employees.findById(metadata.employeeId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found"));
        DocumentType type = metadata.documentTypeId() == null ? null : requireType(metadata.documentTypeId());
        validateFile(file, type);
        if (metadata.expiryDate() != null && metadata.issuedDate() != null && metadata.expiryDate().isBefore(metadata.issuedDate()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expiry date cannot precede issue date");
        DocumentResponse saved = storeAndPersist(employee.getId(), employee.getCompanyId(), file,
                metadata.title(), metadata.category(), metadata.issuedDate(), metadata.expiryDate(),
                metadata.notes(), type,
                // HR upload lands verified (they are the source of truth).
                "VERIFIED");
        // Record who verified it and when, as a verify from the review queue does.
        // An owner login may have no employee record: the time is still stamped.
        String uploaderEmployee = jwt == null ? null : jwt.getClaimAsString("employee_id");
        jdbc.update("UPDATE document_mgmt.employee_documents SET verified_by = ?, verified_at = now() "
                  + "WHERE id = ? AND tenant_id = ?",
                uploaderEmployee == null ? null : UUID.fromString(uploaderEmployee),
                saved.id(), TenantContext.getTenantId());
        return documents.getDocument(saved.id());
    }

    /** Employee uploads a document for themselves. Lands PENDING for HR verification. */
    @PostMapping(value = "/upload/self", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.document.write.self')")
    public DocumentResponse uploadSelf(@RequestPart("file") MultipartFile file,
                                       @Valid @RequestPart("metadata") SelfMetadata metadata,
                                       @AuthenticationPrincipal Jwt jwt) throws IOException {
        UUID employeeId = extractEmployeeId(jwt);
        var employee = employees.findById(employeeId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee record not found for this login"));
        DocumentType type = requireType(metadata.documentTypeId());
        validateFile(file, type);
        if (metadata.expiryDate() != null && metadata.issuedDate() != null && metadata.expiryDate().isBefore(metadata.issuedDate()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expiry date cannot precede issue date");
        DocumentResponse saved = storeAndPersist(employeeId, employee.getCompanyId(), file,
                metadata.title(), guessCategory(type.code), metadata.issuedDate(), metadata.expiryDate(),
                metadata.notes(), type, "PENDING");
        // Fire event so HR gets a bell/push notification for the pending review.
        try {
            if (events != null) {
                events.publishEvent(new com.unifiedtree.notifications.events.DocumentUploadedEvent(
                        saved.id(), employeeId, TenantContext.getTenantId(),
                        type.code, type.displayName, metadata.title()));
            }
        } catch (Exception ignore) { /* best-effort */ }
        return saved;
    }

    private DocumentResponse storeAndPersist(UUID employeeId, UUID companyId, MultipartFile file,
                                             String title, DocumentCategory category, LocalDate issued,
                                             LocalDate expiry, String notes, DocumentType type,
                                             String verificationStatus) throws IOException {
        // Validate the FILE first so a config-missing message doesn't hide a
        // real client error (wrong format / oversized).
        byte[] bytes = file.getBytes();
        String contentType = detectContentType(bytes);
        String ext = extForContentType(contentType);
        if (type != null && !type.allowsFormat(ext)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Upload a " + type.allowedFormats + " for " + type.displayName + " (this file is " + ext + ")");
        }
        if (!storage.isConfigured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Document storage is not configured. Ask your admin to set R2_DOCUMENT_BUCKET.");
        String key = "employee-documents/" + TenantContext.getTenantId() + "/" + UUID.randomUUID() + "." + ext;
        storage.put(key, bytes, contentType);
        try {
            return documents.createDocument(employeeId, companyId,
                    new DocumentRequest(employeeId, companyId, title.trim(), category,
                            "r2://" + key, issued, expiry, notes),
                    type == null ? null : type.id,
                    file.getOriginalFilename(), file.getSize(), contentType,
                    verificationStatus);
        } catch (RuntimeException failure) {
            storage.deleteQuietly(key);
            throw failure;
        }
    }

    private void validateFile(MultipartFile file, DocumentType type) {
        if (file == null || file.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a file to upload");
        long maxBytes = (type == null ? 10L : type.maxSizeMb) * 1024L * 1024L;
        if (file.getSize() > maxBytes) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "File is too large. Max " + (type == null ? 10 : type.maxSizeMb) + " MB.");
        }
    }

    /** Look up a document type row by id and hydrate into a lightweight record. Throws 404 if missing/inactive. */
    private DocumentType requireType(UUID id) {
        Map<String, Object> row;
        try {
            row = jdbc.queryForMap(
                    "SELECT id, code, display_name, allowed_formats, max_size_mb, active FROM document_mgmt.document_types WHERE id = ?", id);
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Document type not found");
        }
        if (!Boolean.TRUE.equals(row.get("active"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That document type is inactive; ask HR to enable it.");
        }
        return new DocumentType((UUID) row.get("id"), (String) row.get("code"),
                (String) row.get("display_name"), (String) row.get("allowed_formats"),
                ((Number) row.get("max_size_mb")).intValue());
    }

    /** Map a document-type code to the legacy category enum so the vault stays sortable by category. */
    private static DocumentCategory guessCategory(String code) {
        return switch (code) {
            case "PAN", "TAX" -> DocumentCategory.TAX;
            case "AADHAAR", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID", "PHOTO" -> DocumentCategory.ID_PROOF;
            case "RESUME", "OFFER_LETTER" -> DocumentCategory.CONTRACT;
            case "EDUCATION_CERT" -> DocumentCategory.CERTIFICATE;
            default -> DocumentCategory.OTHER;
        };
    }

    /** Package-visible for the content-type unit test. */
    static String detectContentTypeFor(byte[] bytes) { return detectContentType(bytes); }

    private static String detectContentType(byte[] bytes) {
        if (bytes.length >= 5 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F' && bytes[4] == '-') return "application/pdf";
        if (bytes.length >= 8 && (bytes[0] & 255) == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71) return "image/png";
        if (bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255) return "image/jpeg";
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Supported formats: PDF, PNG, JPEG");
    }

    private static String extForContentType(String contentType) {
        return switch (contentType) {
            case "application/pdf" -> "pdf";
            case "image/png" -> "png";
            case "image/jpeg" -> "jpg";
            default -> "bin";
        };
    }

    private static UUID extractEmployeeId(Jwt jwt) {
        String empId = jwt.getClaimAsString("employee_id");
        if (empId == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Your login is not linked to an employee record.");
        return UUID.fromString(empId);
    }

    /** Lightweight snapshot of one type row for upload-time validation. */
    private record DocumentType(UUID id, String code, String displayName, String allowedFormats, int maxSizeMb) {
        boolean allowsFormat(String ext) {
            String needle = ext.toLowerCase(Locale.ROOT);
            List<String> allowed = Arrays.asList(allowedFormats.toLowerCase(Locale.ROOT).split(","));
            return allowed.contains(needle) || (needle.equals("jpg") && allowed.contains("jpeg"))
                    || (needle.equals("jpeg") && allowed.contains("jpg"));
        }
    }
}
