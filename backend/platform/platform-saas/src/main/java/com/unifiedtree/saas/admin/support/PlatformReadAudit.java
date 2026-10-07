package com.unifiedtree.saas.admin.support;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Map;
import java.util.UUID;

/**
 * Audits operator READS of workspace data: every successful GET under
 * {@code /v1/platform/admin/**} that can show a workspace's companies, people, subscriptions,
 * payments, invoices, audit trail or Marketing records becomes one {@code OPERATOR_READ} row
 * in the platform audit trail (who, which path, which workspace / company / account).
 *
 * <p>Not audited: the operator's own profile ({@code /me}), the product catalogue, billing
 * settings and the dashboard's counts, which show no workspace's data. Best effort
 * ({@link PlatformAuditTrail#record}): a failed audit write never fails the read.
 */
@Configuration
public class PlatformReadAudit implements WebMvcConfigurer, HandlerInterceptor {

    static final String BASE = "/v1/platform/admin";

    private final PlatformAuditTrail audit;

    public PlatformReadAudit(PlatformAuditTrail audit) {
        this.audit = audit;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns(BASE + "/**")
                .excludePathPatterns(BASE + "/me", BASE + "/catalog/**", BASE + "/settings/**", BASE + "/dashboard");
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
                                Exception ex) {
        if (!"GET".equals(request.getMethod()) || ex != null || response.getStatus() >= 400) return;
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return;

        @SuppressWarnings("unchecked")
        Map<String, String> vars = (Map<String, String>) request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        String entityType = null;
        UUID entityId = null;
        for (String[] candidate : new String[][] {{"companyId", "company"}, {"tenantId", "workspace"},
                {"accountId", "account"}, {"id", "record"}}) {
            UUID v = uuid(vars == null ? null : vars.get(candidate[0]));
            if (v != null) {
                entityType = candidate[1];
                entityId = v;
                break;
            }
        }
        audit.record(Operator.of(jwt), request, "OPERATOR_READ", entityType, entityId, summary(request));
    }

    static String summary(HttpServletRequest request) {
        String path = request.getRequestURI();
        String ctx = request.getContextPath();
        if (ctx != null && !ctx.isEmpty() && path.startsWith(ctx)) path = path.substring(ctx.length());
        String q = request.getQueryString();
        String s = "GET " + path + (q == null || q.isBlank() ? "" : "?" + q);
        return s.length() <= 500 ? s : s.substring(0, 500);
    }

    private static UUID uuid(String s) {
        if (s == null) return null;
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
