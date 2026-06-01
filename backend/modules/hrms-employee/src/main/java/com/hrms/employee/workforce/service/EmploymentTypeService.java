package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.hrms.employee.workforce.entity.EmploymentType;
import com.hrms.employee.workforce.repository.EmploymentTypeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class EmploymentTypeService {

    private final EmploymentTypeRepository repo;

    public EmploymentTypeService(EmploymentTypeRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<EmploymentType> listForCompany(UUID companyId) {
        return repo.findByCompanyIdAndActiveTrueOrderByNameAsc(companyId);
    }

    @Transactional
    public EmploymentType create(EmploymentType type) {
        if (repo.existsByCompanyIdAndCode(type.getCompanyId(), type.getCode())) {
            throw new BusinessRuleException("Employment type code already exists: " + type.getCode());
        }
        type.setTenantId(TenantContext.getTenantId());
        return repo.save(type);
    }

    @Transactional
    public EmploymentType update(UUID id, EmploymentType update) {
        EmploymentType existing = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("EmploymentType", id));
        existing.setName(update.getName());
        existing.setActive(update.isActive());
        return repo.save(existing);
    }

    @Transactional
    public void archive(UUID id) {
        EmploymentType type = repo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("EmploymentType", id));
        type.setActive(false);
        repo.save(type);
    }
}
