package com.hrms.app.config;

import com.unifiedtree.auth.service.JwtService;
import com.unifiedtree.security.web.TenantContextFilter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import javax.crypto.SecretKey;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * Production-grade security for the canonical profile combination.
 *
 * <p>Activate via {@code SPRING_PROFILES_ACTIVE=canonical,canonical-prod}.
 *
 * <p>Tenant identity is read ONLY from the signed JWT claim
 * {@code tenant_id}. The smoke {@link CanonicalSecurityConfig} (which
 * accepts an unsigned {@code X-Tenant-ID} header) refuses to load when
 * this profile is active, both via {@code @Profile} expression and via
 * its {@code @PostConstruct} guard.
 *
 * <p>Authorities exposed to {@code @PreAuthorize}:
 * <ul>
 *   <li>{@code ROLE_<code>} -- one per role claim, prefixed by Spring convention</li>
 *   <li>{@code <perm-code>} -- one per permission claim, used by
 *       {@code @PreAuthorize("hasAuthority('hrms.employee.write')")}</li>
 * </ul>
 */
@Configuration
@Profile("canonical-prod")
public class CanonicalProdSecurityConfig {

    private static final Logger log = LoggerFactory.getLogger(CanonicalProdSecurityConfig.class);

    private final TenantContextFilter tenantContextFilter;
    private final JwtService jwtService;

    /**
     * Comma-separated whitelist of allowed CORS origins. Configured via
     * {@code unifiedtree.cors.allowed-origins} (env
     * {@code UNIFIEDTREE_ALLOWED_ORIGINS}). Production deploys MUST set this
     * explicitly to the public URL of each fixed frontend.
     */
    private final String allowedOriginsRaw;

    /**
     * Controlled wildcard origin patterns for tenant subdomains, e.g.
     * {@code https://*.unifiedtree.com} and local dev
     * {@code http://*.localhost:3001}. A bare "*" is still refused.
     */
    private final String allowedOriginPatternsRaw;

    /**
     * Whether credentialed CORS requests (cookies, Authorization header
     * mirroring) are allowed. JWT in {@code Authorization: Bearer ...} does
     * NOT require credentials=true -- the browser is happy sending Bearer
     * headers cross-origin without it. Keep this false unless a future
     * cookie-session flow needs it.
     */
    private final boolean allowCredentials;

    public CanonicalProdSecurityConfig(TenantContextFilter tenantContextFilter,
                                       JwtService jwtService,
                                       @Value("${unifiedtree.cors.allowed-origins:}") String allowedOriginsRaw,
                                       @Value("${unifiedtree.cors.allowed-origin-patterns:}") String allowedOriginPatternsRaw,
                                       @Value("${unifiedtree.cors.allow-credentials:false}") boolean allowCredentials) {
        this.tenantContextFilter = tenantContextFilter;
        this.jwtService = jwtService;
        this.allowedOriginsRaw = allowedOriginsRaw;
        this.allowedOriginPatternsRaw = allowedOriginPatternsRaw;
        this.allowCredentials = allowCredentials;
    }

