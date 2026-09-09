package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateCompanyRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateCompanyRequest;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class CompanyService {

    private final WorkforceCompanyRepository repository;

    public CompanyService(WorkforceCompanyRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<CompanyResponse> list() {
        return repository.findAllByActiveTrueOrderByNameAsc()
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public CompanyResponse get(UUID id) {
        return toResponse(repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found")));
    }

    public CompanyResponse create(CreateCompanyRequest req) {
        Company c = new Company();
        c.setName(req.name());
        c.setLegalName(req.legalName());
        c.setRegistrationNumber(req.registrationNumber());
        c.setPanNumber(req.panNumber());
        c.setGstin(req.gstin());
        c.setIndustry(req.industry());
        c.setCountry(req.country() != null ? req.country() : "India");
        c.setTimezone(req.timezone() != null ? req.timezone() : "Asia/Kolkata");
        c.setCurrency(req.currency() != null ? req.currency() : "INR");
        c.setFiscalYearStart(req.fiscalYearStart() != null ? req.fiscalYearStart() : "APRIL");
        c.setActive(true);
        try {
            return toResponse(repository.save(c));
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw new BusinessRuleException("Company with this name already exists", "DUPLICATE_COMPANY");
        }
    }

    /**
     * Patch semantics: a field is written ONLY when the caller supplied it.
     *
     * <p>2026-09-08 audit fix — this used to call setRegistrationNumber /
     * setPanNumber / setGstin / setLegalName / setIndustry unconditionally,
     * while country/timezone/currency/fiscalYearStart were already null-guarded.
     * The Edit Company drawer only sends {name, legalName, industry, currency,
     * country}, so PAN, GSTIN and the registration number arrived as null and
     * were written as null on every single edit — silently destroying the
     * statutory identifiers payroll needs for PF / ESI / TDS filings, while
     * the UI reported "Company updated".
     *
     * <p>Consequence of the guard: a field can no longer be CLEARED through
     * this endpoint. That is the correct trade-off here — the form has no
     * inputs for those three fields, so any null is "not supplied", never
     * "deliberately blanked".
     */
    public CompanyResponse update(UUID id, UpdateCompanyRequest req) {
        Company c = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found"));
        if (req.name()               != null) c.setName(req.name());
        if (req.legalName()          != null) c.setLegalName(req.legalName());
        if (req.registrationNumber() != null) c.setRegistrationNumber(req.registrationNumber());
        if (req.panNumber()          != null) c.setPanNumber(req.panNumber());
        if (req.gstin()              != null) c.setGstin(req.gstin());
        if (req.industry()           != null) c.setIndustry(req.industry());
        if (req.country()            != null) c.setCountry(req.country());
        if (req.timezone()           != null) c.setTimezone(req.timezone());
        if (req.currency()           != null) c.setCurrency(req.currency());
        if (req.fiscalYearStart()    != null) c.setFiscalYearStart(req.fiscalYearStart());
        try {
            return toResponse(repository.save(c));
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw new BusinessRuleException("Company with this name already exists", "DUPLICATE_COMPANY");
        }
    }

    public void archive(UUID id) {
        Company c = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Company " + id + " not found"));
        c.setActive(false);
        repository.save(c);
    }

    private CompanyResponse toResponse(Company c) {
        return new CompanyResponse(
                c.getId(), c.getName(), c.getLegalName(), c.getRegistrationNumber(),
                c.getPanNumber(), c.getGstin(), c.getIndustry(),
                c.getCountry(), c.getTimezone(), c.getCurrency(), c.getFiscalYearStart(),
                c.getLogoUrl(), c.getEmployeeCountCached(), c.isActive());
    }
}
