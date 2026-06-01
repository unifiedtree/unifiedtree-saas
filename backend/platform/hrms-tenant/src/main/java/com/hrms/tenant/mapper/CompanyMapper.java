package com.hrms.tenant.mapper;

import com.hrms.tenant.dto.CompanyRequest;
import com.hrms.tenant.dto.CompanyResponse;
import com.hrms.tenant.entity.Company;

public interface CompanyMapper {
    Company toEntity(CompanyRequest request);
    CompanyResponse toResponse(Company company);
    void updateEntity(CompanyRequest request, Company company);
}

