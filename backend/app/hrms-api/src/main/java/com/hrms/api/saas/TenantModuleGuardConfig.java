package com.hrms.api.saas;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class TenantModuleGuardConfig implements WebMvcConfigurer {

    private final TenantModuleGuard tenantModuleGuard;
    private final SubscriptionAccessGuard subscriptionAccessGuard;

    public TenantModuleGuardConfig(TenantModuleGuard tenantModuleGuard,
                                   SubscriptionAccessGuard subscriptionAccessGuard) {
        this.tenantModuleGuard = tenantModuleGuard;
        this.subscriptionAccessGuard = subscriptionAccessGuard;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Order matters: subscription guard runs FIRST so a lapsed tenant
        // gets a clean 402 without wasting a module-lookup on a workspace
        // they're not allowed into anyway.
        registry.addInterceptor(subscriptionAccessGuard)
                .addPathPatterns("/v1/**")
                .excludePathPatterns("/v1/public/**", "/v1/auth/**", "/v1/canonical-auth/**",
                                     "/v1/webhooks/**", "/v1/platform/**", "/v1/accounts/**",
                                     "/v1/billing/**", "/v1/subscription/**",
                                     "/v1/workspace/context");

        registry.addInterceptor(tenantModuleGuard)
                .addPathPatterns("/v1/**")
                .excludePathPatterns("/v1/public/**", "/v1/auth/**", "/v1/platform/**");
    }
}
