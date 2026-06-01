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

    public AuditController(AuditService auditService) {
        this.auditService = auditService;
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
        Instant fromInstant = from != null ? Instant.parse(from) : null;
        Instant toInstant   = to   != null ? Instant.parse(to)   : null;

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

        List<AuditEventDto> data = result.getContent().stream()
                .filter(e -> action == null || action.equalsIgnoreCase(e.getAction()))
                .map(this::toDto)
                .toList();

        return new AuditPageResponse(data, new PageMeta(page, effectiveSize, result.getTotalElements()));
    }

    private AuditEventDto toDto(AuditEvent e) {
        return new AuditEventDto(
                e.getId() != null ? e.getId().toString() : null,
                e.getOccurredAt() != null ? e.getOccurredAt().toString() : null,
                e.getActorUserId() != null ? e.getActorUserId().toString() : null,
                e.getActorEmail(),
                e.getEntityType(),
                e.getEntityId() != null ? e.getEntityId().toString() : null,
                e.getAction(),
                maskPii(e.getDiff()),
                e.getActorIp(),
                e.getActorUserAgent(),
                e.getCorrelationId()
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
            String traceId) {}

    public record PageMeta(int page, int size, long total) {}

    public record AuditPageResponse(List<AuditEventDto> data, PageMeta meta) {}
}
