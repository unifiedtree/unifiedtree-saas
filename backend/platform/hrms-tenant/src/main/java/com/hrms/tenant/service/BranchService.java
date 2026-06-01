package com.hrms.tenant.service;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.tenant.dto.BranchRequest;
import com.hrms.tenant.dto.BranchResponse;
import com.hrms.tenant.entity.Branch;
import com.hrms.tenant.mapper.BranchMapper;
import com.hrms.tenant.repository.BranchRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class BranchService {

    private static final Logger log = LoggerFactory.getLogger(BranchService.class);

    private final BranchRepository branchRepository;
    private final BranchMapper branchMapper;

    public BranchService(BranchRepository branchRepository, BranchMapper branchMapper) {
        this.branchRepository = branchRepository;
        this.branchMapper = branchMapper;
    }

    @Transactional
    public BranchResponse createBranch(BranchRequest request) {
        log.info("Creating branch '{}' for company {}", request.name(), request.companyId());
        Branch branch = branchMapper.toEntity(request);
        Branch saved = branchRepository.save(branch);
        log.debug("Branch created with id {}", saved.getId());
        return branchMapper.toResponse(saved);
    }

    @Transactional(readOnly = true)
    public BranchResponse getBranch(UUID branchId) {
        log.debug("Fetching branch {}", branchId);
        Branch branch = branchRepository.findById(branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Branch not found: " + branchId));
        return branchMapper.toResponse(branch);
    }

    @Transactional(readOnly = true)
    public List<BranchResponse> listByCompany(UUID companyId) {
        log.debug("Listing branches for company {}", companyId);
        return branchRepository.findByCompanyId(companyId)
                .stream()
                .map(branchMapper::toResponse)
                .toList();
    }

    @Transactional
    public BranchResponse updateBranch(UUID branchId, BranchRequest request) {
        log.info("Updating branch {}", branchId);
        Branch branch = branchRepository.findById(branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Branch not found: " + branchId));
        branchMapper.updateEntity(request, branch);
        Branch saved = branchRepository.save(branch);
        log.debug("Branch {} updated", saved.getId());
        return branchMapper.toResponse(saved);
    }
}
