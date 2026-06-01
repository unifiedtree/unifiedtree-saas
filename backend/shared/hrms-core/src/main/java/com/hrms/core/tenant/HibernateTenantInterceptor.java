package com.hrms.core.tenant;

import org.hibernate.Session;
import org.springframework.stereotype.Component;

import jakarta.persistence.EntityManager;

@Component
public class HibernateTenantInterceptor {

    private final EntityManager entityManager;

    public HibernateTenantInterceptor(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public void applyFilter() {
        var tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw new IllegalStateException(
                    "No tenant in context — request is unauthenticated or filter chain is misconfigured");
        }
        entityManager.unwrap(Session.class)
                .enableFilter("tenantFilter")
                .setParameter("tenantId", tenantId);
    }
}
