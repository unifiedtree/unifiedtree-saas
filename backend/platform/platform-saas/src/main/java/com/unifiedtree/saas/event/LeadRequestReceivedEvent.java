package com.unifiedtree.saas.event;

import java.time.Instant;
import java.util.UUID;

/**
 * Published by {@link com.unifiedtree.saas.leads.LeadRequestController} when a
 * public marketing form (demo request / contact sales) is submitted. Listened
 * to by the mail sender in {@code hrms-api} (which owns the MailService
 * dependency). Decouples the canonical portal write path from the email
 * side-effect so platform-saas stays free of the hrms-api dependency —
 * mirrors the {@link WorkspaceCreatedEvent} pattern.
 *
 * <p>Non-nullable fields: intent, name, email. Everything else may be null,
 * matching the two forms' shared-but-different payloads.
 */
public record LeadRequestReceivedEvent(
        UUID leadId,
        String intent,          // "demo" | "sales"
        String name,
        String email,
        String company,
        String companySize,     // demo form: size; sales form: employees
        String preferred,       // demo form only
        String timeline,        // sales form only
        String notes,           // demo form only
        String message,         // sales form only
        String userAgent,
        String ipAddress,
        Instant receivedAt
) {}
