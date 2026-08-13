package com.hrms.fnf.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.fnf.dto.FnfComponentRequest;
import com.hrms.fnf.dto.FnfComponentResponse;
import com.hrms.fnf.dto.FnfSettlementRequest;
import com.hrms.fnf.dto.FnfSettlementResponse;
import com.hrms.fnf.entity.FnfComponent;
import com.hrms.fnf.entity.FnfSettlement;
import com.hrms.fnf.enums.FnfComponentType;
import com.hrms.fnf.enums.FnfStatus;
import com.hrms.fnf.repository.FnfComponentRepository;
import com.hrms.fnf.repository.FnfSettlementRepository;
import com.hrms.core.exception.HrmsException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class FnfService {

    private static final Logger log = LoggerFactory.getLogger(FnfService.class);

    /**
     * Only separated employees can have an FnF cut. An ACTIVE (or PROBATION,
     * ON_NOTICE with no exit yet) record has no last-working-day meaning and
     * must go through the exit workflow first.
     */
    private static final Set<String> SEPARATED_STATUSES =
            Set.of("RESIGNED", "TERMINATED", "RETIRED", "ABSCONDING", "EXITED");

    private final FnfSettlementRepository settlementRepository;
    private final FnfComponentRepository componentRepository;
    private final JdbcTemplate jdbc;

    public FnfService(FnfSettlementRepository settlementRepository,
                      FnfComponentRepository componentRepository,
                      JdbcTemplate jdbc) {
        this.settlementRepository = settlementRepository;
        this.componentRepository = componentRepository;
        this.jdbc = jdbc;
    }

    /**
     * Create and process a settlement with its components in one shot. The gross,
     * deductions and net totals are computed server-side from the components
     * (never trusted from the client).
     */
    @Transactional
    public FnfSettlementResponse processSettlement(UUID companyId, FnfSettlementRequest request) {
        if (request.components() == null || request.components().isEmpty()) {
            throw new BusinessRuleException("A settlement must have at least one component", "FNF_EMPTY_SETTLEMENT");
        }
        UUID tenantId = TenantContext.getTenantId();

        // Guard 1: the employee must exist. A missing employee_id currently
        // 500s downstream on FK; surface a domain 404 instead.
        String status = jdbc.query(
                "SELECT employment_status FROM hrms.employees WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                request.employeeId());
        if (status == null) {
            throw new HrmsException(
                    "Employee not found with id: " + request.employeeId(),
                    HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND");
        }
        // Guard 2: only separated employees can be F&F'd. An ACTIVE record
        // has no exit and no meaningful last-working-day; run the exit
        // workflow first.
        if (!SEPARATED_STATUSES.contains(status)) {
            throw new BusinessRuleException(
                    "FnF requires exit record. Employee is currently " + status + ".",
                    "EMPLOYEE_NOT_SEPARATED");
        }

        BigDecimal gross = request.components().stream()
                .filter(c -> c.type() == FnfComponentType.EARNING)
                .map(FnfComponentRequest::amount)
                .filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal deductions = request.components().stream()
                .filter(c -> c.type() == FnfComponentType.DEDUCTION)
                .map(FnfComponentRequest::amount)
                .filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal net = gross.subtract(deductions);

        // Guard 3: never persist a net-negative settlement. Deductions can't
        // exceed earnings — that path should be a recovery ticket, not a
        // negative payout. Mirrored by a CHECK constraint added in V091.
        if (net.signum() < 0) {
            throw new BusinessRuleException(
                    "Net settlement cannot be negative (gross " + gross
                            + " − deductions " + deductions + " = " + net + ")",
                    "INVALID_NET_SETTLEMENT");
        }

        FnfSettlement settlement = new FnfSettlement();
        settlement.setTenantId(tenantId);
        settlement.setEmployeeId(request.employeeId());
        settlement.setCompanyId(companyId);
        settlement.setLastWorkingDay(request.lastWorkingDay());
        settlement.setNotes(request.notes());
        settlement.setGrossPayable(gross);
        settlement.setTotalDeductions(deductions);
        settlement.setNetSettlement(net);
        settlement.setStatus(FnfStatus.PROCESSED);
        settlement.setProcessedAt(Instant.now());
        settlement = settlementRepository.save(settlement);

        final UUID settlementId = settlement.getId();
        List<FnfComponent> components = request.components().stream().map(req -> {
            FnfComponent component = new FnfComponent();
            component.setTenantId(tenantId);
            component.setSettlementId(settlementId);
            component.setLabel(req.label());
            component.setType(req.type());
            component.setAmount(req.amount());
            return component;
        }).toList();
        componentRepository.saveAll(components);

        log.info("FnF settlement processed id={} employee={} net={}", settlementId, request.employeeId(), net);
        return toResponse(settlement, components);
    }

    @Transactional(readOnly = true)
    public PageResponse<FnfSettlementResponse> getSettlements(Pageable pageable) {
        return toPage(settlementRepository.findAllByOrderByCreatedAtDesc(pageable));
    }

    @Transactional(readOnly = true)
    public PageResponse<FnfSettlementResponse> getByStatus(FnfStatus status, Pageable pageable) {
        return toPage(settlementRepository.findByStatusOrderByCreatedAtDesc(status, pageable));
    }

    @Transactional(readOnly = true)
    public FnfSettlementResponse getSettlement(UUID settlementId) {
        FnfSettlement settlement = settlementRepository.findById(settlementId)
                .orElseThrow(() -> new ResourceNotFoundException("FnfSettlement", settlementId));
        return toResponse(settlement, componentRepository.findBySettlementIdOrderByTypeAscLabelAsc(settlementId));
    }

    @Transactional
    public FnfSettlementResponse approve(UUID settlementId, UUID approverId) {
        FnfSettlement settlement = settlementRepository.findById(settlementId)
                .orElseThrow(() -> new ResourceNotFoundException("FnfSettlement", settlementId));
        if (settlement.getStatus() != FnfStatus.PROCESSED) {
            throw new BusinessRuleException(
                    "Only a processed settlement can be approved (current status: " + settlement.getStatus() + ")",
                    "FNF_NOT_PROCESSED");
        }
        // Belt-and-braces net-negative guard — processSettlement rejects
        // negatives at creation time, but a legacy row or a component edit
        // could sneak one in.
        if (settlement.getNetSettlement() != null && settlement.getNetSettlement().signum() < 0) {
            throw new BusinessRuleException(
                    "Net settlement cannot be negative",
                    "INVALID_NET_SETTLEMENT");
        }
        settlement.setStatus(FnfStatus.APPROVED);
        settlement.setApproverId(approverId);
        settlement.setApprovedAt(Instant.now());
        settlement = settlementRepository.save(settlement);
        log.info("FnF settlement {} approved by approver={}", settlementId, approverId);
        return toResponse(settlement, componentRepository.findBySettlementIdOrderByTypeAscLabelAsc(settlementId));
    }

    @Transactional
    public FnfSettlementResponse pay(UUID settlementId) {
        FnfSettlement settlement = settlementRepository.findById(settlementId)
                .orElseThrow(() -> new ResourceNotFoundException("FnfSettlement", settlementId));
        if (settlement.getStatus() != FnfStatus.APPROVED) {
            throw new BusinessRuleException(
                    "Only an approved settlement can be paid (current status: " + settlement.getStatus() + ")",
                    "FNF_NOT_APPROVED");
        }
        // Second net-negative guard at pay-time — same reason as approve().
        if (settlement.getNetSettlement() != null && settlement.getNetSettlement().signum() < 0) {
            throw new BusinessRuleException(
                    "Net settlement cannot be negative",
                    "INVALID_NET_SETTLEMENT");
        }
        settlement.setStatus(FnfStatus.PAID);
        settlement.setPaidAt(Instant.now());
        settlement = settlementRepository.save(settlement);
        log.info("FnF settlement {} marked paid", settlementId);
        return toResponse(settlement, componentRepository.findBySettlementIdOrderByTypeAscLabelAsc(settlementId));
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    private PageResponse<FnfSettlementResponse> toPage(Page<FnfSettlement> page) {
        List<FnfSettlementResponse> content = page.getContent().stream()
                .map(s -> toResponse(s, null))
                .toList();
        return new PageResponse<>(content, page.getNumber(), page.getSize(),
                page.getTotalElements(), page.getTotalPages(), page.isLast());
    }

    private FnfSettlementResponse toResponse(FnfSettlement s, List<FnfComponent> components) {
        List<FnfComponentResponse> componentDtos = components == null ? null
                : components.stream().map(this::toComponent).toList();
        return new FnfSettlementResponse(
                s.getId(), s.getEmployeeId(), null, null, s.getCompanyId(),
                s.getLastWorkingDay(), s.getStatus(), s.getGrossPayable(), s.getTotalDeductions(),
                s.getNetSettlement(), s.getNotes(), s.getProcessedAt(), s.getApprovedAt(),
                s.getPaidAt(), s.getApproverId(), s.getCreatedAt(), componentDtos);
    }

    private FnfComponentResponse toComponent(FnfComponent c) {
        return new FnfComponentResponse(c.getId(), c.getLabel(), c.getType(), c.getAmount());
    }
}
