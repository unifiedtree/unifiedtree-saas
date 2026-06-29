package com.hrms.document.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.document.dto.DocumentRequest;
import com.hrms.document.dto.DocumentResponse;
import com.hrms.document.entity.EmployeeDocument;
import com.hrms.document.repository.DocumentVaultRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class DocumentService {

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private final DocumentVaultRepository documentRepository;

    public DocumentService(DocumentVaultRepository documentRepository) {
        this.documentRepository = documentRepository;
    }

    /**
     * Store a document in an employee's vault. The owning employee and company are
     * resolved by the caller; tenant is bound server-side from the request context.
     */
    @Transactional
    public DocumentResponse createDocument(UUID employeeId, UUID companyId, DocumentRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        EmployeeDocument document = new EmployeeDocument();
        document.setTenantId(tenantId);
        document.setEmployeeId(employeeId);
        document.setCompanyId(companyId);
        document.setTitle(request.title());
        document.setCategory(request.category());
        document.setFileUrl(request.fileUrl());
        document.setIssuedDate(request.issuedDate());
        document.setExpiryDate(request.expiryDate());
        document.setNotes(request.notes());
        document = documentRepository.save(document);

        log.info("Employee document stored id={} employee={} category={}",
                document.getId(), employeeId, request.category());
        return toResponse(document);
    }

    @Transactional(readOnly = true)
    public PageResponse<DocumentResponse> getEmployeeDocuments(UUID employeeId, Pageable pageable) {
        return toPage(documentRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId, pageable));
    }

    @Transactional(readOnly = true)
    public DocumentResponse getDocument(UUID documentId) {
        EmployeeDocument document = documentRepository.findById(documentId)
                .orElseThrow(() -> new ResourceNotFoundException("EmployeeDocument", documentId));
        return toResponse(document);
    }

    @Transactional
    public void deleteDocument(UUID documentId) {
        EmployeeDocument document = documentRepository.findById(documentId)
                .orElseThrow(() -> new ResourceNotFoundException("EmployeeDocument", documentId));
        documentRepository.delete(document);
        log.info("Employee document deleted id={} employee={}", documentId, document.getEmployeeId());
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<DocumentResponse> toPage(Page<EmployeeDocument> page) {
        return PageResponse.from(page, this::toResponse);
    }

    private DocumentResponse toResponse(EmployeeDocument d) {
        return new DocumentResponse(
                d.getId(), d.getEmployeeId(), null, null, d.getCompanyId(),
                d.getTitle(), d.getCategory(), d.getFileUrl(),
                d.getIssuedDate(), d.getExpiryDate(), d.getNotes(), d.getCreatedAt());
    }
}
