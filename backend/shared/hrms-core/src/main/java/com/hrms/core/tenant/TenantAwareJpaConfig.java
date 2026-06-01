package com.hrms.core.tenant;

import org.hibernate.Interceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TenantAwareJpaConfig {

    @Bean
    public Interceptor tenantInterceptor() {
        // No-op; actual tenant filter activation is handled by TenantFilterAspect.
        return new Interceptor() {};
    }
}
