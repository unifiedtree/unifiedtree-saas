package com.hrms.compliance.service;

import com.hrms.compliance.dto.ComplianceItemRequest;
import com.hrms.compliance.dto.ComplianceItemResponse;
import com.hrms.compliance.dto.FileFilingRequest;
import com.hrms.compliance.dto.InspectorSessionRequest;
import com.hrms.compliance.dto.InspectorSessionResponse;
import com.hrms.compliance.dto.ComplianceCalendarEventResponse;
import com.hrms.compliance.dto.StatutoryFilingRequest;
import com.hrms.compliance.dto.StatutoryFilingResponse;
import com.hrms.compliance.entity.ComplianceItem;
import com.hrms.compliance.entity.StatutoryFiling;
import com.hrms.compliance.entity.InspectorSession;
import com.hrms.compliance.enums.ComplianceStatus;
import com.hrms.compliance.enums.FilingStatus;
import com.hrms.compliance.enums.InspectorSessionStatus;
import com.hrms.compliance.repository.ComplianceItemRepository;
import com.hrms.compliance.repository.StatutoryFilingRepository;
import com.hrms.compliance.repository.InspectorSessionRepository;
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
import java.time.Instant;
import java.security.SecureRandom;
import java.util.List;
import java.util.UUID;

/**
 * Statutory compliance: the compliance calendar (obligations + due dates) and the
 * statutory filings ledger (PF / ESI / TDS / PT / Gratuity). POSH complaints are
 * handled separately by {@link PoshService} because they are access-restricted.
 */
@Service
public class ComplianceService {

    private static final Logger log = LoggerFactory.getLogger(ComplianceService.class);

    private final ComplianceItemRepository itemRepository;
    private final StatutoryFilingRepository filingRepository;
    private final InspectorSessionRepository inspectorSessionRepository;
    private static final SecureRandom ACCESS_RANDOM = new SecureRandom();

    public ComplianceService(ComplianceItemRepository itemRepository,
                             StatutoryFilingRepository filingRepository,
                             InspectorSessionRepository inspectorSessionRepository) {
        this.itemRepository = itemRepository;
        this.filingRepository = filingRepository;
        this.inspectorSessionRepository = inspectorSessionRepository;
    }


