package com.hrms.tenant.mapper;

import com.hrms.tenant.dto.BranchRequest;
import com.hrms.tenant.dto.BranchResponse;
import com.hrms.tenant.entity.Branch;

public interface BranchMapper {
    Branch toEntity(BranchRequest request);
    BranchResponse toResponse(Branch branch);
    void updateEntity(BranchRequest request, Branch branch);
}

