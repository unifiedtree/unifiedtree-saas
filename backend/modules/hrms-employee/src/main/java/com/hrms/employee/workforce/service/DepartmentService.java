package com.hrms.employee.workforce.service;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.employee.workforce.dto.WorkforceDtos.CreateDepartmentRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.DepartmentResponse;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service("workforceDepartmentService")
@Transactional
public class DepartmentService {

    private final WorkforceDepartmentRepository repository;

    public DepartmentService(WorkforceDepartmentRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<DepartmentResponse> listForCompany(UUID companyId) {
        return repository.findAllByCompanyIdAndActiveTrueOrderByNameAsc(companyId)
                .stream().map(this::toResponse).toList();
    }

    public DepartmentResponse create(CreateDepartmentRequest req) {
        if (repository.existsByCompanyIdAndNameIgnoreCase(req.companyId(), req.name())) {
            throw new BusinessRuleException("Department '" + req.name() + "' already exists", "DUPLICATE_DEPARTMENT");
        }
        Department d = new Department();
        d.setCompanyId(req.companyId());
        d.setName(req.name());
        d.setCode(req.code());
        d.setParentDepartmentId(req.parentDepartmentId());
        d.setDepartmentHeadEmployeeId(req.departmentHeadEmployeeId());
        d.setDescription(req.description());
        d.setActive(true);
        return toResponse(repository.save(d));
    }

    public DepartmentResponse rename(UUID id, String newName) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        if (!d.getName().equalsIgnoreCase(newName)
                && repository.existsByCompanyIdAndNameIgnoreCase(d.getCompanyId(), newName)) {
            throw new BusinessRuleException("Department '" + newName + "' already exists", "DUPLICATE_DEPARTMENT");
        }
        d.setName(newName);
        return toResponse(repository.save(d));
    }

    public DepartmentResponse setHead(UUID id, UUID employeeId) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        d.setDepartmentHeadEmployeeId(employeeId);   // null clears the head
        return toResponse(repository.save(d));
    }

    public void archive(UUID id) {
        Department d = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Department " + id + " not found"));
        d.setActive(false);
        repository.save(d);
    }

    private DepartmentResponse toResponse(Department d) {
        return new DepartmentResponse(
                d.getId(), d.getCompanyId(), d.getName(), d.getCode(),
                d.getParentDepartmentId(), d.getDepartmentHeadEmployeeId(),
                d.getDescription(), d.getEmployeeCountCached(), d.isActive());
    }
}
