package com.hrms.api.saas;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class TenantModuleGuardConfig implements WebMvcConfigurer {

    private final TenantModuleGuard tenantModuleGuard;

    public TenantModuleGuardConfig(TenantModuleGuard tenantModuleGuard) {
        this.tenantModuleGuard = tenantModuleGuard;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tenantModuleGuard)
                .addPathPatterns("/v1/**")
                .excludePathPatterns("/v1/public/**", "/v1/auth/**", "/v1/platform/**");
    }
}