    @Bean
    public SecurityFilterChain canonicalProdFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Public surface. /refresh is intentionally NOT here yet --
                // the endpoint is not yet wired and listing it as permitAll
                // would create a phantom unauthenticated path. It will be
                // added when refresh is shipped.
                .requestMatchers(
                    "/actuator/health",
                    "/actuator/info",
                    "/v1/canonical-auth/login",
                    // SaaS portal: customer signup + workspace lookup (com.unifiedtree.saas)
                    "/v1/public/signup-request",
                    "/v1/public/subdomains/check",
                    "/v1/public/workspace-status",
                    "/v1/accounts/auth/login",
                    "/v1/platform/auth/login"
                ).permitAll()
                // Everything else requires a valid JWT
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth -> oauth
                .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter()))
            )
            // TenantContextFilter must run AFTER BearerTokenAuthenticationFilter
            // so SecurityContext has the parsed JWT principal by the time the
            // tenant filter reads its tenant_id claim. Anchoring with the
            // BearerTokenAuthenticationFilter class explicitly is the only
            // reliable way to guarantee that order in the Spring Security
            // chain.
            .addFilterAfter(tenantContextFilter, BearerTokenAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public JwtDecoder jwtDecoder() {
        SecretKey key = jwtService.signingKey();
        // Spring's NimbusJwtDecoder wants a javax.crypto.SecretKey directly.
        return NimbusJwtDecoder.withSecretKey(key).build();
    }

    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtAuthenticationConverter conv = new JwtAuthenticationConverter();
        conv.setJwtGrantedAuthoritiesConverter(jwt -> {
            List<GrantedAuthority> authorities = new ArrayList<>();
            // Roles -> ROLE_<code> so hasRole('SUPER_ADMIN') works
            Object roles = jwt.getClaim("roles");
            if (roles instanceof List<?> roleList) {
                for (Object r : roleList) {
                    if (r != null) authorities.add(new SimpleGrantedAuthority("ROLE_" + r));
                }
            }
            // Permissions -> raw authority so hasAuthority('hrms.employee.write') works
            Object perms = jwt.getClaim("permissions");
            if (perms instanceof List<?> permList) {
                for (Object p : permList) {
                    if (p != null) authorities.add(new SimpleGrantedAuthority(p.toString()));
                }
            }
            return authorities;
        });
        // The Authentication.getName() will be the JWT 'sub' (= user UUID)
        conv.setPrincipalClaimName("sub");
        return conv;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        List<String> origins = parseOrigins(allowedOriginsRaw);
        List<String> originPatterns = parseOrigins(allowedOriginPatternsRaw);

        if (origins.isEmpty() && originPatterns.isEmpty()) {
            log.warn("================================================================");
            log.warn(" UNIFIEDTREE_ALLOWED_ORIGINS and patterns are empty.             ");
            log.warn(" Every cross-origin request will be rejected (fail-safe).        ");
            log.warn(" Set the env var to a comma-separated origin list before going   ");
            log.warn(" live, e.g.:                                                     ");
            log.warn("   UNIFIEDTREE_ALLOWED_ORIGINS=https://app.unifiedtree.com       ");
            log.warn("   UNIFIEDTREE_ALLOWED_ORIGIN_PATTERNS=https://*.unifiedtree.com ");
            log.warn("================================================================");
        } else {
            log.info("CORS allowed origins: {}", origins);
            log.info("CORS allowed origin patterns: {}", originPatterns);
        }
        if (allowCredentials) {
            log.warn("CORS allowCredentials=TRUE. Make sure this is needed -- JWT in "
                + "Authorization headers does not require it.");
        }

        CorsConfiguration cfg = new CorsConfiguration();
        // Empty list -> Spring's CorsConfiguration treats absence of allowed
        // origins as "deny" for cross-origin requests, which is the
        // intended fail-safe.
        if (!origins.isEmpty()) {
            // Plain origin equality (no wildcards in production).
            cfg.setAllowedOrigins(origins);
        }
        if (!originPatterns.isEmpty()) {
            cfg.setAllowedOriginPatterns(originPatterns);
        }
        cfg.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
        // Explicit short list of headers we actually accept. No "*".
        cfg.setAllowedHeaders(List.of(
            "Authorization",
            "Content-Type",
            "Accept",
            "ngrok-skip-browser-warning",
            "X-Request-Id",
            "X-Tenant-ID",
            "X-Tenant-Subdomain"));
        cfg.setExposedHeaders(List.of("Location", "X-Request-Id"));
        cfg.setAllowCredentials(allowCredentials);
        cfg.setMaxAge(600L);  // 10-minute preflight cache

        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }

    private static List<String> parseOrigins(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Stream.of(csv.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .filter(s -> !isUnsafeWildcard(s))
            .toList();
    }

    private static boolean isUnsafeWildcard(String value) {
        String s = value.trim();
        return s.equals("*") || s.equals("http://*") || s.equals("https://*");
    }
}
