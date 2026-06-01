package com.hrms.core.tenant;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.aspectj.lang.reflect.MethodSignature;
import org.hibernate.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.util.UUID;

@Aspect
@Component
public class TenantFilterAspect {

    private static final Logger log = LoggerFactory.getLogger(TenantFilterAspect.class);

    @PersistenceContext
    private EntityManager entityManager;

    @Before("@annotation(org.springframework.transaction.annotation.Transactional)")
    public void enableTenantFilter(JoinPoint jp) {
        Method method = ((MethodSignature) jp.getSignature()).getMethod();

        // @CrossTenant on method or class → explicitly bypass the filter (SUPER_ADMIN operations)
        if (method.isAnnotationPresent(CrossTenant.class)
                || jp.getTarget().getClass().isAnnotationPresent(CrossTenant.class)) {
            log.debug("@CrossTenant bypass — filter skipped for {}", method.getName());
            return;
        }

        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            // System-level operations (batch jobs, Kafka consumers) run without a tenant.
            // They are responsible for setting TenantContext themselves if needed.
            log.trace("No tenant in context for {} — skipping filter activation", method.getName());
            return;
        }

        Session session = entityManager.unwrap(Session.class);
        if (session.getEnabledFilter("tenantFilter") == null) {
            session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
        }
    }
}
