package com.hrms.api.saas;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Map;
import java.util.UUID;

@Component
public class TenantModuleGuard implements HandlerInterceptor {

    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");
    private static final Map<String, String> MODULE_PATHS = Map.of(
            "/v1/employees", "hrms",
            "/v1/tenant", "hrms",
            "/v1/attendance", "attendance",
            "/v1/leave", "leave"
    );

    private final SaasPlatformService saasPlatformService;

    public TenantModuleGuard(SaasPlatformService saasPlatformService) {
        this.saasPlatformService = saasPlatformService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String path = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isBlank() && path.startsWith(contextPath)) {
            path = path.substring(contextPath.length());
        }

        String moduleKey = moduleForPath(path);
        if (moduleKey == null) {
            return true;
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) {
            return true;
        }

        String tenantClaim = jwt.getClaimAsString("tenant_id");
        if (tenantClaim == null || tenantClaim.isBlank()) {
            return true;
        }

        UUID tenantId = UUID.fromString(tenantClaim);
        if (PLATFORM_TENANT_ID.equals(tenantId)) {
            return true;
        }

        if (!saasPlatformService.hasActiveModule(tenantId, moduleKey)) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "This module is waiting for UnifiedTree administrator approval.");
        }
        return true;
    }

    private String moduleForPath(String path) {
        for (Map.Entry<String, String> entry : MODULE_PATHS.entrySet()) {
            if (path.startsWith(entry.getKey())) {
                return entry.getValue();
            }
        }
        return null;
    }
}
