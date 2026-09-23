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
        ExitRecord employee = jdbc.query(
                "SELECT employment_status,company_id,last_working_day FROM hrms.employees WHERE tenant_id=? AND id=? FOR UPDATE",
                rs -> rs.next() ? new ExitRecord(rs.getString(1), rs.getObject(2, UUID.class), rs.getObject(3, java.time.LocalDate.class)) : null,
                tenantId, request.employeeId());
        if (employee == null) {
            throw new HrmsException(
                    "Employee not found with id: " + request.employeeId(),
                    HttpStatus.NOT_FOUND, "EMPLOYEE_NOT_FOUND");
        }
        String status = employee.status();
        if (!java.util.Objects.equals(companyId, employee.companyId()))
            throw new BusinessRuleException("Settlement company must match the employee's company.", "FNF_COMPANY_MISMATCH");
        if (employee.lastWorkingDay() != null && !employee.lastWorkingDay().equals(request.lastWorkingDay()))
            throw new BusinessRuleException("Last working day must match the employee's recorded exit date.", "FNF_EXIT_DATE_MISMATCH");
        // Guard 2: only separated employees can be F&F'd. An ACTIVE record
        // has no exit and no meaningful last-working-day; run the exit
        // workflow first.
        if (!SEPARATED_STATUSES.contains(status)) {
            throw new BusinessRuleException(
                    "FnF requires exit record. Employee is currently " + status + ".",
                    "EMPLOYEE_NOT_SEPARATED");
        }

        // B3 FIX (audit 2026-08-15): outstanding-advances check. Before FnF
        // was aware of advances, an employee could exit while still owing
        // installments — the schedule kept ticking against a payroll that
        // never ran again, and the money was simply lost. Now: query the
        // outstanding total for this employee's disbursed advances, and if
        // it is non-zero refuse to process the settlement until the caller
        // includes an equivalent ADVANCE_RECOVERY deduction (or explicitly
        // waives it in a separate write-off flow).
        Integer duplicates = jdbc.queryForObject("""
                SELECT count(*) FROM fnf_mgmt.fnf_settlements
                 WHERE tenant_id=? AND employee_id=? AND status<>'CANCELLED'
                   AND (status<>'PAID' OR last_working_day=?)
                """, Integer.class, tenantId, request.employeeId(), request.lastWorkingDay());
        if (duplicates != null && duplicates > 0)
            throw new BusinessRuleException("A settlement already exists for this exit. Review it or cancel an unapproved settlement before making corrections.", "FNF_SETTLEMENT_EXISTS");
        List<AdvanceBalance> advances = lockOutstandingAdvances(tenantId, request.employeeId());
        BigDecimal advanceDeductions = request.components().stream()
                .filter(c -> isAdvanceRecovery(c.type(), c.label()))
                .map(FnfComponentRequest::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        requireExactAdvanceRecovery(advances, advanceDeductions);

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
        FnfSettlement settlement = lockSettlement(settlementId);
        if (settlement.getStatus() != FnfStatus.PROCESSED) {
            throw new BusinessRuleException(
                    "Only a processed settlement can be approved (current status: " + settlement.getStatus() + ")",
                    "FNF_NOT_PROCESSED");
        }
        // B3 FIX (audit 2026-08-15): self-approval guard.
        if (approverId != null && approverId.equals(settlement.getEmployeeId())) {
            throw new BusinessRuleException(
                    "You cannot approve your own FnF settlement.",
                    "FNF_SELF_APPROVAL");
        }
        // Belt-and-braces net-negative guard — processSettlement rejects
        // negatives at creation time, but a legacy row or a component edit
        // could sneak one in.
        if (settlement.getNetSettlement() != null && settlement.getNetSettlement().signum() < 0) {
            throw new BusinessRuleException(
                    "Net settlement cannot be negative",
                    "INVALID_NET_SETTLEMENT");
        }
        UUID tenantId = TenantContext.getTenantId();
        List<FnfComponent> components = componentRepository.findBySettlementIdOrderByTypeAscLabelAsc(settlementId);
        // Advance disbursement uses this same employee-before-advance order.
        // No new debt can be disbursed while the exit recovery is being approved.
        ExitRecord employee = jdbc.query("SELECT employment_status,company_id,last_working_day FROM hrms.employees WHERE tenant_id=? AND id=? FOR UPDATE",
                rs -> rs.next() ? new ExitRecord(rs.getString(1), rs.getObject(2, UUID.class), rs.getObject(3, java.time.LocalDate.class)) : null,
                tenantId, settlement.getEmployeeId());
        if (employee == null) throw new ResourceNotFoundException("Employee", settlement.getEmployeeId());
        if (!SEPARATED_STATUSES.contains(employee.status()))
            throw new BusinessRuleException("The employee's exit changed. Only a separated employee can have an approved settlement.", "EMPLOYEE_NOT_SEPARATED");
        if (!java.util.Objects.equals(employee.companyId(), settlement.getCompanyId()))
            throw new BusinessRuleException("The employee's company changed. Cancel and recreate this unapproved settlement.", "FNF_COMPANY_MISMATCH");
        if (employee.lastWorkingDay() != null && !employee.lastWorkingDay().equals(settlement.getLastWorkingDay()))
            throw new BusinessRuleException("The recorded exit date changed. Cancel and recreate this unapproved settlement.", "FNF_EXIT_DATE_MISMATCH");
        List<AdvanceBalance> advances = lockOutstandingAdvances(tenantId, settlement.getEmployeeId());
        BigDecimal recovery = components.stream().filter(c -> isAdvanceRecovery(c.getType(), c.getLabel()))
                .map(FnfComponent::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        requireExactAdvanceRecovery(advances, recovery);
        // All balance, schedule, ledger and approval changes share this transaction.
        // An absent pending schedule never means the outstanding debt is absent.
        for (AdvanceBalance advance : advances) {
            jdbc.update("""
                    INSERT INTO advance_mgmt.advance_ledger_entries
                        (tenant_id,advance_request_id,entry_type,amount,balance_after,reference,notes,created_by)
                    VALUES (?,?,'FORECLOSE',?,0,?,'Recovered in approved full and final settlement',?)
                    """, tenantId, advance.id(), advance.outstanding().negate(),
                    "fnf-settlement:" + settlementId, approverId == null ? null : approverId.toString());
            jdbc.update("""
                    UPDATE advance_mgmt.advance_recovery_schedule SET status='CANCELLED',updated_at=now(),version=version+1
                     WHERE tenant_id=? AND advance_request_id=? AND status='PENDING'
                    """, tenantId, advance.id());
            jdbc.update("""
                    UPDATE advance_mgmt.advance_requests SET outstanding_amount=0,status='CLOSED',updated_at=now(),version=version+1
                     WHERE tenant_id=? AND id=?
                    """, tenantId, advance.id());
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
        FnfSettlement settlement = lockSettlement(settlementId);
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
        // B3 FIX (audit 2026-08-15): service-level defense-in-depth — the
        // controller already refuses when payer==requester, but the service
        // must not trust its caller.
        // (Payer identity is not passed into this method; the controller does
        // that check with the JWT. This guard rejects a pay call when the
        // settlement's approverId equals its employeeId — indicating a
        // corrupt row where the payee also self-approved.)
        if (settlement.getApproverId() != null
                && settlement.getApproverId().equals(settlement.getEmployeeId())) {
            throw new BusinessRuleException(
                    "This FnF was approved by the payee — refuse to pay a self-approved settlement.",
                    "FNF_SELF_APPROVED_ROW");
        }
        settlement.setStatus(FnfStatus.PAID);
        settlement.setPaidAt(Instant.now());
        settlement = settlementRepository.save(settlement);
        log.info("FnF settlement {} marked paid", settlementId);
        return toResponse(settlement, componentRepository.findBySettlementIdOrderByTypeAscLabelAsc(settlementId));
    }

    // ── mapping ──────────────────────────────────────────────────────────────

    @Transactional
    public FnfSettlementResponse cancel(UUID settlementId) {
        FnfSettlement settlement = lockSettlement(settlementId);
        if (settlement.getStatus() != FnfStatus.CANCELLED) {
            if (settlement.getStatus() != FnfStatus.INITIATED && settlement.getStatus() != FnfStatus.PROCESSED)
                throw new BusinessRuleException("Only an unapproved settlement can be cancelled. Approved recoveries and recorded payments must be preserved.", "FNF_CANNOT_CANCEL");
            settlement.setStatus(FnfStatus.CANCELLED);
            settlement = settlementRepository.save(settlement);
        }
        return toResponse(settlement, componentRepository.findBySettlementIdOrderByTypeAscLabelAsc(settlementId));
    }

    private FnfSettlement lockSettlement(UUID settlementId) {
        String status = jdbc.query("SELECT status FROM fnf_mgmt.fnf_settlements WHERE tenant_id=? AND id=? FOR UPDATE",
                rs -> rs.next() ? rs.getString(1) : null, TenantContext.getTenantId(), settlementId);
        if (status == null) throw new ResourceNotFoundException("FnfSettlement", settlementId);
        FnfSettlement settlement = settlementRepository.findById(settlementId)
                .orElseThrow(() -> new ResourceNotFoundException("FnfSettlement", settlementId));
        if (!status.equals(settlement.getStatus().name()))
            throw new BusinessRuleException("This settlement changed. Refresh its details before continuing.", "FNF_STATE_CHANGED");
        return settlement;
    }

    private record ExitRecord(String status, UUID companyId, java.time.LocalDate lastWorkingDay) {}
    private record AdvanceBalance(UUID id, BigDecimal outstanding) {}

    private List<AdvanceBalance> lockOutstandingAdvances(UUID tenantId, UUID employeeId) {
        return jdbc.query("""
                SELECT id,outstanding_amount FROM advance_mgmt.advance_requests
                 WHERE tenant_id=? AND employee_id=? AND status='DISBURSED' AND outstanding_amount>0
                 ORDER BY id FOR UPDATE
                """, (rs,i) -> new AdvanceBalance(rs.getObject(1, UUID.class), rs.getBigDecimal(2)), tenantId, employeeId);
    }

    private boolean isAdvanceRecovery(FnfComponentType type, String label) {
        return type == FnfComponentType.DEDUCTION && label != null && label.toUpperCase(java.util.Locale.ROOT).contains("ADVANCE");
    }

    private void requireExactAdvanceRecovery(List<AdvanceBalance> advances, BigDecimal recovery) {
        BigDecimal outstanding = advances.stream().map(AdvanceBalance::outstanding).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (recovery.compareTo(outstanding) != 0)
            throw new BusinessRuleException("The Advance Recovery deduction must equal the current outstanding balance of ₹" + outstanding
                    + ". Cancel an unapproved settlement and recreate it if the balance changed.", "FNF_OUTSTANDING_ADVANCE");
    }

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
