package com.hrms.app.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;

/**
 * Activates Spring Security method-level security so @PreAuthorize annotations
 * on controllers are enforced regardless of which profile is active.
 *
 * This is intentionally NOT @Profile-gated. @EnableMethodSecurity must be
 * loaded unconditionally — placing it on a profile-gated @Configuration class
 * causes the AOP infrastructure to miss the registration window and silently
 * no-ops all @PreAuthorize annotations.
 */
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {
}
