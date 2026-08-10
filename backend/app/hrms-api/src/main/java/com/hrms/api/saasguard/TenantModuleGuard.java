package com.hrms.api.saasguard;

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

/**
 * Blocks calls to a module the tenant has not provisioned.
 *
 * <p>Verified live 2026-08-10: without this guard, a tenant whose
 * {@code tenant_modules} lists only [attendance,hrms,leave] could still call
 * {@code /v1/payroll/*} endpoints and receive real data.
 *
 * <p>Deliberately narrow — only 4 URL prefixes gated today. Anything else
 * falls through untouched, so this cannot lock a workspace out of features it
 * has always been able to reach. Extend {@link #MODULE_PATHS} as new gated
 * modules ship.
 */
@Component
public class TenantModuleGuard implements HandlerInterceptor {

    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");
    /**
     * URL prefix -> required module key.
     * <p>Kept exhaustive per the platform.module_plans catalogue: adding a new
     * module means adding its prefix here or the guard silently ignores it —
     * exactly the leak that let demo-hrms call /v1/payroll before this fix.
     */
    private static final Map<String, String> MODULE_PATHS = Map.ofEntries(
            // HRMS core — people + org shape
            Map.entry("/v1/employees",   "hrms"),
            Map.entry("/v1/hrms",        "hrms"),
            Map.entry("/v1/tenant",      "hrms"),
            Map.entry("/v1/expense",     "hrms"),
            Map.entry("/v1/advance",     "hrms"),
            Map.entry("/v1/fnf",         "hrms"),
            Map.entry("/v1/hiring",      "hrms"),
            Map.entry("/v1/performance", "hrms"),
            Map.entry("/v1/learning",    "hrms"),
            Map.entry("/v1/pli",         "hrms"),
            Map.entry("/v1/compliance",  "hrms"),
            Map.entry("/v1/onboarding",  "hrms"),
            Map.entry("/v1/letters",     "hrms"),
            Map.entry("/v1/document",    "hrms"),
            Map.entry("/v1/notiftemplate","hrms"),
            Map.entry("/v1/integration", "hrms"),
            Map.entry("/v1/probation",   "hrms"),
            // Attendance module
            Map.entry("/v1/attendance",  "attendance"),
            Map.entry("/v1/wfh",         "attendance"),
            Map.entry("/v1/shifts",      "attendance"),
            // Leave module
            Map.entry("/v1/leave",       "leave"),
            // Payroll module
            Map.entry("/v1/payroll",     "payroll")
    );

    private final TenantModuleLookup lookup;

    public TenantModuleGuard(TenantModuleLookup lookup) {
        this.lookup = lookup;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String path = normalizedPath(request);

        String moduleKey = moduleForPath(path);
        if (moduleKey == null) return true;

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return true;

        String tenantClaim = jwt.getClaimAsString("tenant_id");
        if (tenantClaim == null || tenantClaim.isBlank()) return true;

        UUID tenantId;
        try { tenantId = UUID.fromString(tenantClaim); }
        catch (IllegalArgumentException e) { return true; }
        if (PLATFORM_TENANT_ID.equals(tenantId)) return true;

        if (!lookup.hasActiveModule(tenantId, moduleKey)) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "This workspace has not provisioned the '" + moduleKey + "' module.");
        }
        return true;
    }

    private static String normalizedPath(HttpServletRequest request) {
        String p = request.getRequestURI();
        String ctx = request.getContextPath();
        if (ctx != null && !ctx.isBlank() && p != null && p.startsWith(ctx)) p = p.substring(ctx.length());
        return p == null ? "" : p;
    }

    private String moduleForPath(String path) {
        for (Map.Entry<String, String> e : MODULE_PATHS.entrySet()) {
            if (path.equals(e.getKey()) || path.startsWith(e.getKey() + "/")) return e.getValue();
        }
        return null;
    }
}
