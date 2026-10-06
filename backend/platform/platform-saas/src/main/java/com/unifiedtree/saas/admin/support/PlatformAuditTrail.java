package com.unifiedtree.saas.admin.support;

import com.unifiedtree.audit.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Writes an operator's change to the platform's audit trail ({@code audit.events}
 * rows of the platform tenant, which an operator request is bound to).
 *
 * <p>Best effort, like every audit write here: {@link AuditService} logs a failure
 * rather than failing the change. The authoritative record of each change is on
 * the changed row itself ({@code granted_by}, {@code created_by}, {@code reason}).
 */
@Component
public class PlatformAuditTrail {

    public static final String MODULE = "platform";

    private final AuditService audit;

    public PlatformAuditTrail(AuditService audit) {
        this.audit = audit;
    }

    public void record(Operator operator, HttpServletRequest request, String action, String entityType,
                       UUID entityId, String summary) {
        audit.recordAs(operator.userId(), operator.email(), clientIp(request),
                request == null ? null : request.getHeader("User-Agent"),
                MODULE, action, entityType, entityId, summary);
    }

    static String clientIp(HttpServletRequest request) {
        if (request == null) return null;
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) return forwarded.split(",")[0].trim();
        return request.getRemoteAddr();
    }
}
