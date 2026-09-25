package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.dto.WorkforceDtos.ContractorResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.ContractorWorkerResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateContractorRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateContractorRequest;
import com.hrms.employee.workforce.entity.Contractor;
import com.hrms.employee.workforce.repository.ContractorRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Staffing agencies (Contractor Master) and the contract workers they supply.
 *
 * <p>V143.22 added the licence, service and deployment sites, plus the link
 * from contract workers (employees whose employment type is CONTRACT) to their
 * agency in {@code hrms.contractor_workers}. The worker count shown for an
 * agency is counted from those links: linked CONTRACT employees who work here
 * now (ACTIVE, PROBATION or NOTICE_PERIOD). The old active_workers_count column
 * was never written and is no longer read.
 *
 * <p>Sites and worker links are plain JDBC on the request's transaction, so the
 * tenant GUC (RLS) applies; tenant_id is written explicitly.
 */
@Service
@Transactional
public class ContractorService {

    private static final String EMPLOYED = "e.is_active = TRUE AND e.employment_status IN ('ACTIVE','PROBATION','NOTICE_PERIOD')";

    private final ContractorRepository repository;
    private final JdbcTemplate jdbc;

    public ContractorService(ContractorRepository repository, JdbcTemplate jdbc) {
        this.repository = repository;
        this.jdbc = jdbc;
    }

