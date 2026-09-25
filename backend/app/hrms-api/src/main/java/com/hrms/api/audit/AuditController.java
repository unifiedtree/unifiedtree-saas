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
    private final AuditRecordNames recordNames;

    public AuditController(AuditService auditService, org.springframework.jdbc.core.JdbcTemplate jdbc, AuditRecordNames recordNames) {
        this.auditService = auditService;
        this.jdbc = jdbc;
        this.recordNames = recordNames;
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

        // "Who" may be a user id or an email address (the screen's filter is
        // labelled "Who (email)"). An email that matches nobody matches no events.
        AuditRecordNames.ActorFilter who = recordNames.actor(actor);
        if (who.matchesNothing()) {
            return new AuditPageResponse(List.of(), new PageMeta(page, effectiveSize, 0));
        }
        UUID actorUserId = who.userId();
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
        // And the record each event is about, so the feed can say "... for Rahul Verma".
        java.util.Map<String, AuditRecordNames.Named> records = recordNames.resolve(events.stream()
                .map(e -> new AuditRecordNames.Ref(e.getEntityType(), e.getEntityId())).toList());
        List<AuditEventDto> data = events.stream()
                // Null ids never reach get(): Map.of() (no actors on the page) throws on a null key (w2i).
                .map(e -> toDto(e, e.getActorUserId() != null ? actors.get(e.getActorUserId()) : null,
                        e.getEntityId() == null ? null : records.get(AuditRecordNames.key(e.getEntityType(), e.getEntityId()))))
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

    private AuditEventDto toDto(AuditEvent e, String[] actor, AuditRecordNames.Named record) {
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
                record == null ? null : record.name(),
                record == null ? null : record.path()
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
            /** The record's display name (an employee's name, a payroll month...), when it can be resolved. */
            String resourceName,
            /** The app route that opens the record, when it has one. */
            String resourcePath) {}

    public record PageMeta(int page, int size, long total) {}

    public record AuditPageResponse(List<AuditEventDto> data, PageMeta meta) {}
}
