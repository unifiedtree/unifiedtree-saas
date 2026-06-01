package com.hrms.tenant.mapper;

import com.hrms.tenant.dto.CompanyRequest;
import com.hrms.tenant.dto.CompanyResponse;
import com.hrms.tenant.entity.Company;
import com.hrms.tenant.enums.SubscriptionTier;
import java.time.Instant;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:47:24+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class CompanyMapperImpl implements CompanyMapper {

    @Override
    public Company toEntity(CompanyRequest request) {
        if ( request == null ) {
            return null;
        }

        Company company = new Company();

        company.setName( request.name() );
        company.setDomain( request.domain() );
        company.setSubscriptionTier( request.subscriptionTier() );
        company.setMaxEmployees( request.maxEmployees() );
        company.setIndustry( request.industry() );
        company.setCountry( request.country() );
        company.setTimezone( request.timezone() );
        company.setCurrency( request.currency() );

        company.setActive( true );

        return company;
    }

    @Override
    public CompanyResponse toResponse(Company company) {
        if ( company == null ) {
            return null;
        }

        boolean isActive = false;
        UUID id = null;
        UUID tenantId = null;
        String name = null;
        String domain = null;
        String industry = null;
        String country = null;
        String timezone = null;
        String currency = null;
        SubscriptionTier subscriptionTier = null;
        int maxEmployees = 0;
        Instant createdAt = null;

        isActive = company.isActive();
        id = company.getId();
        tenantId = company.getTenantId();
        name = company.getName();
        domain = company.getDomain();
        industry = company.getIndustry();
        country = company.getCountry();
        timezone = company.getTimezone();
        currency = company.getCurrency();
        subscriptionTier = company.getSubscriptionTier();
        maxEmployees = company.getMaxEmployees();
        createdAt = company.getCreatedAt();

        CompanyResponse companyResponse = new CompanyResponse( id, tenantId, name, domain, industry, country, timezone, currency, subscriptionTier, maxEmployees, isActive, createdAt );

        return companyResponse;
    }

    @Override
    public void updateEntity(CompanyRequest request, Company company) {
        if ( request == null ) {
            return;
        }

        company.setName( request.name() );
        company.setDomain( request.domain() );
        company.setSubscriptionTier( request.subscriptionTier() );
        company.setMaxEmployees( request.maxEmployees() );
        company.setIndustry( request.industry() );
        company.setCountry( request.country() );
        company.setTimezone( request.timezone() );
        company.setCurrency( request.currency() );
    }
}
