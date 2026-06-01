package com.unifiedtree.audit;

import java.util.UUID;

/**
 * Cross-module audit command published via Spring's ApplicationEventPublisher.
 * Any service in any module can fire this without importing platform-audit directly.
 *
 * <pre>
 *   events.publishEvent(new AuditCommand("hrms", "CREATE", "Employee", id, "Created employee John Doe"));
 * </pre>
 */
public record AuditCommand(
        String module,
        String action,
        String entityType,
        UUID entityId,
        String summary
) { }
