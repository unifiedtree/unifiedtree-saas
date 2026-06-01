package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.ContractorResponse;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateContractorRequest;
import com.hrms.employee.workforce.entity.Contractor;
import com.hrms.employee.workforce.repository.ContractorRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class ContractorService {

    private final ContractorRepository repository;

    public ContractorService(ContractorRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<ContractorResponse> listForCompany(UUID companyId) {
        return repository.findAllByCompanyIdAndActiveTrueOrderByAgencyNameAsc(companyId)
                .stream().map(this::toResponse).toList();
    }

    public ContractorResponse create(CreateContractorRequest req) {
        if (repository.existsByCompanyIdAndAgencyNameIgnoreCase(req.companyId(), req.agencyName())) {
            throw new BusinessRuleException("Contractor '" + req.agencyName() + "' already exists", "DUPLICATE_CONTRACTOR");
        }
        Contractor c = new Contractor();
        c.setCompanyId(req.companyId());
        c.setAgencyName(req.agencyName());
        c.setRegistrationNumber(req.registrationNumber());
        c.setGstin(req.gstin());
        c.setContactPersonName(req.contactPersonName());
        c.setContactEmail(req.contactEmail());
        c.setContactPhone(req.contactPhone());
        c.setAddressLine(req.addressLine());
        c.setCity(req.city());
        c.setState(req.state());
        c.setActive(true);
        return toResponse(repository.save(c));
    }

    public void archive(UUID id) {
        Contractor c = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Contractor " + id + " not found"));
        c.setActive(false);
        repository.save(c);
    }

    private ContractorResponse toResponse(Contractor c) {
        return new ContractorResponse(
                c.getId(), c.getCompanyId(), c.getAgencyName(),
                c.getRegistrationNumber(), c.getGstin(),
                c.getContactPersonName(), c.getContactEmail(), c.getContactPhone(),
                c.getCity(), c.getActiveWorkersCount(), c.isActive());
    }
}
