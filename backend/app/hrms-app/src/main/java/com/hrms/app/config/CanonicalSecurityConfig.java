package com.hrms.app.config;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.security.web.TenantContextFilter;
import jakarta.annotation.PostConstruct;
import org.springframework.core.env.Environment;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !!  NOT FOR PRODUCTION                                                    !!
 * !!                                                                        !!
 * !!  This security configuration:                                          !!
 * !!    - permits ALL requests (anyRequest().permitAll())                   !!
 * !!    - resolves tenant identity from the X-Tenant-ID HTTP header         !!
 * !!      with no authentication                                            !!
 * !!                                                                        !!
 * !!  ANY caller can set X-Tenant-ID to any UUID and become that tenant.    !!
 * !!  This is acceptable ONLY for local runtime smoke tests where the       !!
 * !!  server is bound to localhost and no untrusted client can reach it.    !!
 * !!                                                                        !!
 * !!  This class is hard-guarded against loading if SPRING_PROFILES_ACTIVE  !!
 * !!  contains "prod" or "production" -- if you see startup fail because    !!
 * !!  of this class, GOOD: build the real auth/RBAC layer first.            !!
 * !!                                                                        !!
 * !!  Production replacement: a JWT-based filter chain that reads tenant    !!
 * !!  identity ONLY from a signed JWT claim, with @PreAuthorize role        !!
 * !!  enforcement. Tracked under Phase 1 in FEATURE_GAP_MATRIX.md.          !!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * <p>Local smoke-test setup:
 * <ul>
 *   <li>every request permitted, no auth required</li>
 *   <li>{@link TenantContextFilter} runs before the auth filter and seeds
 *       {@link com.unifiedtree.security.tenant.TenantContext} from
 *       {@code X-Tenant-ID}</li>
 *   <li>{@code SET LOCAL app.tenant_id} then runs on the leased Postgres
 *       connection, giving RLS the tenant scope</li>
 * </ul>
 */
@Configuration
@Profile("canonical & !canonical-prod")
public class CanonicalSecurityConfig {

    private static final Logger log = LoggerFactory.getLogger(CanonicalSecurityConfig.class);

    private final TenantContextFilter tenantContextFilter;
    private final JwtService jwtService;
    private final Environment env;

    public CanonicalSecurityConfig(TenantContextFilter tenantContextFilter,
                                   JwtService jwtService,
                                   Environment env) {
        this.tenantContextFilter = tenantContextFilter;
        this.jwtService = jwtService;
        this.env = env;
    }

    /**
     * Hard guard: refuse to load if a production-ish profile is active. The
     * canonical profile is dev-only by definition; if someone tries to layer
     * it under prod, fail fast at boot instead of silently exposing the
     * tenant-header bypass.
     */
    @PostConstruct
    void refuseProductionProfile() {
        List<String> active = Arrays.asList(env.getActiveProfiles());
        boolean prodIsh = active.stream().anyMatch(p -> {
            String lower = p.toLowerCase();
            return lower.contains("prod")    // catches prod, production, canonical-prod, prod-eu
                || lower.contains("staging")
                || lower.contains("uat");
        });
        if (prodIsh) {
            throw new IllegalStateException(
                "CanonicalSecurityConfig is NOT FOR PRODUCTION. Active profiles include "
                + active + " which look production-ish. Disable the 'canonical' profile "
                + "and use the production security config instead. "
                + "See FEATURE_GAP_MATRIX.md Phase 1 for the canonical auth/RBAC plan.");
        }
        log.warn("================================================================");
        log.warn(" CanonicalSecurityConfig active -- LOCAL SMOKE TEST MODE ONLY    ");
        log.warn(" Every request permitted; X-Tenant-ID header accepted unsigned. ");
        log.warn(" Do not expose this server beyond localhost.                    ");
        log.warn("================================================================");
    }

    @Bean
    public SecurityFilterChain canonicalFilterChain(HttpSecurity http) throws Exception {
        // Parse Bearer JWT into SecurityContext so @AuthenticationPrincipal Jwt works.
        // DevJwtBearerFilter is lenient: invalid/absent tokens are ignored, request proceeds anyway.
        // TenantContextFilter runs after so it can read tenant_id from the parsed JWT principal.
        DevJwtBearerFilter devJwtFilter = new DevJwtBearerFilter(
                NimbusJwtDecoder.withSecretKey(jwtService.signingKey()).build());
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
            .addFilterBefore(devJwtFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(tenantContextFilter, DevJwtBearerFilter.class);
        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOriginPatterns(List.of("*"));
        cfg.setAllowedMethods(List.of("*"));
        cfg.setAllowedHeaders(List.of("*"));
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }
}
