package com.hrms.api.saasguard;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers the paywall interceptors. Kept in a dedicated package
 * ({@code com.hrms.api.saasguard}) so it can be added to
 * {@code CanonicalProfileScan} without dragging in the legacy
 * {@code com.hrms.api.saas} beans and their chain of dead dependencies
 * (JwtTokenProvider, MailService, PasswordEncoder…).
 */
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
        // Subscription guard first — a lapsed tenant should never reach the
        // module-lookup query for a workspace they cannot enter anyway.
        registry.addInterceptor(subscriptionAccessGuard)
                .addPathPatterns("/v1/**")
                .excludePathPatterns("/v1/public/**", "/v1/auth/**", "/v1/canonical-auth/**",
                                     "/v1/webhooks/**", "/v1/platform/**", "/v1/accounts/**",
                                     "/v1/billing/**", "/v1/subscription/**",
                                     "/v1/workspace/context", "/v1/workspace/plan/**");

        registry.addInterceptor(tenantModuleGuard)
                .addPathPatterns("/v1/**")
                .excludePathPatterns("/v1/public/**", "/v1/auth/**", "/v1/canonical-auth/**",
                                     "/v1/platform/**", "/v1/workspace/**");
    }
}
