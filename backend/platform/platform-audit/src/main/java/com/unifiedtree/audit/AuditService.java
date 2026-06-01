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
        Specification<AuditEvent> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (tenantId    != null) predicates.add(cb.equal(root.get("tenantId"),    tenantId));
            if (actorUserId != null) predicates.add(cb.equal(root.get("actorUserId"), actorUserId));
            if (module      != null) predicates.add(cb.equal(root.get("module"),      module));
            if (entityType  != null) predicates.add(cb.equal(root.get("entityType"),  entityType));
            if (entityId    != null) predicates.add(cb.equal(root.get("entityId"),    entityId));
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
