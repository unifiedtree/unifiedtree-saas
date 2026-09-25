package com.hrms.api.audit;

import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.audit.entity.AuditEvent;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/v1/audit/events")
@Tag(name = "Audit", description = "Tenant-scoped audit event log")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasAuthority('audit.read')")
public class AuditController {

    private static final Pattern PII_FIELD_PATTERN = Pattern.compile(
            "\"(pan_encrypted|account_number_encrypted|aadhaar_encrypted|passport_number_encrypted)\"\\s*:\\s*\"[^\"]*\"",
            Pattern.CASE_INSENSITIVE
    );

    private final AuditService auditService;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public AuditController(AuditService auditService, org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.auditService = auditService;
        this.jdbc = jdbc;
    }

    @GetMapping
    @Operation(summary = "Query audit events for the current tenant")
    public AuditPageResponse getEvents(
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String resource,
            @RequestParam(required = false) String resourceId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {

        int effectiveSize = Math.min(size, 100);

        UUID actorUserId = tryParseUuid(actor);
        UUID entityId    = tryParseUuid(resourceId);
        // Tolerate a malformed from/to (optional filters) instead of 500-ing on
        // Instant.parse — an unparseable value simply drops that bound.
        Instant fromInstant = null, toInstant = null;
        try { if (from != null && !from.isBlank()) fromInstant = Instant.parse(from); } catch (java.time.format.DateTimeParseException ignored) {}
        try { if (to   != null && !to.isBlank())   toInstant   = Instant.parse(to);   } catch (java.time.format.DateTimeParseException ignored) {}

        PageRequest pageable = PageRequest.of(page, effectiveSize, Sort.by(Sort.Direction.DESC, "occurredAt"));
        Page<AuditEvent> result = auditService.query(
                TenantContext.getTenantId(),
                actorUserId,
                null,
                resource,
                entityId,
                fromInstant,
                toInstant,
                pageable
        );

        List<AuditEvent> events = result.getContent().stream()
                .filter(e -> action == null || action.equalsIgnoreCase(e.getAction()))
                .toList();
        // Events store only the actor's user id; resolve names/emails once per
        // page so the feed says who did it instead of printing a raw UUID.
        java.util.Map<UUID, String[]> actors = actorDetails(events.stream()
                .map(AuditEvent::getActorUserId).filter(java.util.Objects::nonNull).distinct().toList());
        // And the record's own name (an employee, a letter distribution…) so the
        // feed can say what was changed, not just its type.
        java.util.Map<UUID, String[]> resources = resourceDetails(events);
        List<AuditEventDto> data = events.stream()
                // Null ids never reach get(): Map.of() (no actors on the page) throws on a null key.
                .map(e -> toDto(e, e.getActorUserId() != null ? actors.get(e.getActorUserId()) : null,
                        e.getEntityId() != null ? resources.get(e.getEntityId()) : null))
                .toList();

        return new AuditPageResponse(data, new PageMeta(page, effectiveSize, result.getTotalElements()));
    }

    /** user id -> {display name, email}, read under the caller's tenant (RLS). Empty on any failure. */
    private java.util.Map<UUID, String[]> actorDetails(List<UUID> userIds) {
        if (userIds.isEmpty()) return java.util.Map.of();
        try {
            String in = String.join(",", java.util.Collections.nCopies(userIds.size(), "?"));
            java.util.Map<UUID, String[]> out = new java.util.HashMap<>();
            // display_name is often blank; fall back to the linked employee's name.
            jdbc.query("SELECT c.id, COALESCE(NULLIF(btrim(c.display_name), ''), "
                            + "NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '')) AS name, c.email "
                            + "FROM auth.user_credentials c "
                            + "LEFT JOIN hrms.employees e ON e.id = c.employee_id AND e.tenant_id = c.tenant_id "
                            + "WHERE c.id IN (" + in + ")",
                    rs -> { out.put(rs.getObject("id", UUID.class), new String[] { rs.getString("name"), rs.getString("email") }); },
                    userIds.toArray());
            return out;
        } catch (RuntimeException e) {
            return java.util.Map.of();
        }
    }

    /**
     * The types whose records have a name: entity type (lower case) -> SQL
     * returning (id, name, parent_id) for ids IN (...). Read under the caller's
     * tenant (RLS). parent_id is where the record is shown (a distribution
     * recipient opens its distribution); null when the record has its own page.
     */
    static final java.util.Map<String, String> RESOURCE_NAME_SQL = java.util.Map.of(
            "distribution_job",
            "SELECT id, title AS name, NULL::uuid AS parent_id FROM letters.distribution_jobs WHERE id IN (%s)",
            "distribution_recipient",
            "SELECT r.id, NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), '') AS name, r.job_id AS parent_id "
                    + "FROM letters.distribution_recipients r "
                    + "LEFT JOIN hrms.employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id WHERE r.id IN (%s)",
            "employee",
            "SELECT id, NULLIF(btrim(concat_ws(' ', first_name, last_name)), '') AS name, NULL::uuid AS parent_id "
                    + "FROM hrms.employees WHERE id IN (%s)");

    /** record id -> {name, parent id}; missing for unknown types and on any failure. */
    private java.util.Map<UUID, String[]> resourceDetails(List<AuditEvent> events) {
        java.util.Map<String, List<UUID>> byType = new java.util.HashMap<>();
        for (AuditEvent e : events) {
            if (e.getEntityId() == null || e.getEntityType() == null) continue;
            String type = e.getEntityType().toLowerCase(java.util.Locale.ROOT);
            if (!RESOURCE_NAME_SQL.containsKey(type)) continue;
            List<UUID> ids = byType.computeIfAbsent(type, k -> new java.util.ArrayList<>());
            if (!ids.contains(e.getEntityId())) ids.add(e.getEntityId());
        }
        java.util.Map<UUID, String[]> out = new java.util.HashMap<>();
        byType.forEach((type, ids) -> {
            try {
                String in = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
                jdbc.query(RESOURCE_NAME_SQL.get(type).formatted(in),
                        rs -> {
                            Object parent = rs.getObject("parent_id");
                            out.put(rs.getObject("id", UUID.class),
                                    new String[] { rs.getString("name"), parent != null ? parent.toString() : null });
                        },
                        ids.toArray());
            } catch (RuntimeException ex) {
                // no names for this type
            }
        });
        return out;
    }

    private AuditEventDto toDto(AuditEvent e, String[] actor, String[] resource) {
        String name = actor != null && actor[0] != null && !actor[0].isBlank() ? actor[0] : null;
        String email = e.getActorEmail() != null ? e.getActorEmail() : (actor != null ? actor[1] : null);
        return new AuditEventDto(
                e.getId() != null ? e.getId().toString() : null,
                e.getOccurredAt() != null ? e.getOccurredAt().toString() : null,
                e.getActorUserId() != null ? e.getActorUserId().toString() : null,
                email,
                e.getEntityType(),
                e.getEntityId() != null ? e.getEntityId().toString() : null,
                e.getAction(),
                maskPii(e.getDiff()),
                e.getActorIp(),
                e.getActorUserAgent(),
                e.getCorrelationId(),
                e.getModule(),
                e.getSummary(),
                name,
                resource != null ? resource[0] : null,
                resource != null ? resource[1] : null
        );
    }

    private String maskPii(String diff) {
        if (diff == null) return null;
        return PII_FIELD_PATTERN.matcher(diff).replaceAll("\"$1\":\"<encrypted>\"");
    }

    private UUID tryParseUuid(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // ── Response types ────────────────────────────────────────────────────

    public record AuditEventDto(
            String id,
            String occurredAt,
            String actorUserId,
            String actorEmail,
            String resourceType,
            String resourceId,
            String action,
            String diff,
            String ip,
            String userAgent,
            String traceId,
            /** Owning module, e.g. "leave" / "attendance". Nullable. */
            String module,
            /**
             * Human-readable one-line description of the event.
             *
             * <p>NOTE: as of 2026-08-22 NOTHING in the codebase calls
             * {@code AuditEvent.setSummary(...)} — a repo-wide grep for
             * {@code setSummary(} returns zero hits — so this is always null
             * today. It is mapped here so that the moment a writer starts
             * populating it the activity feed picks it up for free; until then
             * clients must fall back to composing a label from
             * {@code action} + {@code resourceType}.
             */
            String summary,
            /** The actor's display name, resolved from their user id. Null for system events. */
            String actorName,
            /** The changed record's name (employee, letter distribution…). Null when its type has no name or it's gone. */
            String resourceName,
            /** Where the record is shown when it has no page of its own: a distribution recipient's distribution id. */
            String resourceParentId) {}

    public record PageMeta(int page, int size, long total) {}

    public record AuditPageResponse(List<AuditEventDto> data, PageMeta meta) {}
}