    /** Active agencies only (the old behaviour), or ended ones too. */
    @Transactional(readOnly = true)
    public List<ContractorResponse> listForCompany(UUID companyId, boolean includeArchived) {
        List<Contractor> rows = includeArchived
                ? repository.findAllByCompanyIdOrderByActiveDescAgencyNameAsc(companyId)
                : repository.findAllByCompanyIdAndActiveTrueOrderByAgencyNameAsc(companyId);
        if (rows.isEmpty()) return List.of();
        Map<UUID, List<UUID>> sites = new HashMap<>();
        jdbc.query("""
                SELECT s.contractor_id, s.branch_id FROM hrms.contractor_sites s
                  JOIN hrms.contractors c ON c.id = s.contractor_id
                 WHERE c.company_id = ? ORDER BY s.created_at""",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> sites
                        .computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>()).add(rs.getObject(2, UUID.class)),
                companyId);
        Map<UUID, List<UUID>> workers = new HashMap<>();
        Map<UUID, Integer> employed = new HashMap<>();
        jdbc.query("""
                SELECT w.contractor_id, w.employee_id, (""" + EMPLOYED + """
                ) AS employed
                  FROM hrms.contractor_workers w
                  JOIN hrms.contractors c ON c.id = w.contractor_id
                  JOIN hrms.employees e ON e.id = w.employee_id
                 WHERE c.company_id = ? AND e.employment_type = 'CONTRACT'
                 ORDER BY w.linked_at""",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                    UUID agency = rs.getObject(1, UUID.class);
                    workers.computeIfAbsent(agency, k -> new ArrayList<>()).add(rs.getObject(2, UUID.class));
                    if (rs.getBoolean(3)) employed.merge(agency, 1, Integer::sum);
                },
                companyId);
        return rows.stream().map(c -> toResponse(c,
                sites.getOrDefault(c.getId(), List.of()),
                workers.getOrDefault(c.getId(), List.of()),
                employed.getOrDefault(c.getId(), 0))).toList();
    }

    public ContractorResponse create(CreateContractorRequest req) {
        if (repository.existsByCompanyIdAndAgencyNameIgnoreCase(req.companyId(), req.agencyName())) {
            throw new BusinessRuleException("Contractor '" + req.agencyName() + "' already exists", "DUPLICATE_CONTRACTOR");
        }
        Contractor c = new Contractor();
        c.setCompanyId(req.companyId());
        c.setAgencyName(req.agencyName().trim());
        c.setRegistrationNumber(blankToNull(req.registrationNumber()));
        c.setGstin(blankToNull(req.gstin()));
        c.setContactPersonName(blankToNull(req.contactPersonName()));
        c.setContactEmail(blankToNull(req.contactEmail()));
        c.setContactPhone(blankToNull(req.contactPhone()));
        c.setAddressLine(blankToNull(req.addressLine()));
        c.setCity(blankToNull(req.city()));
        c.setState(blankToNull(req.state()));
        c.setLicenceNumber(blankToNull(req.licenceNumber()));
        c.setLicenceValidUntil(req.licenceValidUntil());
        c.setServiceType(blankToNull(req.serviceType()));
        c.setActive(true);
        // Flushed now: the sites below are inserted over JDBC and reference this row.
        Contractor saved = repository.saveAndFlush(c);
        if (req.siteBranchIds() != null) replaceSites(saved, req.siteBranchIds());
        return get(saved.getId());
    }

    /** Partial: see {@link UpdateContractorRequest}. Works on ended agencies too. */
    public ContractorResponse update(UUID id, UpdateContractorRequest req) {
        Contractor c = find(id);
        if (req.agencyName() != null) {
            String name = req.agencyName().trim();
            if (name.isEmpty()) throw new BusinessRuleException("The agency needs a name", "AGENCY_NAME_REQUIRED");
            repository.findFirstByCompanyIdAndAgencyNameIgnoreCase(c.getCompanyId(), name)
                    .filter(other -> !other.getId().equals(c.getId()))
                    .ifPresent(other -> {
                        throw new BusinessRuleException("Contractor '" + name + "' already exists", "DUPLICATE_CONTRACTOR");
                    });
            c.setAgencyName(name);
        }
        if (req.registrationNumber() != null) c.setRegistrationNumber(blankToNull(req.registrationNumber()));
        if (req.gstin() != null)              c.setGstin(blankToNull(req.gstin()));
        if (req.contactPersonName() != null)  c.setContactPersonName(blankToNull(req.contactPersonName()));
        if (req.contactEmail() != null)       c.setContactEmail(blankToNull(req.contactEmail()));
        if (req.contactPhone() != null)       c.setContactPhone(blankToNull(req.contactPhone()));
        if (req.addressLine() != null)        c.setAddressLine(blankToNull(req.addressLine()));
        if (req.city() != null)               c.setCity(blankToNull(req.city()));
        if (req.state() != null)              c.setState(blankToNull(req.state()));
        if (req.licenceNumber() != null)      c.setLicenceNumber(blankToNull(req.licenceNumber()));
        if (req.licenceValidUntil() != null)  c.setLicenceValidUntil(parseDate(req.licenceValidUntil(), "licence date"));
        if (req.serviceType() != null)        c.setServiceType(blankToNull(req.serviceType()));
        Contractor saved = repository.saveAndFlush(c);
        if (req.siteBranchIds() != null) replaceSites(saved, req.siteBranchIds());
        return get(saved.getId());
    }

    /** End the contract: the agency is kept (with its sites and worker links) and can be reactivated. */
    public void archive(UUID id) {
        Contractor c = find(id);
        c.setActive(false);
        repository.save(c);
    }

    /** Reactivate an ended agency. */
    public ContractorResponse restore(UUID id) {
        Contractor c = find(id);
        if (!c.isActive()) {
            c.setActive(true);
            repository.save(c);
        }
        return get(id);
    }

    @Transactional(readOnly = true)
    public ContractorResponse get(UUID id) {
        Contractor c = find(id);
        return listForCompany(c.getCompanyId(), true).stream()
                .filter(r -> r.id().equals(id)).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Contractor " + id + " not found"));
    }

    // -- contract workers ----------------------------------------------------

    @Transactional(readOnly = true)
    public List<ContractorWorkerResponse> workers(UUID contractorId) {
        find(contractorId);
        return jdbc.query("""
                SELECT e.id, e.employee_code, concat_ws(' ', e.first_name, e.last_name), e.employment_status, w.linked_at
                  FROM hrms.contractor_workers w
                  JOIN hrms.employees e ON e.id = w.employee_id
                 WHERE w.contractor_id = ? AND e.employment_type = 'CONTRACT'
                 ORDER BY e.first_name, e.last_name""",
                (rs, i) -> new ContractorWorkerResponse(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getTimestamp(5) == null ? null : rs.getTimestamp(5).toInstant()),
                contractorId);
    }

    /**
     * Link a contract worker to this agency. A worker has one agency, so this
     * moves them if they were with another. Only employees of the same company
     * whose employment type is CONTRACT can be linked, and only to an agency
     * that is still active.
     */
    public ContractorWorkerResponse linkWorker(UUID contractorId, UUID employeeId, String actor) {
        Contractor c = find(contractorId);
        if (!c.isActive()) {
            throw new BusinessRuleException(c.getAgencyName() + "'s contract has ended; reactivate it before adding workers", "AGENCY_INACTIVE");
        }
        List<Map<String, Object>> emp = jdbc.queryForList(
                "SELECT company_id, employment_type FROM hrms.employees WHERE id = ?", employeeId);
        if (emp.isEmpty()) throw new ResourceNotFoundException("Employee " + employeeId + " not found");
        if (!c.getCompanyId().equals(emp.get(0).get("company_id"))) {
            throw new BusinessRuleException("This person works for another company than the agency", "WORKER_OTHER_COMPANY");
        }
        if (!"CONTRACT".equals(emp.get(0).get("employment_type"))) {
            throw new BusinessRuleException("Only contract workers can be linked to an agency. Change their employment type to Contract first.", "NOT_CONTRACT_WORKER");
        }
        jdbc.update("""
                INSERT INTO hrms.contractor_workers (tenant_id, employee_id, contractor_id, linked_at, linked_by)
                VALUES (?, ?, ?, now(), ?)
                ON CONFLICT (employee_id) DO UPDATE
                   SET contractor_id = EXCLUDED.contractor_id, linked_at = now(), linked_by = EXCLUDED.linked_by
                 WHERE hrms.contractor_workers.contractor_id <> EXCLUDED.contractor_id""",
                TenantContext.getTenantId(), employeeId, contractorId, actor);
        return workers(contractorId).stream().filter(w -> w.employeeId().equals(employeeId)).findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Employee " + employeeId + " not found"));
    }

    /** Unlink a worker from this agency. Unlinking someone who isn't linked here is a no-op. */
    public void unlinkWorker(UUID contractorId, UUID employeeId) {
        find(contractorId);
        jdbc.update("DELETE FROM hrms.contractor_workers WHERE contractor_id = ? AND employee_id = ?", contractorId, employeeId);
    }

    // -- helpers ---------------------------------------------------------------

    /** Replace the agency's deployment sites. Every branch must belong to the agency's company. */
    void replaceSites(Contractor c, List<UUID> branchIds) {
        List<UUID> ids = new ArrayList<>(new LinkedHashSet<>(branchIds.stream().filter(java.util.Objects::nonNull).toList()));
        if (!ids.isEmpty()) {
            String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
            List<Object> args = new ArrayList<>(ids);
            args.add(c.getCompanyId());
            Integer found = jdbc.queryForObject(
                    "SELECT count(*) FROM org.branches WHERE id IN (" + marks + ") AND company_id = ?", Integer.class, args.toArray());
            if (found == null || found != ids.size()) {
                throw new BusinessRuleException("Pick branches of the agency's own company", "SITE_OTHER_COMPANY");
            }
        }
        jdbc.update("DELETE FROM hrms.contractor_sites WHERE contractor_id = ?", c.getId());
        UUID tenant = c.getTenantId() != null ? c.getTenantId() : TenantContext.getTenantId();
        for (UUID b : ids) {
            jdbc.update("INSERT INTO hrms.contractor_sites (tenant_id, contractor_id, branch_id) VALUES (?, ?, ?)", tenant, c.getId(), b);
        }
    }

    private Contractor find(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Contractor " + id + " not found"));
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    static LocalDate parseDate(String s, String what) {
        if (s == null || s.isBlank()) return null;
        try {
            return LocalDate.parse(s.trim());
        } catch (DateTimeParseException e) {
            throw new BusinessRuleException("The " + what + " isn't a valid date (use YYYY-MM-DD)", "INVALID_DATE");
        }
    }

    private ContractorResponse toResponse(Contractor c, List<UUID> sites, List<UUID> workerIds, int employed) {
        return new ContractorResponse(
                c.getId(), c.getCompanyId(), c.getAgencyName(),
                c.getRegistrationNumber(), c.getGstin(),
                c.getContactPersonName(), c.getContactEmail(), c.getContactPhone(),
                c.getCity(), employed, c.isActive(),
                c.getLicenceNumber(), c.getLicenceValidUntil(), c.getServiceType(),
                List.copyOf(sites), List.copyOf(workerIds));
    }
}
