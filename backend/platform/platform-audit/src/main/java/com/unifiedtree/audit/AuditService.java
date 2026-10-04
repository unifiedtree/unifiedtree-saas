package com.unifiedtree.audit;

import com.unifiedtree.audit.entity.AuditEvent;
import com.unifiedtree.audit.repository.AuditEventRepository;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.criteria.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Writes append-only rows to audit.events. Runs in a NEW transaction so a
 * rollback in the calling transaction does not suppress the audit record.
 * (An action that failed is still auditable.)
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final AuditEventRepository repo;

    public AuditService(AuditEventRepository repo) {
        this.repo = repo;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String module, String action, String entityType,
                       UUID entityId, String summary) {
        UUID tenantId    = TenantContext.getTenantId();
        UUID actorUserId = TenantContext.getUserId();
        AuditEvent event = AuditEvent.of(tenantId, actorUserId, module,
                                          action, entityType, entityId, summary);
        try {
            repo.save(event);
        } catch (Exception ex) {
            log.error("Audit write failed (non-fatal): module={} action={} entity={}/{}",
                      module, action, entityType, entityId, ex);
        }
    }

    /**
     * Record an event whose actor is not the signed-in caller of this thread,
     * such as a sign-in (the request has no session yet). The tenant still
     * comes from {@link TenantContext}: the database connection is scoped by
     * it, and the audit insert policy only accepts rows for that tenant, so
     * the caller binds it before calling.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordAs(UUID actorUserId, String actorEmail, String ip, String userAgent,
                         String module, String action, String entityType, UUID entityId, String summary) {
        AuditEvent event = AuditEvent.of(TenantContext.getTenantId(), actorUserId, module,
                                          action, entityType, entityId, summary);
        event.setActorEmail(clip(actorEmail, 255));
        event.setActorIp(clip(ip, 45));
        event.setActorUserAgent(clip(userAgent, 500));
        try {
            repo.save(event);
        } catch (Exception ex) {
            log.error("Audit write failed (non-fatal): module={} action={} entity={}/{}",
                      module, action, entityType, entityId, ex);
        }
    }

    private static String clip(String s, int max) {
        if (s == null || s.isBlank()) return null;
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }

    /** Async variant — fire-and-forget, does not block the calling thread. */
    @Async
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordAsync(String module, String action, String entityType,
                             UUID entityId, String summary) {
        record(module, action, entityType, entityId, summary);
    }

    @Transactional(readOnly = true)
    public Page<AuditEvent> query(UUID tenantId, UUID actorUserId, String module,
                                   String entityType, UUID entityId,
                                   Instant from, Instant to, Pageable pageable) {
        return query(tenantId, actorUserId, module, entityType, entityId, null, List.of(), from, to, pageable);
    }

    /**
     * As above, plus the action: {@code action} keeps only that action and
     * {@code excludeActions} drops those (both ignoring case). Done in the query,
     * so pages and the total count only ever cover matching events.
     */
    @Transactional(readOnly = true)
    public Page<AuditEvent> query(UUID tenantId, UUID actorUserId, String module,
                                   String entityType, UUID entityId,
                                   String action, java.util.Collection<String> excludeActions,
                                   Instant from, Instant to, Pageable pageable) {
        List<String> excluded = excludeActions == null ? List.of() : excludeActions.stream()
                .filter(a -> a != null && !a.isBlank()).map(a -> a.trim().toUpperCase(java.util.Locale.ROOT)).toList();
        Specification<AuditEvent> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (tenantId    != null) predicates.add(cb.equal(root.get("tenantId"),    tenantId));
            if (actorUserId != null) predicates.add(cb.equal(root.get("actorUserId"), actorUserId));
            if (module      != null) predicates.add(cb.equal(root.get("module"),      module));
            if (entityType  != null) predicates.add(cb.equal(root.get("entityType"),  entityType));
            if (entityId    != null) predicates.add(cb.equal(root.get("entityId"),    entityId));
            if (action != null && !action.isBlank()) {
                predicates.add(cb.equal(cb.upper(root.get("action")), action.trim().toUpperCase(java.util.Locale.ROOT)));
            }
            if (!excluded.isEmpty()) predicates.add(cb.not(cb.upper(root.get("action")).in(excluded)));
            if (from        != null) predicates.add(cb.greaterThanOrEqualTo(root.get("occurredAt"), from));
            if (to          != null) predicates.add(cb.lessThanOrEqualTo(root.get("occurredAt"),   to));
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        return repo.findAll(spec, pageable);
    }

    /** Receives cross-module audit commands published via Spring events. */
    @EventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onAuditCommand(AuditCommand command) {
        record(command.module(), command.action(), command.entityType(),
               command.entityId(), command.summary());
    }
}
