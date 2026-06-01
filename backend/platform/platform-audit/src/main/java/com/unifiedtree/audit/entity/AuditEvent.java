package com.unifiedtree.audit.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/**
 * Append-only audit row stored in audit.events (partitioned by occurred_at).
 * Never update or delete. Write via AuditService only.
 */
@Entity
@Table(schema = "audit", name = "events")
public class AuditEvent {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    @Column(name = "occurred_date", nullable = false, updatable = false)
    private java.time.LocalDate occurredDate;

    @Column(name = "actor_user_id")
    private UUID actorUserId;

    @Column(name = "actor_email", length = 255)
    private String actorEmail;

    @Column(name = "actor_ip", columnDefinition = "INET")
    private String actorIp;

    @Column(name = "actor_user_agent", length = 500)
    private String actorUserAgent;

    @Column(name = "module", nullable = false, length = 50)
    private String module;

    @Column(name = "action", nullable = false, length = 50)
    private String action;

    @Column(name = "entity_type", length = 100)
    private String entityType;

    @Column(name = "entity_id")
    private UUID entityId;

    @Column(name = "summary", columnDefinition = "TEXT")
    private String summary;

    @Column(name = "diff", columnDefinition = "JSONB")
    private String diff;

    @Column(name = "request_id", length = 64)
    private String requestId;

    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    public AuditEvent() {}

    public static AuditEvent of(UUID tenantId, UUID actorUserId, String module,
                                 String action, String entityType, UUID entityId,
                                 String summary) {
        AuditEvent e = new AuditEvent();
        e.id            = UUID.randomUUID();
        e.tenantId      = tenantId;
        e.occurredAt    = Instant.now();
        e.occurredDate  = java.time.LocalDate.now();
        e.actorUserId   = actorUserId;
        e.module        = module;
        e.action        = action;
        e.entityType    = entityType;
        e.entityId      = entityId;
        e.summary       = summary;
        return e;
    }

    // getters
    public UUID getId()                   { return id; }
    public UUID getTenantId()             { return tenantId; }
    public Instant getOccurredAt()        { return occurredAt; }
    public UUID getActorUserId()          { return actorUserId; }
    public String getActorEmail()         { return actorEmail; }
    public String getActorIp()            { return actorIp; }
    public String getActorUserAgent()     { return actorUserAgent; }
    public String getModule()             { return module; }
    public String getAction()             { return action; }
    public String getEntityType()         { return entityType; }
    public UUID getEntityId()             { return entityId; }
    public String getSummary()            { return summary; }
    public String getDiff()               { return diff; }
    public String getRequestId()          { return requestId; }
    public String getCorrelationId()      { return correlationId; }

    // setters for optional fields
    public void setActorEmail(String actorEmail)         { this.actorEmail = actorEmail; }
    public void setActorIp(String actorIp)               { this.actorIp = actorIp; }
    public void setActorUserAgent(String actorUserAgent) { this.actorUserAgent = actorUserAgent; }
    public void setDiff(String diff)                     { this.diff = diff; }
    public void setRequestId(String requestId)           { this.requestId = requestId; }
    public void setCorrelationId(String correlationId)   { this.correlationId = correlationId; }
}
