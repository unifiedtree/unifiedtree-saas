package com.hrms.tenant.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.tenant.dto.CompanyRequest;
import com.hrms.tenant.dto.CompanyResponse;
import com.hrms.tenant.entity.Company;
import com.hrms.tenant.mapper.CompanyMapper;
import com.hrms.tenant.repository.CompanyRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class TenantService {

    private static final Logger log = LoggerFactory.getLogger(TenantService.class);

    private final CompanyRepository companyRepository;
    private final CompanyMapper companyMapper;

    public TenantService(CompanyRepository companyRepository, CompanyMapper companyMapper) {
        this.companyRepository = companyRepository;
        this.companyMapper = companyMapper;
    }

    @Transactional
    public CompanyResponse createCompany(CompanyRequest request, UUID tenantId) {
        log.info("Creating company '{}' for tenant {}", request.name(), tenantId);

        if (request.domain() != null && !request.domain().isBlank()
                && companyRepository.existsByTenantIdAndDomain(tenantId, request.domain())) {
            throw new BusinessRuleException(
                    "A company with domain '" + request.domain() + "' already exists for this tenant");
        }

        Company company = companyMapper.toEntity(request);
        company.setTenantId(tenantId);

        if (request.currency() == null || request.currency().isBlank()) {
            company.setCurrency("INR");
        }

        Company saved = companyRepository.save(company);
        log.debug("Company created with id {}", saved.getId());
        return companyMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public CompanyResponse getCompany(UUID companyId) {
        log.debug("Fetching company {}", companyId);
        Company company = companyRepository.findById(companyId)
                .orElseThrow(() -> new ResourceNotFoundException("Company not found: " + companyId));
        return companyMapper.toResponse(company);
    }

    @Transactional
    public CompanyResponse updateCompany(UUID companyId, CompanyRequest request) {
        log.info("Updating company {}", companyId);
        Company company = companyRepository.findById(companyId)
                .orElseThrow(() -> new ResourceNotFoundException("Company not found: " + companyId));

        if (request.domain() != null && !request.domain().isBlank()
                && !request.domain().equals(company.getDomain())
                && companyRepository.existsByTenantIdAndDomain(company.getTenantId(), request.domain())) {
            throw new BusinessRuleException(
                    "A company with domain '" + request.domain() + "' already exists for this tenant");
        }

        companyMapper.updateEntity(request, company);
        Company saved = companyRepository.save(company);
        log.debug("Company {} updated", saved.getId());
        return companyMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<CompanyResponse> listCompanies(Pageable pageable) {
        log.debug("Listing companies, page {}", pageable.getPageNumber());
        Page<Company> page = companyRepository.findAll(pageable);
        return PageResponse.from(page, companyMapper::toResponse);
    }

    @Transactional
    public void deactivateCompany(UUID companyId) {
        log.info("Deactivating company {}", companyId);
        Company company = companyRepository.findById(companyId)
                .orElseThrow(() -> new ResourceNotFoundException("Company not found: " + companyId));
        company.setActive(false);
        companyRepository.save(company);
        log.debug("Company {} deactivated", companyId);
    }
}
