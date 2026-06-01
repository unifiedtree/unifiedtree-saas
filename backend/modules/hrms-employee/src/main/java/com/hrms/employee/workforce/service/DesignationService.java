package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDesignationRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DesignationResponse;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.repository.DesignationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class DesignationService {

    private final DesignationRepository repository;

    public DesignationService(DesignationRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<DesignationResponse> listForCompany(UUID companyId, UUID departmentFilter) {
        var rows = departmentFilter == null
                ? repository.findAllByCompanyIdAndActiveTrueOrderByTitleAsc(companyId)
                : repository.findAllByCompanyIdAndDepartmentIdAndActiveTrueOrderByTitleAsc(companyId, departmentFilter);
        return rows.stream().map(this::toResponse).toList();
    }

    public DesignationResponse create(CreateDesignationRequest req) {
        if (repository.existsByCompanyIdAndTitleIgnoreCase(req.companyId(), req.title())) {
            throw new BusinessRuleException("Designation '" + req.title() + "' already exists", "DUPLICATE_DESIGNATION");
        }
        Designation d = new Designation();
        d.setCompanyId(req.companyId());
        d.setTitle(req.title());
        d.setGrade(req.grade());
        d.setDepartmentId(req.departmentId());
        d.setReportsToDesignationId(req.reportsToDesignationId());
        d.setJobResponsibilities(req.jobResponsibilities());
        d.setActive(true);
        return toResponse(repository.save(d));
    }

    public void archive(UUID id) {
        Designation d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Designation " + id + " not found"));
        d.setActive(false);
        repository.save(d);
    }

    private DesignationResponse toResponse(Designation d) {
        return new DesignationResponse(
                d.getId(), d.getCompanyId(), d.getTitle(), d.getGrade(),
                d.getDepartmentId(), d.getReportsToDesignationId(),
                d.getJobResponsibilities(), d.getHeadcountCached(), d.isActive());
    }
}
