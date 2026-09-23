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
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.time.LocalDate;
import java.util.UUID;

/** Uploads use a private document bucket; persistent records store object keys. */
@RestController
@RequestMapping("/v1/document")
public class DocumentUploadController {
    private final DocumentStorage storage;
    private final EmployeeRepository employees;
    private final DocumentService documents;

    public DocumentUploadController(DocumentStorage storage, EmployeeRepository employees, DocumentService documents) {
        this.storage = storage; this.employees = employees; this.documents = documents;
    }

    public record Metadata(@NotNull UUID employeeId, @NotBlank String title,
                           @NotNull DocumentCategory category, LocalDate issuedDate,
                           LocalDate expiryDate, String notes) {}

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('hrms.document.write')")
    public DocumentResponse upload(@RequestPart("file") MultipartFile file,
                                   @Valid @RequestPart("metadata") Metadata metadata) throws IOException {
        var employee = employees.findById(metadata.employeeId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found"));
        if (!storage.isConfigured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Document storage is not configured");
        if (file.isEmpty() || file.getSize() > 10L * 1024 * 1024)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a non-empty file of at most 10 MB");
        if (metadata.expiryDate() != null && metadata.issuedDate() != null && metadata.expiryDate().isBefore(metadata.issuedDate()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expiry date cannot precede issue date");
        byte[] bytes = file.getBytes();
        String type = documentType(bytes);
        String ext = type.equals("application/pdf") ? ".pdf" : type.equals("image/png") ? ".png" : ".jpg";
        String key = "employee-documents/" + TenantContext.getTenantId() + "/" + UUID.randomUUID() + ext;
        storage.put(key, bytes, type);
        try {
            return documents.createDocument(employee.getId(), employee.getCompanyId(), new DocumentRequest(
                    employee.getId(), employee.getCompanyId(), metadata.title().trim(), metadata.category(),
                    "r2://" + key, metadata.issuedDate(), metadata.expiryDate(), metadata.notes()));
        } catch (RuntimeException failure) { storage.deleteQuietly(key); throw failure; }
    }

    static String documentType(byte[] bytes) {
        if (bytes.length >= 5 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F' && bytes[4] == '-') return "application/pdf";
        if (bytes.length >= 8 && (bytes[0] & 255) == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71 && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10) return "image/png";
        if (bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255) return "image/jpeg";
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Supported documents: PDF, PNG and JPEG");
    }
}
