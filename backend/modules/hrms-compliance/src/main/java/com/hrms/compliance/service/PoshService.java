package com.hrms.compliance.service;

import com.hrms.compliance.dto.PoshComplaintRequest;
import com.hrms.compliance.dto.PoshComplaintResponse;
import com.hrms.compliance.dto.PoshStatusRequest;
import com.hrms.compliance.entity.PoshComplaint;
import com.hrms.compliance.enums.PoshStatus;
import com.hrms.compliance.repository.PoshComplaintRepository;
import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.Year;
import java.util.List;
import java.util.UUID;

/**
 * POSH (Prevention of Sexual Harassment) complaints register. Held in a dedicated,
 * access-restricted service: every operation is gated by the sensitive
 * {@code hrms.compliance.posh} permission at the controller boundary.
 */
@Service
public class PoshService {

    private static final Logger log = LoggerFactory.getLogger(PoshService.class);

    private final PoshComplaintRepository complaintRepository;

    public PoshService(PoshComplaintRepository complaintRepository) {
        this.complaintRepository = complaintRepository;
    }

    @Transactional
    public PoshComplaintResponse createComplaint(UUID companyId, PoshComplaintRequest request) {
        PoshComplaint complaint = new PoshComplaint();
        complaint.setTenantId(TenantContext.getTenantId());
        complaint.setCompanyId(companyId);
        complaint.setComplaintNo(resolveComplaintNo(request.complaintNo()));
        complaint.setFiledDate(request.filedDate());
        complaint.setSeverity(request.severity());
        complaint.setDescription(request.description());
        complaint.setStatus(PoshStatus.RECEIVED);
        complaint = complaintRepository.save(complaint);
        // Deliberately not logging complaint content — only the generated register number.
        log.info("POSH complaint registered no={} company={}", complaint.getComplaintNo(), companyId);
        return toResponse(complaint);
    }

    @Transactional(readOnly = true)
    public PageResponse<PoshComplaintResponse> listComplaints(UUID companyId, Pageable pageable) {
        Page<PoshComplaint> page = companyId != null
                ? complaintRepository.findByCompanyIdOrderByFiledDateDesc(companyId, pageable)
                : complaintRepository.findAllByOrderByFiledDateDesc(pageable);
        List<PoshComplaintResponse> content = page.getContent().stream()
                .map(this::toResponse)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional
    public PoshComplaintResponse updateStatus(UUID complaintId, PoshStatusRequest request) {
        PoshComplaint complaint = complaintRepository.findById(complaintId)
                .orElseThrow(() -> new ResourceNotFoundException("PoshComplaint", complaintId));
        if (complaint.getStatus() == PoshStatus.RESOLVED || complaint.getStatus() == PoshStatus.DISMISSED) {
            throw new BusinessRuleException(
                    "This complaint is already closed (current status: " + complaint.getStatus() + ")",
                    "POSH_ALREADY_CLOSED");
        }
        complaint.setStatus(request.status());
        if (request.resolution() != null && !request.resolution().isBlank()) {
            complaint.setResolution(request.resolution().trim());
        }
        // A resolved outcome stamps the resolution date; dismissal closes without one.
        if (request.status() == PoshStatus.RESOLVED) {
            complaint.setResolvedDate(LocalDate.now());
        }
        complaint = complaintRepository.save(complaint);
        log.info("POSH complaint {} status updated to {}", complaintId, request.status());
        return toResponse(complaint);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String resolveComplaintNo(String supplied) {
        if (supplied != null && !supplied.isBlank()) {
            return supplied.trim();
        }
        // Generate a unique register number: POSH-<year>-<8 hex>.
        String candidate;
        do {
            candidate = "POSH-" + Year.now().getValue() + "-"
                    + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        } while (complaintRepository.existsByComplaintNo(candidate));
        return candidate;
    }

    private PoshComplaintResponse toResponse(PoshComplaint c) {
        return new PoshComplaintResponse(
                c.getId(), c.getCompanyId(), c.getComplaintNo(), c.getFiledDate(), c.getSeverity(),
                c.getStatus(), c.getDescription(), c.getResolution(), c.getResolvedDate(), c.getCreatedAt());
    }
}
