package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CompanyResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateCompanyRequest;
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
