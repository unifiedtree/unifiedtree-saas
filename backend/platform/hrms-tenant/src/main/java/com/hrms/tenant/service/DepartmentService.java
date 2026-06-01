package com.hrms.tenant.service;

import com.hrms.core.dto.PageResponse;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.tenant.dto.DepartmentRequest;
import com.hrms.tenant.dto.DepartmentResponse;
import com.hrms.tenant.entity.Department;
import com.hrms.tenant.mapper.DepartmentMapper;
import com.hrms.tenant.repository.DepartmentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
public class DepartmentService {

    private static final Logger log = LoggerFactory.getLogger(DepartmentService.class);

    private final DepartmentRepository departmentRepository;
    private final DepartmentMapper departmentMapper;

    public DepartmentService(DepartmentRepository departmentRepository, DepartmentMapper departmentMapper) {
        this.departmentRepository = departmentRepository;
        this.departmentMapper = departmentMapper;
    }

    @Transactional
    public DepartmentResponse createDepartment(DepartmentRequest request) {
        log.info("Creating department '{}' for company {}", request.name(), request.companyId());

        if (request.parentDepartmentId() != null) {
            departmentRepository.findById(request.parentDepartmentId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Parent department not found: " + request.parentDepartmentId()));
        }

        Department department = departmentMapper.toEntity(request);
        Department saved = departmentRepository.save(department);
        log.debug("Department created with id {}", saved.getId());
        return departmentMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public DepartmentResponse getDepartment(UUID departmentId) {
        log.debug("Fetching department {}", departmentId);
        Department department = departmentRepository.findById(departmentId)
                .orElseThrow(() -> new ResourceNotFoundException("Department not found: " + departmentId));
        return departmentMapper.toResponse(department);
    }

    @Transactional
    public DepartmentResponse updateDepartment(UUID departmentId, DepartmentRequest request) {
        log.info("Updating department {}", departmentId);
        Department department = departmentRepository.findById(departmentId)
                .orElseThrow(() -> new ResourceNotFoundException("Department not found: " + departmentId));

        if (request.parentDepartmentId() != null) {
            if (request.parentDepartmentId().equals(departmentId)) {
                throw new BusinessRuleException("A department cannot be its own parent");
            }
            departmentRepository.findById(request.parentDepartmentId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Parent department not found: " + request.parentDepartmentId()));
        }

        departmentMapper.updateEntity(request, department);
        Department saved = departmentRepository.save(department);
        log.debug("Department {} updated", saved.getId());
        return departmentMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<DepartmentResponse> listByCompany(UUID companyId, Pageable pageable) {
        log.debug("Listing departments for company {}", companyId);
        Page<Department> page = departmentRepository.findByCompanyId(companyId, pageable);
        return PageResponse.from(page, departmentMapper::toResponse);
    }

    @Transactional(readOnly = true)
    public List<DepartmentResponse> getDepartmentTree(UUID companyId) {
        log.debug("Building department tree for company {}", companyId);
        List<Department> all = departmentRepository.findByCompanyId(companyId);
        return all.stream()
                .sorted(Comparator.comparing(
                        d -> d.getParentDepartmentId() == null ? "" : d.getParentDepartmentId().toString()))
                .map(departmentMapper::toResponse)
                .toList();
    }

    @Transactional
    public void assignDepartmentHead(UUID departmentId, UUID employeeId) {
        log.info("Assigning employee {} as head of department {}", employeeId, departmentId);
        Department department = departmentRepository.findById(departmentId)
                .orElseThrow(() -> new ResourceNotFoundException("Department not found: " + departmentId));
        department.setHeadEmployeeId(employeeId);
        departmentRepository.save(department);
        log.debug("Department {} head assigned to employee {}", departmentId, employeeId);
    }
}