    @Transactional(readOnly = true)
    public PageResponse<InspectorSessionResponse> listInspectorSessions(UUID companyId, Pageable pageable) {
        Page<InspectorSession> page = companyId != null
                ? inspectorSessionRepository.findByCompanyIdOrderByCreatedAtDesc(companyId, pageable)
                : inspectorSessionRepository.findAllByOrderByCreatedAtDesc(pageable);
        return new PageResponse<>(page.getContent().stream().map(this::toInspectorResponse).toList(),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional
    public InspectorSessionResponse createInspectorSession(UUID companyId, InspectorSessionRequest request) {
        if (request.expiresAt() != null && (!request.expiresAt().isAfter(Instant.now()) || request.expiresAt().isAfter(Instant.now().plusSeconds(604800)))) {
            throw new BusinessRuleException("Inspection access must expire within the next seven days", "INSPECTOR_EXPIRY_INVALID");
        }
        InspectorSession session = new InspectorSession();
        session.setTenantId(TenantContext.getTenantId());
        session.setCompanyId(companyId);
        session.setInspectorName(request.inspectorName());
        session.setInspectorOrg(request.inspectorOrg());
        session.setPurpose(request.purpose());
        session.setAccessCode(generateAccessCode());
        session.setExpiresAt(request.expiresAt() == null ? Instant.now().plusSeconds(86_400) : request.expiresAt());
        session.setStatus(InspectorSessionStatus.ACTIVE);
        session.setNotes(request.notes());
        return toInspectorResponse(inspectorSessionRepository.save(session));
    }

    @Transactional
    public InspectorSessionResponse revokeInspectorSession(UUID id) {
        InspectorSession session = inspectorSessionRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("InspectorSession", id));
        session.setStatus(InspectorSessionStatus.REVOKED);
        session.setRevokedAt(Instant.now());
        return toInspectorResponse(inspectorSessionRepository.save(session));
    }

    @Transactional(readOnly = true)
    public List<ComplianceCalendarEventResponse> calendarEvents(UUID companyId, LocalDate from, LocalDate to) {
        if (from == null) from = LocalDate.now().withDayOfMonth(1);
        if (to == null) to = from.plusMonths(1).minusDays(1);
        if (to.isBefore(from) || to.isAfter(from.plusYears(1))) throw new BusinessRuleException("Choose a date range of at most one year", "CALENDAR_RANGE_INVALID");
        List<ComplianceCalendarEventResponse> itemEvents = itemRepository.calendar(companyId, from, to).stream()
                .map(i -> new ComplianceCalendarEventResponse("item-" + i.getId(), i.getCompanyId(), i.getTitle(),
                        "COMPLIANCE_ITEM", i.getDueDate(), toItemResponse(i).status().name(), i.getCategory(), null))
                .toList();
        List<ComplianceCalendarEventResponse> filingEvents = filingRepository.calendar(companyId, from, to).stream()
                .map(f -> new ComplianceCalendarEventResponse("filing-" + f.getId(), f.getCompanyId(),
                        f.getFilingType().name() + (f.getPeriod() == null ? " Filing" : " Filing - " + f.getPeriod()),
                        "STATUTORY_FILING", f.getDueDate(), f.getStatus().name(), f.getFilingType().name(), null))
                .toList();
        java.util.ArrayList<ComplianceCalendarEventResponse> events = new java.util.ArrayList<>(itemEvents);
        events.addAll(filingEvents);
        events.sort(java.util.Comparator.comparing(ComplianceCalendarEventResponse::date));
        return events;
    }

    private String generateAccessCode() {
        int n = ACCESS_RANDOM.nextInt(900000) + 100000;
        return String.valueOf(n);
    }

    // ── Compliance calendar ──────────────────────────────────────────────────

    @Transactional
    public ComplianceItemResponse createItem(UUID companyId, ComplianceItemRequest request) {
        ComplianceItem item = new ComplianceItem();
        item.setTenantId(TenantContext.getTenantId());
        item.setCompanyId(companyId);
        item.setTitle(request.title());
        item.setCategory(request.category());
        item.setDueDate(request.dueDate());
        item.setFrequency(request.frequency());
        item.setOwnerId(request.ownerId());
        item.setNotes(request.notes());
        item.setStatus(ComplianceStatus.PENDING);
        item = itemRepository.save(item);
        log.info("Compliance item created id={} company={} due={}", item.getId(), companyId, request.dueDate());
        return toItemResponse(item);
    }

    @Transactional(readOnly = true)
    public PageResponse<ComplianceItemResponse> listItems(UUID companyId, Pageable pageable) {
        Page<ComplianceItem> page = companyId != null
                ? itemRepository.findByCompanyIdOrderByDueDateAsc(companyId, pageable)
                : itemRepository.findAllByOrderByDueDateAsc(pageable);
        List<ComplianceItemResponse> content = page.getContent().stream()
                .map(this::toItemResponse)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional
    public ComplianceItemResponse markItemDone(UUID itemId) {
        ComplianceItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("ComplianceItem", itemId));
        if (item.getStatus() == ComplianceStatus.DONE) {
            throw new BusinessRuleException("Compliance item is already marked done", "COMPLIANCE_ALREADY_DONE");
        }
        item.setStatus(ComplianceStatus.DONE);
        item = itemRepository.save(item);
        log.info("Compliance item {} marked done", itemId);
        return toItemResponse(item);
    }

    // ── Statutory filings ────────────────────────────────────────────────────

    @Transactional
    public StatutoryFilingResponse createFiling(UUID companyId, StatutoryFilingRequest request) {
        StatutoryFiling filing = new StatutoryFiling();
        filing.setTenantId(TenantContext.getTenantId());
        filing.setCompanyId(companyId);
        filing.setFilingType(request.filingType());
        filing.setPeriod(request.period());
        filing.setAmount(request.amount());
        filing.setDueDate(request.dueDate());
        filing.setStatus(FilingStatus.DUE);
        filing = filingRepository.save(filing);
        log.info("Statutory filing created id={} type={} due={}", filing.getId(), request.filingType(), request.dueDate());
        return toFilingResponse(filing);
    }

    @Transactional(readOnly = true)
    public PageResponse<StatutoryFilingResponse> listFilings(UUID companyId, Pageable pageable) {
        Page<StatutoryFiling> page = companyId != null
                ? filingRepository.findByCompanyIdOrderByDueDateDesc(companyId, pageable)
                : filingRepository.findAllByOrderByDueDateDesc(pageable);
        List<StatutoryFilingResponse> content = page.getContent().stream()
                .map(this::toFilingResponse)
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    @Transactional
    public StatutoryFilingResponse fileFiling(UUID filingId, FileFilingRequest request) {
        StatutoryFiling filing = filingRepository.findById(filingId)
                .orElseThrow(() -> new ResourceNotFoundException("StatutoryFiling", filingId));
        if (filing.getStatus() == FilingStatus.FILED || filing.getStatus() == FilingStatus.LATE) {
            throw new BusinessRuleException(
                    "This filing has already been recorded as filed (current status: " + filing.getStatus() + ")",
                    "FILING_ALREADY_FILED");
        }
        LocalDate today = LocalDate.now();
        filing.setFiledDate(today);
        // A filing recorded after its statutory due date is LATE; otherwise FILED.
        filing.setStatus(today.isAfter(filing.getDueDate()) ? FilingStatus.LATE : FilingStatus.FILED);
        if (request != null && request.referenceNo() != null && !request.referenceNo().isBlank()) {
            filing.setReferenceNo(request.referenceNo().trim());
        }
        filing = filingRepository.save(filing);
        log.info("Statutory filing {} recorded filed status={} on {}", filingId, filing.getStatus(), today);
        return toFilingResponse(filing);
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private InspectorSessionResponse toInspectorResponse(InspectorSession s) {
        InspectorSessionStatus status = s.getStatus();
        if (status == InspectorSessionStatus.ACTIVE && s.getExpiresAt() != null && s.getExpiresAt().isBefore(Instant.now())) {
            status = InspectorSessionStatus.EXPIRED;
        }
        return new InspectorSessionResponse(s.getId(), s.getCompanyId(), s.getInspectorName(), s.getInspectorOrg(),
                s.getPurpose(), s.getAccessCode(), status, s.getExpiresAt(), s.getLastAccessedAt(), s.getRevokedAt(),
                s.getNotes(), s.getCreatedAt());
    }

    private ComplianceItemResponse toItemResponse(ComplianceItem i) {
        // OVERDUE is derived: an open item whose due date has passed.
        ComplianceStatus status = i.getStatus();
        if (status == ComplianceStatus.PENDING && i.getDueDate() != null
                && i.getDueDate().isBefore(LocalDate.now())) {
            status = ComplianceStatus.OVERDUE;
        }
        return new ComplianceItemResponse(
                i.getId(), i.getCompanyId(), i.getTitle(), i.getCategory(), i.getDueDate(),
                status, i.getFrequency(), i.getOwnerId(), null, null, i.getNotes(), i.getCreatedAt());
    }

    private StatutoryFilingResponse toFilingResponse(StatutoryFiling f) {
        return new StatutoryFilingResponse(
                f.getId(), f.getCompanyId(), f.getFilingType(), f.getPeriod(), f.getAmount(),
                f.getDueDate(), f.getFiledDate(), f.getStatus(), f.getReferenceNo(), f.getCreatedAt());
    }
}
