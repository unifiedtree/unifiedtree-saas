package com.unifiedtree.saas.event;

import java.util.List;
import java.util.UUID;

/**
 * Published by {@link com.unifiedtree.saas.service.SaasService} immediately
 * after a workspace is created at signup. Listened to by the welcome-email
 * sender in {@code hrms-api} (which has the MailService dependency). Decouples
 * the canonical signup write path from the email side-effect so platform-saas
 * stays free of the hrms-api dependency.
 */
public record WorkspaceCreatedEvent(
        UUID tenantId,
        UUID accountId,
        String subdomain,
        String fullDomain,
        String workspaceUrl,
        String adminName,
        String adminEmail,
        String companyName,
        List<String> activeModules
) {}
